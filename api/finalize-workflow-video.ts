import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const ffmpegPath = ffmpegInstaller.path;

/**
 * Joins the video results of one finished template run into a single
 * deliverable and stores it on the run.
 *
 * Why server-side: the clip list comes from the *locked, published* Quick Use
 * definition, not from whatever the browser claims. The browser only says
 * "this run is done"; every other decision is made here.
 *
 * Per-step results are never replaced. Admin review and future remixing still
 * see each step; the merged file is an additional artefact.
 *
 * Aspect ratio: the first included shot defines the frame. Any later shot with
 * a different frame is letterboxed into it with black bars — never stretched.
 * The merge provider has no fitting option of its own, so the padding is done
 * per clip before the clips are joined.
 *
 * Duration: assembly is a chain of provider round trips, so a single request
 * that waits for all of them would be a bet on the platform's function timeout.
 * Instead this endpoint is a resumable state machine. Each invocation works for
 * INVOCATION_BUDGET_MS, checkpoints to template_runs.assembly_state, and
 * answers `status: 'pending'`. The browser calls again and the next invocation
 * continues from the checkpoint. No single call runs long enough to be killed,
 * on any plan, and no provider work is ever repeated or paid for twice.
 */

export const config = { maxDuration: 300 };

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const falKey = process.env.FAL_KEY;

const FAL_RUN_BASE_URL = 'https://fal.run';
const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';
const FAL_MERGE_ENDPOINT = 'fal-ai/ffmpeg-api/merge-videos';
const FAL_COMPOSE_ENDPOINT = 'fal-ai/ffmpeg-api/compose';
const FAL_SCALE_ENDPOINT = 'fal-ai/workflow-utilities/scale-video';
const FINAL_VIDEO_BUCKET = 'workflow-final-videos';

/** Mirrors QUICK_USE_FINAL_VIDEO_MIN_CLIPS / MAX_CLIPS in workflows/. */
const MIN_CLIPS = 2;
const MAX_CLIPS = 8;

/** The merge provider rejects a target frame outside this range. */
const MIN_FRAME_SIDE = 512;
const MAX_FRAME_SIDE = 2048;

/**
 * How long one invocation is allowed to work before checkpointing. Chosen to
 * sit under the smallest function timeout this could ever be deployed behind,
 * not under the current one — the whole point is that the platform limit stops
 * being something the feature depends on.
 */
const INVOCATION_BUDGET_MS = 45_000;

/** Storing downloads and re-uploads the merged file; do not start it on fumes. */
const STORING_RESERVE_MS = 20_000;

const POLL_INTERVAL_MS = 2_000;

/** Above this we keep the provider URL instead of buffering the file. */
const MAX_REHOST_BYTES = 300 * 1024 * 1024;
const MAX_RETIME_BYTES = 150 * 1024 * 1024;
const RETIME_TIMEOUT_MS = 90_000;
const LOCAL_MERGE_TIMEOUT_MS = 180_000;

type RunRow = Record<string, unknown>;

interface FrameSize {
  width: number;
  height: number;
}

interface ClipSource {
  stepId: string;
  order: number;
  url: string;
  executionMode: string;
}

/** A submitted provider job. The URLs come from the provider, never rebuilt. */
interface QueuedJob {
  statusUrl: string;
  responseUrl: string;
}

type AssemblyPhase = 'retiming' | 'padding' | 'merging' | 'mixing' | 'storing';

interface AssemblyState {
  version: 1 | 2 | 3 | 4 | 5;
  phase: AssemblyPhase;
  /** null when clip metadata was unreadable and the provider must choose. */
  target: FrameSize | null;
  /** Assembly-only normalized/retimed URL per position. Version 3+. */
  retimed: (string | null)[];
  /** Whether each source still needs letterboxing after retiming. */
  needsPadding: boolean[];
  /** Resolved clip URL per position, or null while its pad job is running. */
  padded: (string | null)[];
  /** Pad job per position, or null when that clip needed no padding. */
  padJobs: (QueuedJob | null)[];
  mergeJob: QueuedJob | null;
  mixJob: QueuedJob | null;
  mergedUrl: string | null;
  mergedDuration: number | null;
  retimedCount: number;
  paddedCount: number;
  inputFingerprint: string | null;
}

interface TimelineSource {
  kind: 'step_result' | 'template_asset';
  stepId?: string;
  resultId?: string;
  assetKey?: string;
}

interface TimelineDefinition {
  videoClips: Array<{ id: string; source: TimelineSource; durationScale: number }>;
  audioClips: Array<{ id: string; source: TimelineSource; startMs: number }>;
  resultChoices?: Array<{ id: string; stepId: string; options: Array<{ id: string; assetKey: string; assetType: string }>; defaultOptionId: string }>;
}

function sendError(res: VercelResponse, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function readBody(body: unknown): { runId: string; resultChoices: Record<string, string> } {
  if (typeof body === 'string') {
    try {
      return readBody(JSON.parse(body));
    } catch {
      return { runId: '', resultChoices: {} };
    }
  }
  if (!isRecord(body)) return { runId: '', resultChoices: {} };
  const resultChoices = isRecord(body.resultChoices)
    ? Object.fromEntries(Object.entries(body.resultChoices).flatMap(([key, value]) => typeof value === 'string' ? [[key, value] as [string, string]] : []))
    : {};
  return { runId: readString(body.runId) || '', resultChoices };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { message: text };
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Workflow / definition reading
// ---------------------------------------------------------------------------

interface WorkflowStepSummary {
  id: string;
  order: number;
  assetType: string;
}

function readWorkflowSteps(workflow: unknown): WorkflowStepSummary[] {
  if (!isRecord(workflow) || !Array.isArray(workflow.steps)) return [];
  return workflow.steps
    .flatMap((step): WorkflowStepSummary[] => {
      if (!isRecord(step) || typeof step.id !== 'string') return [];
      const output = isRecord(step.output) ? step.output : {};
      return [{
        id: step.id,
        order: typeof step.order === 'number' ? step.order : Number.MAX_SAFE_INTEGER,
        assetType: typeof output.assetType === 'string' ? output.assetType : '',
      }];
    })
    .sort((left, right) => left.order - right.order);
}

/**
 * Server-side twin of selectFinalVideoStepIds() in
 * workflows/quickUseFinalVideo.ts. Kept inline so this serverless function has
 * no build-time dependency on the browser bundle; the rules must stay
 * identical to the ones the Quick Use Builder validates against.
 */
function selectFinalVideoStepIds(
  workflow: unknown,
  quickUseDefinition: unknown,
): string[] {
  if (!isRecord(quickUseDefinition)) return [];
  const finalVideo = quickUseDefinition.finalVideo;
  if (!isRecord(finalVideo) || finalVideo.enabled !== true) return [];
  if (!Array.isArray(finalVideo.stepIds)) return [];
  const included = new Set(finalVideo.stepIds.filter((id): id is string => typeof id === 'string'));
  const selected = readWorkflowSteps(workflow)
    .filter((step) => step.assetType === 'video' && included.has(step.id))
    .map((step) => step.id);
  if (selected.length < MIN_CLIPS) return [];
  return selected.slice(0, MAX_CLIPS);
}

function readTimelineDefinition(quickUseDefinition: unknown): TimelineDefinition | null {
  if (!isRecord(quickUseDefinition) || !isRecord(quickUseDefinition.timeline)) return null;
  const timeline = quickUseDefinition.timeline;
  if (timeline.enabled !== true || timeline.preserveVideoAudio !== true) return null;
  if (!Array.isArray(timeline.videoClips) || !Array.isArray(timeline.audioClips)) return null;
  const readSource = (value: unknown): TimelineSource | null => {
    if (!isRecord(value)) return null;
    if (value.kind === 'step_result') {
      const stepId = readString(value.stepId);
      const resultId = readString(value.resultId);
      return stepId ? { kind: 'step_result', stepId, ...(resultId ? { resultId } : {}) } : null;
    }
    if (value.kind === 'template_asset') {
      const assetKey = readString(value.assetKey);
      return assetKey ? { kind: 'template_asset', assetKey } : null;
    }
    return null;
  };
  const videoClips = timeline.videoClips.flatMap((value): TimelineDefinition['videoClips'] => {
    if (!isRecord(value)) return [];
    const id = readString(value.id);
    const source = readSource(value.source);
    const durationScale = typeof value.durationScale === 'number'
      && Number.isFinite(value.durationScale)
      && value.durationScale >= 1
      && value.durationScale <= 2
      ? Math.round(value.durationScale * 100) / 100
      : 1;
    return id && source ? [{ id, source, durationScale }] : [];
  }).slice(0, MAX_CLIPS);
  const audioClips = timeline.audioClips.flatMap((value): TimelineDefinition['audioClips'] => {
    if (!isRecord(value)) return [];
    const id = readString(value.id);
    const source = readSource(value.source);
    const startMs = typeof value.startMs === 'number' && Number.isInteger(value.startMs) && value.startMs >= 0
      ? value.startMs
      : null;
    return id && source && startMs !== null ? [{ id, source, startMs }] : [];
  }).slice(0, MAX_CLIPS);
  const resultChoices = Array.isArray(timeline.resultChoices)
    ? timeline.resultChoices.flatMap((value): TimelineDefinition['resultChoices'] => {
      if (!isRecord(value) || typeof value.id !== 'string' || typeof value.stepId !== 'string' || typeof value.defaultOptionId !== 'string' || !Array.isArray(value.options)) return [];
      const options = value.options.flatMap((option) => isRecord(option) && typeof option.id === 'string' && typeof option.assetKey === 'string' && typeof option.assetType === 'string' ? [{ id: option.id, assetKey: option.assetKey, assetType: option.assetType }] : []);
      return options.length > 0 ? [{ id: value.id, stepId: value.stepId, options, defaultOptionId: value.defaultOptionId }] : [];
    })
    : undefined;
  return videoClips.length > 0 ? { videoClips, audioClips, resultChoices } : null;
}

const timelineFingerprint = (timeline: TimelineDefinition): string => JSON.stringify({
  video: timeline.videoClips.map((clip) => ({ source: clip.source, durationScale: clip.durationScale })),
  audio: timeline.audioClips.map((clip) => ({ source: clip.source, startMs: clip.startMs })),
});

// ---------------------------------------------------------------------------
// Schema tolerance helpers
// ---------------------------------------------------------------------------

async function loadRunSteps(
  supabase: SupabaseClient,
  runId: string,
): Promise<Record<string, unknown>[]> {
  for (const column of ['run_id', 'template_run_id']) {
    const { data, error } = await supabase
      .from('template_run_steps')
      .select('*')
      .eq(column, runId);
    if (!error) return (data || []) as Record<string, unknown>[];
    if (error.code !== '42703') throw error;
  }
  throw new Error('template_run_steps has no recognisable run reference column.');
}

function runOwnerId(run: RunRow): string | null {
  return readString(run.user_id) || readString(run.owner_id);
}

// ---------------------------------------------------------------------------
// Clip resolution
// ---------------------------------------------------------------------------

async function resolveClipUrls(
  supabase: SupabaseClient,
  runId: string,
  stepIds: string[],
): Promise<ClipSource[]> {
  const rows = await loadRunSteps(supabase, runId);
  const byStepId = new Map(rows.map((row) => [String(row.step_id), row]));

  const generationIds = stepIds
    .map((stepId) => readString(byStepId.get(stepId)?.generation_id))
    .filter((id): id is string => Boolean(id));
  const generationUrls = new Map<string, string>();
  if (generationIds.length > 0) {
    const { data, error } = await supabase
      .from('generations')
      .select('id,video_url,image_url')
      .in('id', generationIds);
    if (error) throw error;
    for (const generation of data || []) {
      const record = generation as Record<string, unknown>;
      const url = readString(record.video_url) || readString(record.image_url);
      const id = readString(record.id);
      if (id && url) generationUrls.set(id, url);
    }
  }

  return stepIds.map((stepId, index) => {
    const row = byStepId.get(stepId);
    if (!row) throw new Error(`This run has no record for step ${stepId}.`);
    if (row.status !== 'completed') {
      throw new Error(`Step ${stepId} is not completed, so the final video cannot be assembled.`);
    }
    const generationId = readString(row.generation_id);
    const url = (generationId && generationUrls.get(generationId))
      || readString(row.result_url);
    if (!url) throw new Error(`Step ${stepId} has no playable result URL.`);
    return {
      stepId,
      order: index + 1,
      url,
      executionMode: readString(row.execution_mode) || 'generated',
    };
  });
}

async function resolveTimelineSources(
  supabase: SupabaseClient,
  runId: string,
  templateId: string,
  versionId: string,
  sources: TimelineSource[],
  expectedType: 'video' | 'audio',
  resultChoices: Record<string, string> = {},
  choiceGroups: TimelineDefinition['resultChoices'] = [],
): Promise<Array<{ url: string; stepId?: string; executionMode: string }>> {
  const runSteps = await loadRunSteps(supabase, runId);
  const runStepById = new Map(runSteps.map((row) => [String(row.step_id), row]));
  const stepIds = [...new Set(sources.flatMap((source) => source.stepId ? [source.stepId] : []))];
  const generationIds = stepIds
    .map((stepId) => readString(runStepById.get(stepId)?.generation_id))
    .filter((id): id is string => Boolean(id));
  const generationUrls = new Map<string, { video?: string; audio?: string }>();
  if (generationIds.length > 0) {
    const { data, error } = await supabase
      .from('generations')
      .select('id,video_url,audio_url,image_url,media_type')
      .in('id', generationIds);
    if (error) throw error;
    for (const value of data || []) {
      const row = value as Record<string, unknown>;
      const id = readString(row.id);
      if (!id) continue;
      generationUrls.set(id, {
        video: readString(row.video_url) || (row.media_type === 'video' ? readString(row.image_url) || undefined : undefined),
        audio: readString(row.audio_url) || (row.media_type === 'audio' ? readString(row.image_url) || undefined : undefined),
      });
    }
  }

  const choiceAssetKeys = (choiceGroups || []).flatMap((group) => group.options.map((option) => option.assetKey));
  const assetKeys = [...new Set(sources.flatMap((source) => source.assetKey ? [source.assetKey] : []).concat(choiceAssetKeys))];
  const assetsByKey = new Map<string, Record<string, unknown>>();
  if (assetKeys.length > 0) {
    const { data, error } = await supabase
      .from('template_assets')
      .select('asset_key,asset_type,storage_bucket,storage_path,public_url')
      .eq('template_id', templateId)
      .eq('version_id', versionId)
      .in('asset_key', assetKeys);
    if (error) throw error;
    for (const value of data || []) {
      const row = value as Record<string, unknown>;
      const key = readString(row.asset_key);
      if (key) assetsByKey.set(key, row);
    }
  }

  return Promise.all(sources.map(async (source) => {
    if (source.kind === 'step_result' && source.stepId) {
      const group = choiceGroups?.find((candidate) => candidate.stepId === source.stepId && candidate.options.some((option) => option.assetType === expectedType));
      const selectedId = source.resultId || (group ? resultChoices[group.id] || group.defaultOptionId : undefined);
      const selected = group?.options.find((option) => option.id === selectedId && option.assetType === expectedType);
      if (selected) {
        const asset = assetsByKey.get(selected.assetKey);
        if (!asset) throw new Error(`Selected result ${selected.id} is missing.`);
        const publicUrl = readString(asset.public_url);
        if (publicUrl) return { url: publicUrl, stepId: source.stepId, executionMode: 'template_asset' };
        const bucket = readString(asset.storage_bucket);
        const path = readString(asset.storage_path);
        if (bucket && path) {
          const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 6 * 60 * 60);
          if (!error && data?.signedUrl) return { url: data.signedUrl, stepId: source.stepId, executionMode: 'template_asset' };
        }
      }
      const stepRow = runStepById.get(source.stepId);
      if (!stepRow || stepRow.status !== 'completed') throw new Error(`Timeline step ${source.stepId} is not complete.`);
      const generationId = readString(stepRow.generation_id);
      const url = generationId ? generationUrls.get(generationId)?.[expectedType] : undefined;
      const fallback = readString(stepRow.result_url);
      if (!url && !fallback) throw new Error(`Timeline step ${source.stepId} has no ${expectedType} result.`);
      return {
        url: await ensureFetchableUrl(supabase, url || fallback!),
        stepId: source.stepId,
        executionMode: readString(stepRow.execution_mode) || 'generated',
      };
    }
    const asset = source.assetKey ? assetsByKey.get(source.assetKey) : undefined;
    if (!asset || asset.asset_type !== expectedType) throw new Error(`Timeline asset ${source.assetKey || ''} is missing or has the wrong type.`);
    const publicUrl = readString(asset.public_url);
    if (publicUrl) return { url: publicUrl, executionMode: 'template_asset' };
    const bucket = readString(asset.storage_bucket);
    const path = readString(asset.storage_path);
    if (!bucket || !path) throw new Error(`Timeline asset ${source.assetKey || ''} has no readable file.`);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 6 * 60 * 60);
    if (error || !data?.signedUrl) throw new Error(`Timeline asset ${source.assetKey || ''} could not be signed.`);
    return { url: data.signedUrl, executionMode: 'template_asset' };
  }));
}

/**
 * A reused step points at a template asset that may live in a private bucket.
 * Fal must be able to download it, so private storage URLs are re-signed with
 * a window that comfortably outlives the whole assembly, including the pauses
 * between invocations.
 */
async function ensureFetchableUrl(
  supabase: SupabaseClient,
  url: string,
): Promise<string> {
  if (!supabaseUrl || !url.startsWith(supabaseUrl)) return url;
  const match = /\/storage\/v1\/object\/(?:sign|authenticated)\/([^/]+)\/([^?]+)/.exec(url);
  if (!match) return url;
  const [, bucket, path] = match;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(decodeURIComponent(path), 6 * 60 * 60);
  if (error || !data?.signedUrl) return url;
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Assembly-only retiming
// ---------------------------------------------------------------------------

async function runFfmpeg(
  args: string[],
  timeoutMs = RETIME_TIMEOUT_MS,
): Promise<void> {
  if (!ffmpegPath) throw new Error('The FFmpeg executable is unavailable.');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Video processing exceeded the server time limit.'));
    }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Video processing failed${stderr.trim() ? `: ${stderr.trim()}` : '.'}`));
    });
  });
}

async function uploadAssemblyVideo(
  supabase: SupabaseClient,
  filePath: string,
  storagePath: string,
): Promise<string> {
  const outputBytes = await readFile(filePath);
  const { error } = await supabase.storage
    .from(FINAL_VIDEO_BUCKET)
    .upload(storagePath, outputBytes, {
      contentType: 'video/mp4',
      cacheControl: '31536000',
      upsert: true,
    });
  if (error) throw new Error(`The processed video could not be stored: ${error.message}`);
  const { data } = supabase.storage.from(FINAL_VIDEO_BUCKET).getPublicUrl(storagePath);
  if (!data.publicUrl) throw new Error('The processed video has no readable URL.');
  return data.publicUrl;
}

/**
 * Re-encodes every timeline clip before concatenation. Besides applying an
 * optional speed change, this resets broken timestamps and makes all audio
 * 48 kHz stereo AAC. Fal's merge endpoint produced repeated broadband clicks
 * when a stereo clip was followed by a mono clip with irregular timestamps.
 */
async function prepareClip(
  supabase: SupabaseClient,
  sourceUrl: string,
  durationScale: number,
  storagePath: string,
  target: FrameSize | null,
): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 'lazora-retime-'));
  const inputPath = join(workDir, 'input.mp4');
  const outputPath = join(workDir, 'output.mp4');
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`The clip selected for retiming could not be downloaded (${response.status}).`);
    const declaredLength = Number(response.headers.get('content-length') || '0');
    if (declaredLength > MAX_RETIME_BYTES) throw new Error('The clip selected for retiming is too large.');
    const inputBytes = Buffer.from(await response.arrayBuffer());
    if (inputBytes.byteLength > MAX_RETIME_BYTES) throw new Error('The clip selected for retiming is too large.');
    await writeFile(inputPath, inputBytes);

    const playbackRate = 1 / durationScale;
    const videoFilter = [
      `setpts=${durationScale.toFixed(4)}*(PTS-STARTPTS)`,
      'fps=24',
      ...(target ? [
        `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease`,
        `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:black`,
      ] : []),
      // Source clips can have incompatible sample aspect ratios even when
      // their pixel dimensions match. The concat filter requires one SAR.
      'setsar=1',
    ].join(',');
    const commonArgs = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-fflags', '+genpts+discardcorrupt',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-filter:v', videoFilter,
      '-filter:a', `aresample=48000:async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,atempo=${playbackRate.toFixed(6)},asetpts=PTS-STARTPTS`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      outputPath,
    ];
    try {
      await runFfmpeg(commonArgs);
    } catch (error) {
      // A silent video still needs a real audio stream so every prepared clip
      // has the same concat shape. Do not hide any other processing failure.
      if (!(error instanceof Error) || !error.message.includes('matches no streams')) throw error;
      await runFfmpeg([
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-fflags', '+genpts+discardcorrupt',
        '-i', inputPath,
        '-f', 'lavfi',
        '-i', 'anullsrc=r=48000:cl=stereo',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-filter:v', videoFilter,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
        '-shortest',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        outputPath,
      ]);
    }

    return await uploadAssemblyVideo(supabase, outputPath, storagePath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function mergePreparedClips(
  supabase: SupabaseClient,
  sourceUrls: string[],
  storagePath: string,
): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 'lazora-merge-'));
  const outputPath = join(workDir, 'merged.mp4');
  try {
    const inputPaths: string[] = [];
    for (let index = 0; index < sourceUrls.length; index += 1) {
      const response = await fetch(sourceUrls[index]);
      if (!response.ok) throw new Error(`Prepared clip ${index + 1} could not be downloaded (${response.status}).`);
      const declaredLength = Number(response.headers.get('content-length') || '0');
      if (declaredLength > MAX_RETIME_BYTES) throw new Error(`Prepared clip ${index + 1} is too large.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RETIME_BYTES) throw new Error(`Prepared clip ${index + 1} is too large.`);
      const inputPath = join(workDir, `input-${index + 1}.mp4`);
      await writeFile(inputPath, bytes);
      inputPaths.push(inputPath);
    }

    const inputArgs = inputPaths.flatMap((path) => ['-i', path]);
    const concatInputs = inputPaths
      .map((_, index) => `[${index}:v:0][${index}:a:0]`)
      .join('');
    await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      ...inputArgs,
      '-filter_complex', `${concatInputs}concat=n=${inputPaths.length}:v=1:a=1[v][a]`,
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      outputPath,
    ], LOCAL_MERGE_TIMEOUT_MS);

    return await uploadAssemblyVideo(supabase, outputPath, storagePath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Fal plumbing
// ---------------------------------------------------------------------------

function normalizeFalQueueStatus(payload: Record<string, unknown>): string {
  const raw = payload.status ?? payload.state ?? payload.queue_status;
  if (typeof raw !== 'string') return 'IN_PROGRESS';
  const normalized = raw.trim().toUpperCase().replace(/[-\s]+/g, '_');
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETE', 'DONE'].includes(normalized)) return 'COMPLETED';
  if (['RUNNING', 'PROCESSING'].includes(normalized)) return 'IN_PROGRESS';
  if (['QUEUED', 'PENDING'].includes(normalized)) return 'IN_QUEUE';
  if (normalized === 'CANCELED') return 'CANCELLED';
  return normalized;
}

async function falRun(
  endpoint: string,
  payload: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  if (!falKey) throw new Error('FAL_KEY is missing.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${FAL_RUN_BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(`${endpoint} failed (${response.status}): ${String(result.detail || result.message || response.statusText)}`);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Submits a queued job and returns the provider's own status/response URLs.
 *
 * Those URLs are stored verbatim in the checkpoint rather than rebuilt from the
 * endpoint path: fal namespaces queue requests by base app id, so a
 * reconstructed URL for a sub-path endpoint like ffmpeg-api/merge-videos would
 * not resolve.
 */
async function falSubmit(
  endpoint: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<QueuedJob> {
  if (!falKey) throw new Error('FAL_KEY is missing.');
  const response = await fetch(`${FAL_QUEUE_BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const submitted = await readJson(response);
  if (!response.ok) {
    throw new Error(`${label} could not start (${response.status}): ${String(submitted.detail || submitted.message || response.statusText)}`);
  }
  const requestId = readString(submitted.request_id);
  if (!requestId) throw new Error(`${label} returned no request id.`);
  return {
    statusUrl: readString(submitted.status_url)
      || `${FAL_QUEUE_BASE_URL}/${endpoint}/requests/${requestId}/status`,
    responseUrl: readString(submitted.response_url)
      || `${FAL_QUEUE_BASE_URL}/${endpoint}/requests/${requestId}`,
  };
}

/** Resolves to the finished payload, or null while the job is still running. */
async function falPoll(job: QueuedJob, label: string): Promise<Record<string, unknown> | null> {
  if (!falKey) throw new Error('FAL_KEY is missing.');
  const statusResponse = await fetch(job.statusUrl, { headers: { Authorization: `Key ${falKey}` } });
  const statusPayload = await readJson(statusResponse);
  if (!statusResponse.ok) throw new Error(`${label} status failed (${statusResponse.status}).`);
  const status = normalizeFalQueueStatus(statusPayload);
  if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) {
    throw new Error(`${label} ${status.toLowerCase()}.`);
  }
  if (status !== 'COMPLETED') return null;
  const resultResponse = await fetch(job.responseUrl, { headers: { Authorization: `Key ${falKey}` } });
  const resultPayload = await readJson(resultResponse);
  if (!resultResponse.ok) throw new Error(`${label} result failed (${resultResponse.status}).`);
  return resultPayload;
}

function firstVideoUrl(payload: Record<string, unknown>): string | null {
  const containers = [payload, payload.data, payload.output, payload.result];
  for (const container of containers) {
    if (!isRecord(container)) continue;
    const video = container.video;
    if (isRecord(video)) {
      const url = readString(video.url);
      if (url) return url;
    }
    const direct = readString(container.video_url);
    if (direct) return direct;
  }
  return null;
}

interface LocalMediaProbe {
  duration: number | null;
  size: FrameSize | null;
}

const localProbeCache = new Map<string, Promise<LocalMediaProbe>>();

/**
 * Reads media metadata with the bundled ffmpeg binary. The old implementation
 * called fal's metadata endpoint once per clip (and again for the merged file),
 * which created a paid request every time a user merely assembled or replayed
 * a template. Assembly metadata is local bookkeeping, so it must never call a
 * generation provider.
 */
async function probeLocalMedia(url: string): Promise<LocalMediaProbe> {
  const cached = localProbeCache.get(url);
  if (cached) return cached;
  const probe = (async (): Promise<LocalMediaProbe> => {
    const workDir = await mkdtemp(join(tmpdir(), 'lazora-probe-'));
    const inputPath = join(workDir, 'input');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Media probe download failed (${response.status}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RETIME_BYTES) throw new Error('Media probe file is too large.');
      await writeFile(inputPath, bytes);
      const stderr = await new Promise<string>((resolve) => {
        const child = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath, '-f', 'null', '-'], { windowsHide: true });
        let output = '';
        child.stderr.on('data', (chunk: Buffer | string) => { output = `${output}${String(chunk)}`.slice(-20_000); });
        child.once('error', () => resolve(output));
        child.once('close', () => resolve(output));
      });
      const durationMatch = /Duration:\s*(\d+):(\d+):([\d.]+)/i.exec(stderr);
      const duration = durationMatch
        ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
        : null;
      const sizeMatch = /,\s*(\d{2,5})x(\d{2,5})(?:[,\s]|$)/.exec(stderr);
      const size = sizeMatch ? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) } : null;
      return { duration: duration && Number.isFinite(duration) && duration > 0 ? duration : null, size };
    } catch (error) {
      console.warn('[Finalize workflow video] Could not read local media metadata:', error);
      return { duration: null, size: null };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  })();
  localProbeCache.set(url, probe);
  return probe;
}

async function probeDuration(url: string): Promise<number | null> {
  return (await probeLocalMedia(url)).duration;
}

function readDuration(payload: Record<string, unknown>): number | null {
  const durationValue = (value: unknown): number | null => {
    const parsed = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const containers = [payload, payload.data, payload.output, payload.result];
  for (const container of containers) {
    if (!isRecord(container)) continue;
    const direct = durationValue(container.duration);
    if (direct) return direct;
    const metadata = container.metadata;
    const metadataDuration = isRecord(metadata) ? durationValue(metadata.duration) : null;
    if (metadataDuration) return metadataDuration;
    const video = container.video;
    const videoDuration = isRecord(video) ? durationValue(video.duration) : null;
    if (videoDuration) return videoDuration;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Frame sizing
// ---------------------------------------------------------------------------

/** The metadata payload nests width/height differently across shapes. */
function readFrameSize(payload: Record<string, unknown>): FrameSize | null {
  const roots: unknown[] = [payload, payload.data, payload.media, payload.output];
  for (const root of roots) {
    if (!isRecord(root)) continue;
    const candidates: unknown[] = [root, root.media, root.video, root.resolution];
    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue;
      const nested = isRecord(candidate.resolution) ? candidate.resolution : candidate;
      const width = readPositiveInt(nested.width);
      const height = readPositiveInt(nested.height);
      if (width && height) return { width, height };
    }
  }
  return null;
}

async function probeFrameSize(url: string): Promise<FrameSize | null> {
  return (await probeLocalMedia(url)).size;
}

const makeEven = (value: number) => (value % 2 === 0 ? value : value + 1);

/**
 * Clamps the first shot's frame into the range the merge provider accepts,
 * keeping its aspect ratio. Most real clips (720x1280, 1080x1920, 1280x720)
 * pass through untouched.
 */
function normalizeTargetSize(size: FrameSize): FrameSize {
  let { width, height } = size;
  const longest = Math.max(width, height);
  if (longest > MAX_FRAME_SIDE) {
    const scale = MAX_FRAME_SIDE / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const shortest = Math.min(width, height);
  if (shortest < MIN_FRAME_SIDE) {
    const scale = MIN_FRAME_SIDE / shortest;
    width = Math.min(MAX_FRAME_SIDE, Math.round(width * scale));
    height = Math.min(MAX_FRAME_SIDE, Math.round(height * scale));
  }
  return { width: makeEven(width), height: makeEven(height) };
}

const sameFrame = (a: FrameSize | null, b: FrameSize): boolean =>
  Boolean(a) && a!.width === b.width && a!.height === b.height;

// ---------------------------------------------------------------------------
// Checkpointing
// ---------------------------------------------------------------------------

function readAssemblyState(
  value: unknown,
  clipCount: number,
  expectedVersion: 1 | 2 | 3 | 4 | 5,
  expectedFingerprint: string | null,
): AssemblyState | null {
  if (!isRecord(value) || value.version !== expectedVersion) return null;
  const retimed = value.retimed;
  const needsPadding = value.needsPadding;
  const padded = value.padded;
  const padJobs = value.padJobs;
  if (!Array.isArray(padded) || !Array.isArray(padJobs)) return null;
  // A checkpoint that does not describe this run's clip list is not resumable.
  if (padded.length !== clipCount || padJobs.length !== clipCount) return null;
  if (expectedVersion >= 3 && (
    !Array.isArray(retimed)
    || retimed.length !== clipCount
    || !Array.isArray(needsPadding)
    || needsPadding.length !== clipCount
    || needsPadding.some((entry) => typeof entry !== 'boolean')
  )) return null;
  const phase = value.phase;
  if (phase !== 'retiming' && phase !== 'padding' && phase !== 'merging' && phase !== 'mixing' && phase !== 'storing') return null;
  if (phase === 'retiming' && expectedVersion < 3) return null;
  const inputFingerprint = readString(value.inputFingerprint);
  if (expectedVersion >= 2 && inputFingerprint !== expectedFingerprint) return null;

  const readJob = (job: unknown): QueuedJob | null => {
    if (!isRecord(job)) return null;
    const statusUrl = readString(job.statusUrl);
    const responseUrl = readString(job.responseUrl);
    return statusUrl && responseUrl ? { statusUrl, responseUrl } : null;
  };

  const target = isRecord(value.target)
    ? (() => {
        const width = readPositiveInt(value.target.width);
        const height = readPositiveInt(value.target.height);
        return width && height ? { width, height } : null;
      })()
    : null;

  return {
    version: expectedVersion,
    phase,
    target,
    retimed: expectedVersion >= 3
      ? (retimed as unknown[]).map((entry) => readString(entry))
      : Array.from({ length: clipCount }, () => null),
    needsPadding: expectedVersion >= 3
      ? needsPadding as boolean[]
      : Array.from({ length: clipCount }, () => false),
    padded: padded.map((entry) => readString(entry)),
    padJobs: padJobs.map(readJob),
    mergeJob: readJob(value.mergeJob),
    mixJob: readJob(value.mixJob),
    mergedUrl: readString(value.mergedUrl),
    mergedDuration: typeof value.mergedDuration === 'number' ? value.mergedDuration : null,
    retimedCount: typeof value.retimedCount === 'number' ? value.retimedCount : 0,
    paddedCount: typeof value.paddedCount === 'number' ? value.paddedCount : 0,
    inputFingerprint,
  };
}

async function saveAssemblyState(
  supabase: SupabaseClient,
  runId: string,
  state: AssemblyState | null,
): Promise<void> {
  const { error } = await supabase
    .from('template_runs')
    .update({ assembly_state: state })
    .eq('id', runId);
  if (error) {
    // A lost checkpoint costs a repeated provider call on the next attempt; it
    // is not worth failing an otherwise healthy assembly over.
    console.warn('[Finalize workflow video] Could not save the assembly checkpoint:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Poster + re-hosting
// ---------------------------------------------------------------------------

async function extractPoster(
  supabase: SupabaseClient,
  videoUrl: string,
  storagePath: string,
): Promise<string | null> {
  const workDir = await mkdtemp(join(tmpdir(), 'lazora-poster-'));
  const inputPath = join(workDir, 'input.mp4');
  const outputPath = join(workDir, 'poster.jpg');
  try {
    const response = await fetch(videoUrl);
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get('content-length') || '0');
    if (declaredLength > MAX_REHOST_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REHOST_BYTES) return null;
    await writeFile(inputPath, bytes);
    await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ], 30_000);
    const posterBytes = await readFile(outputPath);
    const { error } = await supabase.storage
      .from(FINAL_VIDEO_BUCKET)
      .upload(storagePath, posterBytes, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      });
    if (error) return null;
    const { data } = supabase.storage.from(FINAL_VIDEO_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl || null;
  } catch (error) {
    console.warn('[Finalize workflow video] Could not create a local poster:', error);
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function rehost(
  supabase: SupabaseClient,
  sourceUrl: string,
  storagePath: string,
  fallbackContentType: string,
): Promise<string | null> {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get('content-length') || '0');
    if (declaredLength > MAX_REHOST_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REHOST_BYTES) return null;
    const contentType = response.headers.get('content-type') || fallbackContentType;
    const { error } = await supabase.storage
      .from(FINAL_VIDEO_BUCKET)
      .upload(storagePath, bytes, {
        contentType,
        cacheControl: '31536000',
        upsert: true,
      });
    if (error) return null;
    const { data } = supabase.storage.from(FINAL_VIDEO_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Files the joined video in the user's own history.
 *
 * Without this the deliverable existed only on the run row: reachable from the
 * dock until it was dismissed, then gone, while the individual shots stayed in
 * the dashboard forever. The finished piece is the one thing a user is certain
 * to come back for.
 *
 * It shares template_run_id with the run's step results, which is what makes
 * the dashboard fold the whole run into one card with the joined video on top.
 *
 * Written here rather than in the browser so the row exists even if the tab is
 * closed the moment assembly finishes. Best-effort: a run that has its video is
 * a successful run, and a history row that failed to write must not turn that
 * into an error the user sees.
 */
async function recordFinalVideoInHistory(
  supabase: SupabaseClient,
  params: {
    userId: string;
    runId: string;
    templateId: string;
    videoUrl: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    stepIds: string[];
  },
): Promise<void> {
  try {
    const { data: template } = await supabase
      .from('templates')
      .select('name,display_name')
      .eq('id', params.templateId)
      .maybeSingle();
    const templateName = template
      ? readString((template as Record<string, unknown>).display_name)
        || readString((template as Record<string, unknown>).name)
      : null;

    const { error } = await supabase.from('generations').insert({
      user_id: params.userId,
      template_id: params.templateId,
      template_name: templateName,
      // image_url is the table's required media column; for a video row the
      // poster is the useful still, with the video itself as the fallback.
      image_url: params.thumbnailUrl || params.videoUrl,
      thumbnail_url: params.thumbnailUrl,
      prompt: `Final video from ${params.stepIds.length} shots`,
      // The shots were already charged. Joining them costs the user nothing.
      credits_used: 0,
      media_type: 'video',
      video_url: params.videoUrl,
      video_duration: params.durationSeconds,
      // Not a capability: this row is an assembly of other rows' output, and
      // the capability column is a closed list the workflow registry mirrors.
      capability: null,
      input_assets: [],
      generation_parameters: { finalVideo: true, stepIds: params.stepIds },
      request_id: `final-video:${params.runId}`,
      template_run_id: params.runId,
    });
    // 23505 = the one-final-video-per-run index did its job on a concurrent call.
    if (error && error.code !== '23505') {
      console.warn('[Finalize workflow video] Could not file the final video in history:', error.message);
    }
  } catch (error) {
    console.warn('[Finalize workflow video] Could not file the final video in history:', error);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed.');
  if (!supabaseUrl || !supabaseServiceKey) {
    return sendError(res, 500, 'Supabase server credentials are missing.');
  }

  const startedAt = Date.now();
  const budgetRemaining = () => INVOCATION_BUDGET_MS - (Date.now() - startedAt);

  const authHeader = headerValue(req.headers.authorization);
  if (!authHeader?.startsWith('Bearer ')) {
    return sendError(res, 401, 'Authentication required.');
  }
  const { runId, resultChoices } = readBody(req.body);
  if (!runId) return sendError(res, 400, 'runId is required.');

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let checkpointToClear = false;

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) return sendError(res, 401, 'Invalid or expired session.');

    const { data: runData, error: runError } = await supabase
      .from('template_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle();
    if (runError) throw runError;
    const run = runData as RunRow | null;
    if (!run) return sendError(res, 404, 'Workflow run not found.');
    if (runOwnerId(run) !== user.id) {
      return sendError(res, 403, 'This workflow run does not belong to you.');
    }

    // Assembly is idempotent: a repeated call returns the stored deliverable
    // rather than paying for a second merge.
    const existing = readString(run.final_video_url);
    if (existing) {
      return res.status(200).json({
        success: true,
        status: 'ready',
        assembled: true,
        cached: true,
        finalVideoUrl: existing,
        thumbnailUrl: readString(run.final_thumbnail_url),
        stepIds: Array.isArray(run.final_video_step_ids) ? run.final_video_step_ids : [],
      });
    }

    const templateId = readString(run.template_id);
    const versionId = readString(run.template_version_id) || readString(run.version_id);
    if (!templateId || !versionId) {
      return sendError(res, 422, 'This run is not linked to a published template version.');
    }

    const { data: versionData, error: versionError } = await supabase
      .from('template_versions')
      .select('workflow,quick_use_definition')
      .eq('id', versionId)
      .eq('template_id', templateId)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!versionData) return sendError(res, 404, 'The locked template version could not be loaded.');

    const workflow = versionData.workflow ?? run.workflow;
    const timeline = readTimelineDefinition(versionData.quick_use_definition);
    const legacyStepIds = timeline ? [] : selectFinalVideoStepIds(workflow, versionData.quick_use_definition);
    const stepIds = timeline ? timeline.videoClips.map((clip) => clip.id) : legacyStepIds;
    if (!timeline && legacyStepIds.length < MIN_CLIPS) {
      // Not an error: this template simply delivers its last step result.
      return res.status(200).json({
        success: true,
        status: 'ready',
        assembled: false,
        reason: 'not_configured',
        finalVideoUrl: null,
        stepIds: [],
      });
    }

    const clips = timeline
      ? await resolveTimelineSources(
          supabase,
          runId,
          templateId,
          versionId,
          timeline.videoClips.map((clip) => clip.source),
          'video',
          resultChoices,
          timeline.resultChoices,
        )
      : await resolveClipUrls(supabase, runId, legacyStepIds);
    const audioClips = timeline
      ? await resolveTimelineSources(
          supabase,
          runId,
          templateId,
          versionId,
          timeline.audioClips.map((clip) => clip.source),
          'audio',
          resultChoices,
          timeline.resultChoices,
        )
      : [];
    const clipUrls = await Promise.all(clips.map((clip) => ensureFetchableUrl(supabase, clip.url)));
    const durationScales = timeline
      ? timeline.videoClips.map((clip) => clip.durationScale)
      : clipUrls.map(() => 1);
    const hasRetimedClips = durationScales.some((scale) => scale !== 1);
    const preparedStoragePaths = durationScales.map((_, index) => (
      `${user.id}/${runId}/prepared-${index + 1}.mp4`
    ));
    const inputFingerprint = timeline ? timelineFingerprint(timeline) : null;
    // Version 5 normalizes every timeline clip's sample aspect ratio before
    // concatenation. This
    // invalidates older timeline checkpoints that may still contain mixed
    // channel layouts or broken timestamps.
    const stateVersion: 1 | 2 | 3 | 4 | 5 = timeline ? 5 : 1;
    checkpointToClear = true;

    let state = readAssemblyState(run.assembly_state, clipUrls.length, stateVersion, inputFingerprint);
    const pendingResponse = async (phase: AssemblyPhase) => {
      await saveAssemblyState(supabase, runId, state);
      return res.status(200).json({
        success: true,
        status: 'pending',
        phase,
        assembled: false,
        finalVideoUrl: null,
        stepIds,
      });
    };

    if (!state) {
      // First invocation for this run: decide the frame, then work out which
      // clips actually need padding. Probing is a handful of fast calls.
      const sizes = await Promise.all(clipUrls.map(probeFrameSize));
      const target = sizes[0] ? normalizeTargetSize(sizes[0]) : null;
      const needsPadding = clipUrls.map((_, index) => Boolean(target && !sameFrame(sizes[index], target)));
      state = {
        version: stateVersion,
        phase: timeline ? 'retiming' : 'padding',
        target,
        retimed: clipUrls.map(() => null),
        needsPadding,
        // A clip whose metadata could not be read is padded rather than assumed
        // to match: guessing is the one path that silently stretches a shot.
        padded: clipUrls.map((url, index) => (
          !timeline && (!target || !needsPadding[index]) ? url : null
        )),
        padJobs: clipUrls.map(() => null),
        mergeJob: null,
        mixJob: null,
        mergedUrl: null,
        mergedDuration: null,
        retimedCount: 0,
        paddedCount: 0,
        inputFingerprint,
      };
      await saveAssemblyState(supabase, runId, state);
    }

    // ---- the resumable machine -------------------------------------------
    for (;;) {
      if (state.phase === 'retiming') {
        for (let index = 0; index < clipUrls.length; index += 1) {
          if (state.retimed[index]) continue;
          // Retime one clip per invocation when the earlier work has consumed
          // most of the safe budget. Each completed copy is checkpointed.
          if (budgetRemaining() < 15_000) return pendingResponse('retiming');
          const retimedUrl = await prepareClip(
            supabase,
            clipUrls[index],
            durationScales[index],
            preparedStoragePaths[index],
            state.target && state.needsPadding[index] ? state.target : null,
          );
          state.retimed[index] = retimedUrl;
          state.padded[index] = retimedUrl;
          state.retimedCount += 1;
          await saveAssemblyState(supabase, runId, state);
        }
        state.phase = 'padding';
        await saveAssemblyState(supabase, runId, state);
        continue;
      }

      if (state.phase === 'padding') {
        for (let index = 0; index < clipUrls.length; index += 1) {
          if (state.padded[index] || state.padJobs[index]) continue;
          const assemblyClipUrl = state.retimed[index] || clipUrls[index];
          state.padJobs[index] = await falSubmit(FAL_SCALE_ENDPOINT, {
            video_url: assemblyClipUrl,
            width: state.target!.width,
            height: state.target!.height,
            mode: 'pad',
            pad_color: 'black',
          }, 'Clip padding');
          state.paddedCount += 1;
          await saveAssemblyState(supabase, runId, state);
        }

        let stillRunning = false;
        for (let index = 0; index < clipUrls.length; index += 1) {
          const job = state.padJobs[index];
          if (state.padded[index] || !job) continue;
          const result = await falPoll(job, 'Clip padding');
          if (!result) {
            stillRunning = true;
            continue;
          }
          const url = firstVideoUrl(result);
          if (!url) throw new Error('Clip padding returned no video.');
          state.padded[index] = url;
        }

        if (!stillRunning) {
          state.phase = 'merging';
          await saveAssemblyState(supabase, runId, state);
          continue;
        }
        if (budgetRemaining() < POLL_INTERVAL_MS * 2) return pendingResponse('padding');
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      if (state.phase === 'merging') {
        const videoUrls = state.padded.filter((url): url is string => Boolean(url));
        if (videoUrls.length !== clipUrls.length) {
          throw new Error('A padded clip went missing before the merge.');
        }
        if (videoUrls.length === 1) {
          state.mergedUrl = videoUrls[0];
          state.mergedDuration = state.mergedDuration || await probeDuration(videoUrls[0]);
          state.phase = timeline && audioClips.length > 0 ? 'mixing' : 'storing';
          await saveAssemblyState(supabase, runId, state);
          continue;
        }
        if (!timeline) {
          if (!state.mergeJob) {
            state.mergeJob = await falSubmit(FAL_MERGE_ENDPOINT, state.target
              ? { video_urls: videoUrls, resolution: { width: state.target.width, height: state.target.height } }
              : { video_urls: videoUrls, resolution_aspect_ratio_video_index: 0 },
              'Video merge');
            await saveAssemblyState(supabase, runId, state);
          }
          const result = await falPoll(state.mergeJob, 'Video merge');
          if (result) {
            const url = firstVideoUrl(result);
            if (!url) throw new Error('The merge provider returned no video.');
            state.mergedUrl = url;
            state.mergedDuration = readDuration(result) || await probeDuration(url);
            state.phase = 'storing';
            await saveAssemblyState(supabase, runId, state);
            continue;
          }
          if (budgetRemaining() < POLL_INTERVAL_MS * 2) return pendingResponse('merging');
          await delay(POLL_INTERVAL_MS);
          continue;
        }
        if (budgetRemaining() < 20_000) return pendingResponse('merging');
        const url = await mergePreparedClips(
          supabase,
          videoUrls,
          `${user.id}/${runId}/merged-local.mp4`,
        );
        state.mergedUrl = url;
        state.mergedDuration = await probeDuration(url);
        state.phase = timeline && audioClips.length > 0 ? 'mixing' : 'storing';
        await saveAssemblyState(supabase, runId, state);
        continue;
      }

      if (state.phase === 'mixing') {
        if (!timeline || audioClips.length === 0) {
          state.phase = 'storing';
          await saveAssemblyState(supabase, runId, state);
          continue;
        }
        if (!state.mergedUrl) throw new Error('The merged video went missing before audio mixing.');
        const mergedDurationMs = Math.max(1, Math.round((state.mergedDuration || await probeDuration(state.mergedUrl) || 1) * 1000));
        if (!state.mixJob) {
          const audioDurations = await Promise.all(audioClips.map((clip) => probeDuration(clip.url)));
          state.mixJob = await falSubmit(FAL_COMPOSE_ENDPOINT, {
            tracks: [
              {
                id: 'video',
                type: 'video',
                keyframes: [{ timestamp: 0, duration: mergedDurationMs, url: state.mergedUrl }],
              },
              // fal compose ignores a video's implicit sound when explicit
              // audio tracks exist. Re-adding the merged video as audio keeps
              // every source clip's original soundtrack audible.
              {
                id: 'original-video-audio',
                type: 'audio',
                keyframes: [{ timestamp: 0, duration: mergedDurationMs, url: state.mergedUrl }],
              },
              ...audioClips.map((clip, index) => ({
                id: `audio-${index + 1}`,
                type: 'audio',
                keyframes: [{
                  timestamp: timeline.audioClips[index].startMs,
                  duration: Math.max(1, Math.round((audioDurations[index] || mergedDurationMs / 1000) * 1000)),
                  url: clip.url,
                }],
              })),
            ],
          }, 'Audio mix');
          await saveAssemblyState(supabase, runId, state);
        }
        const result = await falPoll(state.mixJob, 'Audio mix');
        if (result) {
          const url = firstVideoUrl(result);
          if (!url) throw new Error('The audio mixer returned no video.');
          state.mergedUrl = url;
          state.mergedDuration = readDuration(result) || state.mergedDuration;
          state.phase = 'storing';
          await saveAssemblyState(supabase, runId, state);
          continue;
        }
        if (budgetRemaining() < POLL_INTERVAL_MS * 2) return pendingResponse('mixing');
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      // storing
      if (!state.mergedUrl) throw new Error('The merged video went missing before it could be stored.');
      // Downloading and re-uploading the file is the one step that cannot be
      // resumed mid-way, so it only starts with room to finish.
      if (budgetRemaining() < STORING_RESERVE_MS) return pendingResponse('storing');

      const hostedVideoUrl = await rehost(
        supabase,
        state.mergedUrl,
        `${user.id}/${runId}/final.mp4`,
        'video/mp4',
      );
      const finalVideoUrl = hostedVideoUrl || state.mergedUrl;

      const finalThumbnailUrl = await extractPoster(
        supabase,
        finalVideoUrl,
        `${user.id}/${runId}/final-poster.jpg`,
      );

      const { error: updateError } = await supabase
        .from('template_runs')
        .update({
          final_media_type: 'video',
          final_video_url: finalVideoUrl,
          final_thumbnail_url: finalThumbnailUrl,
          final_video_step_ids: stepIds,
          final_video_duration_seconds: state.mergedDuration,
          assembled_at: new Date().toISOString(),
          assembly_state: null,
        })
        .eq('id', runId);
      if (updateError) throw updateError;
      checkpointToClear = false;

      await recordFinalVideoInHistory(supabase, {
        userId: user.id,
        runId,
        templateId,
        videoUrl: finalVideoUrl,
        thumbnailUrl: finalThumbnailUrl,
        durationSeconds: state.mergedDuration,
        stepIds,
      });

      if (timeline && hostedVideoUrl) {
        const temporaryPaths = [...preparedStoragePaths, `${user.id}/${runId}/merged-local.mp4`];
        const { error: cleanupError } = await supabase.storage
          .from(FINAL_VIDEO_BUCKET)
          .remove(temporaryPaths);
        if (cleanupError) {
          console.warn('[Finalize workflow video] Could not remove assembly-only prepared clips:', cleanupError.message);
        }
      }

      return res.status(200).json({
        success: true,
        status: 'ready',
        assembled: true,
        cached: false,
        finalVideoUrl,
        thumbnailUrl: finalThumbnailUrl,
        durationSeconds: state.mergedDuration,
        frame: state.target,
        retimedClipCount: hasRetimedClips
          ? durationScales.filter((scale) => scale !== 1).length
          : 0,
        paddedClipCount: state.paddedCount,
        stepIds,
        clips: clips.map((clip, index) => ({
          stepId: timeline?.videoClips[index]?.id || clip.stepId,
          order: index + 1,
          executionMode: clip.executionMode,
          durationScale: timeline?.videoClips[index]?.durationScale || 1,
        })),
      });
    }
  } catch (error) {
    console.error('[Finalize workflow video] Failed:', error);
    // Drop the checkpoint on a hard failure. Resuming onto a job that already
    // errored would fail identically on every retry, forever.
    if (checkpointToClear) await saveAssemblyState(supabase, runId, null);
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Could not assemble the final video.',
    );
  }
}
