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
 */

export const config = { maxDuration: 300 };

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const falKey = process.env.FAL_KEY;

const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';
const FAL_MERGE_ENDPOINT = 'fal-ai/ffmpeg-api/merge-videos';
const FAL_EXTRACT_FRAME_URL = 'https://fal.run/fal-ai/ffmpeg-api/extract-frame';
const FINAL_VIDEO_BUCKET = 'workflow-final-videos';

/** Mirrors QUICK_USE_FINAL_VIDEO_MIN_CLIPS / MAX_CLIPS in src/workflows. */
const MIN_CLIPS = 2;
const MAX_CLIPS = 8;

/** Above this we keep the provider URL instead of buffering the file. */
const MAX_REHOST_BYTES = 300 * 1024 * 1024;

const MERGE_POLL_INTERVAL_MS = 3_000;
const MERGE_TIMEOUT_MS = 240_000;

type RunRow = Record<string, unknown>;

interface WorkflowStepSummary {
  id: string;
  order: number;
  assetType: string;
}

interface ClipSource {
  stepId: string;
  order: number;
  url: string;
  executionMode: string;
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
 * src/workflows/quickUseFinalVideo.ts. Kept inline so this serverless function
 * has no build-time dependency on the browser bundle; the rules must stay
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

/**
 * template_run_steps carries either run_id or template_run_id depending on the
 * baseline the project was created from. Try the common name, fall back once.
 */
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
      const url = readString((generation as Record<string, unknown>).video_url)
        || readString((generation as Record<string, unknown>).image_url);
      const id = readString((generation as Record<string, unknown>).id);
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
 * a window that comfortably outlives the merge.
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
    .createSignedUrl(decodeURIComponent(path), 60 * 60);
  if (error || !data?.signedUrl) return url;
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Fal merge
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

function mergedVideoUrl(payload: Record<string, unknown>): string | null {
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

function mergedDuration(payload: Record<string, unknown>): number | null {
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

async function mergeVideos(videoUrls: string[]): Promise<{ url: string; duration: number | null }> {
  if (!falKey) throw new Error('FAL_KEY is missing.');

  const submission = await fetch(`${FAL_QUEUE_BASE_URL}/${FAL_MERGE_ENDPOINT}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_urls: videoUrls,
      // Take the first clip's frame as the canvas. Every clip is normalised to
      // it, so a 9:16 opener is never letterboxed into a 16:9 canvas.
      resolution_aspect_ratio_video_index: 0,
    }),
  });
  const submitted = await readJson(submission);
  if (!submission.ok) {
    throw new Error(`Video merge could not start (${submission.status}): ${String(submitted.detail || submitted.message || submission.statusText)}`);
  }
  const requestId = readString(submitted.request_id);
  if (!requestId) throw new Error('The merge provider returned no request id.');
  const statusUrl = readString(submitted.status_url)
    || `${FAL_QUEUE_BASE_URL}/${FAL_MERGE_ENDPOINT}/requests/${requestId}/status`;
  const responseUrl = readString(submitted.response_url)
    || `${FAL_QUEUE_BASE_URL}/${FAL_MERGE_ENDPOINT}/requests/${requestId}`;

  const deadline = Date.now() + MERGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(MERGE_POLL_INTERVAL_MS);
    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: `Key ${falKey}` },
    });
    const statusPayload = await readJson(statusResponse);
    if (!statusResponse.ok) {
      throw new Error(`Video merge status failed (${statusResponse.status}).`);
    }
    const status = normalizeFalQueueStatus(statusPayload);
    if (status === 'COMPLETED') {
      const resultResponse = await fetch(responseUrl, {
        headers: { Authorization: `Key ${falKey}` },
      });
      const resultPayload = await readJson(resultResponse);
      if (!resultResponse.ok) {
        throw new Error(`Video merge result failed (${resultResponse.status}).`);
      }
      const url = mergedVideoUrl(resultPayload);
      if (!url) throw new Error('The merge provider returned no video.');
      return { url, duration: mergedDuration(resultPayload) };
    }
    if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) {
      throw new Error(`Video merge ${status.toLowerCase()}.`);
    }
  }
  throw new Error('Video merge timed out.');
}

async function extractPoster(videoUrl: string): Promise<string | null> {
  if (!falKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(FAL_EXTRACT_FRAME_URL, {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
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

// ---------------------------------------------------------------------------
// Re-hosting
// ---------------------------------------------------------------------------

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
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed.');
  if (!supabaseUrl || !supabaseServiceKey) {
    return sendError(res, 500, 'Supabase server credentials are missing.');
  }

  const authHeader = headerValue(req.headers.authorization);
  if (!authHeader?.startsWith('Bearer ')) {
    return sendError(res, 401, 'Authentication required.');
  }
  const { runId } = readBody(req.body);
  if (!runId) return sendError(res, 400, 'runId is required.');

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
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
        assembled: false,
        finalVideoUrl: null,
        stepIds: [],
      });
    }

    const clips = await resolveClipUrls(supabase, runId, stepIds);
    const fetchableUrls = await Promise.all(
      clips.map((clip) => ensureFetchableUrl(supabase, clip.url)),
    );

    const merged = await mergeVideos(fetchableUrls);
    const ownerId = user.id;
    const hostedVideoUrl = await rehost(
      supabase,
      merged.url,
      `${ownerId}/${runId}/final.mp4`,
      'video/mp4',
    );
    const finalVideoUrl = hostedVideoUrl || merged.url;

    const posterSource = await extractPoster(finalVideoUrl);
    const finalThumbnailUrl = posterSource
      ? (await rehost(supabase, posterSource, `${ownerId}/${runId}/final-poster.jpg`, 'image/jpeg')) || posterSource
      : null;

    const { error: updateError } = await supabase
      .from('template_runs')
      .update({
        final_media_type: 'video',
        final_video_url: finalVideoUrl,
        final_thumbnail_url: finalThumbnailUrl,
        final_video_step_ids: stepIds,
        final_video_duration_seconds: merged.duration,
        assembled_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      assembled: true,
      cached: false,
      finalVideoUrl,
      thumbnailUrl: finalThumbnailUrl,
      durationSeconds: merged.duration,
      stepIds,
      clips: clips.map((clip) => ({
        stepId: clip.stepId,
        order: clip.order,
        executionMode: clip.executionMode,
      })),
    });
  } catch (error) {
    console.error('[Finalize workflow video] Failed:', error);
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Could not assemble the final video.',
    );
  }
}
