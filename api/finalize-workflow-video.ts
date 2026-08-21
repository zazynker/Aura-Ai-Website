import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
const FAL_SCALE_ENDPOINT = 'fal-ai/workflow-utilities/scale-video';
const FAL_METADATA_ENDPOINT = 'fal-ai/ffmpeg-api/metadata';
const FAL_EXTRACT_FRAME_URL = 'https://fal.run/fal-ai/ffmpeg-api/extract-frame';
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

type AssemblyPhase = 'padding' | 'merging' | 'storing';

interface AssemblyState {
  version: 1;
  phase: AssemblyPhase;
  /** null when clip metadata was unreadable and the provider must choose. */
  target: FrameSize | null;
  /** Resolved clip URL per position, or null while its pad job is running. */
  padded: (string | null)[];
  /** Pad job per position, or null when that clip needed no padding. */
  padJobs: (QueuedJob | null)[];
  mergeJob: QueuedJob | null;
  mergedUrl: string | null;
  mergedDuration: number | null;
  paddedCount: number;
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

function readBody(body: unknown): { runId: string } {
  if (typeof body === 'string') {
    try {
      return readBody(JSON.parse(body));
    } catch {
      return { runId: '' };
    }
  }
  if (!isRecord(body)) return { runId: '' };
  return { runId: readString(body.runId) || '' };
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

function readDuration(payload: Record<string, unknown>): number | null {
  const containers = [payload, payload.data, payload.output, payload.result];
  for (const container of containers) {
    if (!isRecord(container)) continue;
    const metadata = container.metadata;
    if (isRecord(metadata) && typeof metadata.duration === 'number') return metadata.duration;
    const video = container.video;
    if (isRecord(video) && typeof video.duration === 'number') return video.duration;
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
  try {
    return readFrameSize(await falRun(FAL_METADATA_ENDPOINT, { media_url: url }));
  } catch (error) {
    console.warn('[Finalize workflow video] Could not read clip metadata:', error);
    return null;
  }
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

function readAssemblyState(value: unknown, clipCount: number): AssemblyState | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const padded = value.padded;
  const padJobs = value.padJobs;
  if (!Array.isArray(padded) || !Array.isArray(padJobs)) return null;
  // A checkpoint that does not describe this run's clip list is not resumable.
  if (padded.length !== clipCount || padJobs.length !== clipCount) return null;
  const phase = value.phase;
  if (phase !== 'padding' && phase !== 'merging' && phase !== 'storing') return null;

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
    version: 1,
    phase,
    target,
    padded: padded.map((entry) => readString(entry)),
    padJobs: padJobs.map(readJob),
    mergeJob: readJob(value.mergeJob),
    mergedUrl: readString(value.mergedUrl),
    mergedDuration: typeof value.mergedDuration === 'number' ? value.mergedDuration : null,
    paddedCount: typeof value.paddedCount === 'number' ? value.paddedCount : 0,
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

async function extractPoster(videoUrl: string): Promise<string | null> {
  if (!falKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(FAL_EXTRACT_FRAME_URL, {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl, frame_type: 'first' }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await readJson(response);
    const images = payload.images;
    if (!Array.isArray(images) || !isRecord(images[0])) return null;
    return readString(images[0].url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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
  const { runId } = readBody(req.body);
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
    const stepIds = selectFinalVideoStepIds(workflow, versionData.quick_use_definition);
    if (stepIds.length < MIN_CLIPS) {
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

    const clips = await resolveClipUrls(supabase, runId, stepIds);
    const clipUrls = await Promise.all(
      clips.map((clip) => ensureFetchableUrl(supabase, clip.url)),
    );
    checkpointToClear = true;

    let state = readAssemblyState(run.assembly_state, clipUrls.length);
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
      state = {
        version: 1,
        phase: 'padding',
        target,
        // A clip whose metadata could not be read is padded rather than assumed
        // to match: guessing is the one path that silently stretches a shot.
        padded: clipUrls.map((url, index) => (
          !target || sameFrame(sizes[index], target) ? url : null
        )),
        padJobs: clipUrls.map(() => null),
        mergeJob: null,
        mergedUrl: null,
        mergedDuration: null,
        paddedCount: 0,
      };
      await saveAssemblyState(supabase, runId, state);
    }

    // ---- the resumable machine -------------------------------------------
    for (;;) {
      if (state.phase === 'padding') {
        for (let index = 0; index < clipUrls.length; index += 1) {
          if (state.padded[index] || state.padJobs[index]) continue;
          state.padJobs[index] = await falSubmit(FAL_SCALE_ENDPOINT, {
            video_url: clipUrls[index],
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
        if (!state.mergeJob) {
          const videoUrls = state.padded.filter((url): url is string => Boolean(url));
          if (videoUrls.length !== clipUrls.length) {
            throw new Error('A padded clip went missing before the merge.');
          }
          state.mergeJob = await falSubmit(FAL_MERGE_ENDPOINT, state.target
            ? { video_urls: videoUrls, resolution: { width: state.target.width, height: state.target.height } }
            // Without a known frame the provider picks, taking the first clip's
            // aspect ratio. Clips may be stretched in that case, but the run
            // still gets a deliverable.
            : { video_urls: videoUrls, resolution_aspect_ratio_video_index: 0 },
            'Video merge');
          await saveAssemblyState(supabase, runId, state);
        }

        const result = await falPoll(state.mergeJob, 'Video merge');
        if (result) {
          const url = firstVideoUrl(result);
          if (!url) throw new Error('The merge provider returned no video.');
          state.mergedUrl = url;
          state.mergedDuration = readDuration(result);
          state.phase = 'storing';
          await saveAssemblyState(supabase, runId, state);
          continue;
        }
        if (budgetRemaining() < POLL_INTERVAL_MS * 2) return pendingResponse('merging');
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

      const posterSource = await extractPoster(finalVideoUrl);
      const finalThumbnailUrl = posterSource
        ? (await rehost(supabase, posterSource, `${user.id}/${runId}/final-poster.jpg`, 'image/jpeg')) || posterSource
        : null;

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

      return res.status(200).json({
        success: true,
        status: 'ready',
        assembled: true,
        cached: false,
        finalVideoUrl,
        thumbnailUrl: finalThumbnailUrl,
        durationSeconds: state.mergedDuration,
        frame: state.target,
        paddedClipCount: state.paddedCount,
        stepIds,
        clips: clips.map((clip) => ({
          stepId: clip.stepId,
          order: clip.order,
          executionMode: clip.executionMode,
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
