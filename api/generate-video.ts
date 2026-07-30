import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type VideoMode = 'image_to_video' | 'motion_control' | 'lip_sync';
type CharacterOrientation = 'video' | 'image';

type RequestBody = {
  mode?: VideoMode;
  prompt?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  duration?: number;
  resolution?: '720p' | '1080p';
  characterOrientation?: CharacterOrientation;
  generationCount?: number;
  requestedOutputCount?: number;
  generateAudio?: boolean;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
};

type FalSubmitResult = {
  requestId: string;
  statusUrl?: string;
  responseUrl?: string;
  cancelUrl?: string;
};

const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';

const KLING_IMAGE_TO_VIDEO_ENDPOINT =
  process.env.FAL_KLING_IMAGE_TO_VIDEO_ENDPOINT ||
  'fal-ai/kling-video/v3/standard/image-to-video';
const KLING_IMAGE_TO_VIDEO_PRO_ENDPOINT =
  process.env.FAL_KLING_IMAGE_TO_VIDEO_PRO_ENDPOINT ||
  'fal-ai/kling-video/v3/pro/image-to-video';

const KLING_MOTION_CONTROL_ENDPOINT =
  process.env.FAL_KLING_MOTION_CONTROL_ENDPOINT ||
  'fal-ai/kling-video/v3/standard/motion-control';
const KLING_MOTION_CONTROL_PRO_ENDPOINT =
  process.env.FAL_KLING_MOTION_CONTROL_PRO_ENDPOINT ||
  'fal-ai/kling-video/v3/pro/motion-control';

const KLING_LIP_SYNC_VIDEO_ENDPOINT =
  process.env.FAL_KLING_LIP_SYNC_VIDEO_ENDPOINT ||
  'fal-ai/kling-video/lipsync/audio-to-video';

const KLING_LIP_SYNC_IMAGE_ENDPOINT =
  process.env.FAL_KLING_LIP_SYNC_IMAGE_ENDPOINT ||
  'fal-ai/kling-video/ai-avatar/v2/standard';

function getKlingEndpoint(mode: VideoMode, body: RequestBody): string {
  if (mode === 'image_to_video') {
    return body.resolution === '1080p'
      ? KLING_IMAGE_TO_VIDEO_PRO_ENDPOINT
      : KLING_IMAGE_TO_VIDEO_ENDPOINT;
  }
  if (mode === 'motion_control') {
    return body.resolution === '1080p'
      ? KLING_MOTION_CONTROL_PRO_ENDPOINT
      : KLING_MOTION_CONTROL_ENDPOINT;
  }

  // Lip Sync has two Fal endpoints:
  // - image + audio: fal-ai/kling-video/ai-avatar/v2/standard
  // - video + audio: fal-ai/kling-video/lipsync/audio-to-video
  if (mode === 'lip_sync') {
    if (body.videoUrl) return KLING_LIP_SYNC_VIDEO_ENDPOINT;
    return KLING_LIP_SYNC_IMAGE_ENDPOINT;
  }

  throw new ApiError(400, 'INVALID_MODE', 'Unsupported video mode');
}

const MAX_PROMPT_LENGTH = 2000;
const USD_TO_CREDITS = 195;
const RATE_LIMIT_PER_MINUTE = 5;

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  try {
    const falKey = process.env.FAL_KEY;
    if (!falKey) {
      console.error('[generate-video] FAL_KEY not configured');
      return sendError(res, 500, 'CONFIG_ERROR', 'Fal API key not configured');
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[generate-video] Supabase credentials not configured');
      return sendError(res, 500, 'CONFIG_ERROR', 'Server configuration error');
    }

    const authHeader = getHeaderValue(req.headers.authorization);
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(res, 401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const token = authHeader.substring(7);

    const supabase = createClient(
      supabaseUrl as string,
      supabaseServiceKey as string
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('[generate-video] Auth verification failed:', authError?.message);
      return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired token');
    }

    console.log('[generate-video] Authenticated user:', user.id);

    const body = parseBody(req.body);

    const mode = body.mode;
    if (!mode || !isVideoMode(mode)) {
      return sendError(
        res,
        400,
        'INVALID_INPUT',
        'Invalid video mode. Must be image_to_video, motion_control, or lip_sync'
      );
    }

    const requestedOutputCount = validateRequestedOutputCount(mode, body);
    const endpoint = getKlingEndpoint(mode, body);
    const requiredCredits = estimateVideoCredits(mode, body);
    await checkRateLimit(supabase, user.id);
    const userData = await checkCredits(supabase, user.id, requiredCredits);
    assertProAccess(mode, body, requestedOutputCount, userData);
    const payload = buildFalPayload(mode, body);

    console.log('[generate-video] Submitting Fal job:', {
      mode,
      endpoint,
      userId: user.id,
      duration: body.duration,
      normalizedDuration: mode === 'image_to_video' ? normalizeDuration(body.duration) : undefined,
      resolution: body.resolution,
      requestedOutputCount,
      isWhitelisted: userData.is_whitelisted,
      payloadKeys: Object.keys(payload),
    });

    const falJob = await submitFalJob(endpoint, payload, falKey);

    let newCredits = userData.credits;
    let creditsDeducted = 0;
    let eligiblePaidCredits = 0;
    let creditDeductionId: string | undefined;
    {
      const { data: deductResult, error: deductError } = await supabase.rpc('deduct_generation_credits', {
        p_user_id: user.id,
        p_amount: requiredCredits,
        p_request_id: falJob.requestId,
        p_template_run_id: body.templateRunId || null,
        p_template_step_id: body.templateStepId || null,
        p_capability: body.templateCapability || null,
      });
      if (deductError || !deductResult?.success) {
        console.error('[generate-video] Credit settlement failed after Fal submission:', {
          userId: user.id,
          requestId: falJob.requestId,
          deductError: deductError?.message,
          deductCode: deductError?.code,
          deductDetails: deductError?.details,
          deductResult,
        });
        throw new ApiError(500, 'CREDIT_DEDUCTION_FAILED', 'Video was submitted but credit settlement failed.', { requestId: falJob.requestId });
      }
      creditsDeducted = Number(deductResult.credits_deducted) || 0;
      eligiblePaidCredits = Number(deductResult.eligible_paid_credits) || 0;
      creditDeductionId = typeof deductResult.deduction_id === 'string'
        ? deductResult.deduction_id
        : undefined;
      newCredits = Number(deductResult.new_balance ?? deductResult.new_credits ?? newCredits);
    }

    console.log('[generate-video] Fal request submitted:', {
      mode,
      creditsUsed: requiredCredits,
      creditsDeducted,
      eligiblePaidCredits,
      creditDeductionId,
      newCredits,
      endpoint,
      requestId: falJob.requestId,
      statusUrl: falJob.statusUrl,
      responseUrl: falJob.responseUrl,
      cancelUrl: falJob.cancelUrl,
    });

    return res.status(200).json({
      success: true,
      requestId: falJob.requestId,
      endpoint,
      statusUrl: falJob.statusUrl,
      responseUrl: falJob.responseUrl,
      cancelUrl: falJob.cancelUrl,
      mode,
      creditsUsed: requiredCredits,
      creditsDeducted,
      eligiblePaidCredits,
      creditDeductionId,
      newCredits,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error('[generate-video] ApiError:', {
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
        details: err.details,
      });

      return sendError(res, err.statusCode, err.code, err.message, err.details);
    }

    console.error('[generate-video] Unexpected error:', err);

    return sendError(
      res,
      500,
      'VIDEO_GENERATION_FAILED',
      err instanceof Error ? err.message : 'Video generation failed'
    );
  }
}

function parseBody(body: unknown): RequestBody {
  if (!body) return {};

  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as RequestBody;
    } catch {
      throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON request body');
    }
  }

  if (typeof body === 'object') {
    return body as RequestBody;
  }

  throw new ApiError(400, 'INVALID_INPUT', 'Invalid request body');
}

function isVideoMode(value: string): value is VideoMode {
  return value === 'image_to_video' || value === 'motion_control' || value === 'lip_sync';
}

function validateRequestedOutputCount(mode: VideoMode, body: RequestBody): number {
  const value = Number(body.requestedOutputCount ?? body.generationCount ?? 1);
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new ApiError(400, 'INVALID_OUTPUT_COUNT', 'Output count must be an integer from 1 to 4');
  }
  if (mode === 'lip_sync' && value !== 1) {
    throw new ApiError(400, 'MULTIPLE_OUTPUTS_UNSUPPORTED', 'Lip Sync supports one output per request');
  }
  return value;
}

function assertProAccess(
  mode: VideoMode,
  body: RequestBody,
  requestedOutputCount: number,
  userData: { plan?: unknown; is_whitelisted: boolean },
) {
  const hasProAccess =
    String(userData.plan || '').toLowerCase() === 'pro' || userData.is_whitelisted;
  const usesProResolution =
    (mode === 'image_to_video' || mode === 'motion_control') && body.resolution === '1080p';
  const usesMultipleOutputs =
    (mode === 'image_to_video' || mode === 'motion_control') && requestedOutputCount > 1;

  if (!hasProAccess && (usesProResolution || usesMultipleOutputs)) {
    throw new ApiError(
      403,
      'PRO_REQUIRED',
      'A Pro plan is required for 1080p resolution and multiple video outputs',
    );
  }
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function checkRateLimit(supabase: any, userId: string) {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('generations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneMinuteAgo);

  if (error) {
    console.error('[generate-video] Rate limit check failed:', error);
    return;
  }

  if (count !== null && count >= RATE_LIMIT_PER_MINUTE) {
    throw new ApiError(
      429,
      'RATE_LIMITED',
      'Slow down! Please wait a moment before generating more videos.'
    );
  }
}

async function checkCredits(supabase: any, userId: string, requiredCredits: number) {
  const { data, error } = await supabase
    .from('users')
    .select('credits, plan, is_whitelisted')
    .eq('id', userId)
    .single();

  if (error || !data) {
    console.error('[generate-video] Failed to fetch user data:', error);
    throw new ApiError(500, 'USER_DATA_ERROR', 'Failed to verify user credits');
  }

  const credits = Number(data.credits) || 0;
  const isWhitelisted = Boolean(data.is_whitelisted);

  if (!isWhitelisted && credits < requiredCredits) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits', {
      required: requiredCredits,
      available: credits,
    });
  }

  console.log('[generate-video] Credit pre-check passed:', {
    credits,
    isWhitelisted,
    plan: data.plan,
  });

  return {
    credits,
    plan: data.plan,
    is_whitelisted: isWhitelisted,
  };
}

function buildFalPayload(mode: VideoMode, body: RequestBody): Record<string, unknown> {
  switch (mode) {
    case 'image_to_video': {
      const prompt = validatePrompt(body.prompt, false);
      const startImageUrl = validateFalFileUrl(body.startImageUrl, 'startImageUrl');
      const endImageUrl = body.endImageUrl
        ? validateFalFileUrl(body.endImageUrl, 'endImageUrl')
        : undefined;

      // Keep the Kling v3 standard field names you already used.
      // Do not convert duration to 5/10; Kling v3 accepts the 3-15s UI range in your current setup.
      const payload: Record<string, unknown> = {
        start_image_url: startImageUrl,
        duration: String(normalizeDuration(body.duration)),
        generate_audio: body.generateAudio !== false,
        negative_prompt: 'blur, distort, and low quality',
        cfg_scale: 0.5,
      };

      if (prompt) {
        payload.prompt = prompt;
      }

      if (endImageUrl) {
        payload.end_image_url = endImageUrl;
      }

      return payload;
    }

    case 'motion_control': {
      const prompt = validatePrompt(body.prompt, true);
      const imageUrl = validateFalFileUrl(body.startImageUrl, 'startImageUrl');
      const videoUrl = validateFalFileUrl(body.videoUrl, 'videoUrl');
      const characterOrientation = normalizeCharacterOrientation(body.characterOrientation);

      return {
        prompt,
        image_url: imageUrl,
        video_url: videoUrl,
        keep_original_sound: true,
        character_orientation: characterOrientation,
      };
    }

    case 'lip_sync': {
      const audioUrl = validateFalFileUrl(body.audioUrl, 'audioUrl');

      // Video + audio lip sync endpoint: fal-ai/kling-video/lipsync/audio-to-video
      if (body.videoUrl) {
        const videoUrl = validateFalFileUrl(body.videoUrl, 'videoUrl');
        return {
          video_url: videoUrl,
          audio_url: audioUrl,
        };
      }

      // Image + audio avatar endpoint: fal-ai/kling-video/ai-avatar/v2/standard
      const imageUrl = validateFalFileUrl(body.startImageUrl, 'startImageUrl');
      const prompt = validatePrompt(body.prompt, false);

      return {
        image_url: imageUrl,
        audio_url: audioUrl,
        ...(prompt ? { prompt } : {}),
      };
    }

    default:
      throw new ApiError(400, 'INVALID_MODE', 'Unsupported video mode');
  }
}

function validatePrompt(prompt: unknown, required: boolean): string {
  if (!prompt || typeof prompt !== 'string') {
    if (required) {
      throw new ApiError(400, 'INVALID_INPUT', 'Prompt is required');
    }
    return '';
  }

  const trimmed = prompt.trim();

  if (!trimmed && required) {
    throw new ApiError(400, 'INVALID_INPUT', 'Prompt is required');
  }

  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      `Prompt too long. Maximum is ${MAX_PROMPT_LENGTH} characters.`
    );
  }

  return trimmed;
}

function validateFalFileUrl(value: unknown, fieldName: string): string {
  if (!value || typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_INPUT', `${fieldName} is required`);
  }

  const url = value.trim();

  if (!url) {
    throw new ApiError(400, 'INVALID_INPUT', `${fieldName} is required`);
  }

  if (url.startsWith('blob:')) {
    throw new ApiError(
      400,
      'INVALID_FILE_URL',
      `${fieldName} is a browser-local blob URL. Upload the file to public storage first and pass an https URL.`
    );
  }

  if (!url.startsWith('https://') && !url.startsWith('data:')) {
    throw new ApiError(
      400,
      'INVALID_FILE_URL',
      `${fieldName} must start with https:// or data:`
    );
  }

  return url;
}

function normalizeDuration(duration: unknown): number {
  const raw = Number(duration);
  const value = Number.isFinite(raw) ? Math.round(raw) : 5;

  if (value < 3) return 3;
  if (value > 15) return 15;

  return value;
}

function normalizeCharacterOrientation(value: unknown): CharacterOrientation {
  if (value === 'image' || value === 'video') return value;
  return 'video';
}

async function submitFalJob(
  endpoint: string,
  payload: Record<string, unknown>,
  falKey: string
): Promise<FalSubmitResult> {
  const url = `${FAL_QUEUE_BASE_URL}/${endpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await readJsonOrText(response);

  if (!response.ok) {
    console.error('[generate-video] Fal submit HTTP error:', {
      falHttpStatus: response.status,
      falStatusText: response.statusText,
      url,
      endpoint,
      falBody: data,
    });

    throw new ApiError(
      mapFalStatusToHttp(response.status),
      'FAL_SUBMIT_FAILED',
      `Fal submit failed. HTTP ${response.status} ${response.statusText}: ${extractFalErrorMessage(data)}`,
      {
        falHttpStatus: response.status,
        falStatusText: response.statusText,
        url,
        endpoint,
        falBody: data,
      }
    );
  }

  console.log('[generate-video] Raw Fal submit response:', data);

  const requestId =
    getNestedString(data, ['request_id']) ||
    getNestedString(data, ['requestId']);

  const statusUrl =
    getNestedString(data, ['status_url']) ||
    getNestedString(data, ['statusUrl']);

  const responseUrl =
    getNestedString(data, ['response_url']) ||
    getNestedString(data, ['responseUrl']);

  const cancelUrl =
    getNestedString(data, ['cancel_url']) ||
    getNestedString(data, ['cancelUrl']);

  if (!requestId) {
    throw new ApiError(
      502,
      'FAL_SUBMIT_INVALID_RESPONSE',
      'Fal submit response missing request_id',
      data
    );
  }

  return {
    requestId,
    statusUrl: statusUrl || undefined,
    responseUrl: responseUrl || undefined,
    cancelUrl: cancelUrl || undefined,
  };
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function extractFalErrorMessage(data: unknown): string {
  if (!data) return 'Unknown Fal error';

  if (typeof data === 'string') return data;

  if (isRecord(data)) {
    const direct =
      getNestedString(data, ['error']) ||
      getNestedString(data, ['message']) ||
      getNestedString(data, ['detail']) ||
      getNestedString(data, ['detail', 'message']) ||
      getNestedString(data, ['detail', 'error']);

    if (direct) return direct;

    try {
      return JSON.stringify(data).slice(0, 500);
    } catch {
      return 'Unknown Fal error';
    }
  }

  return 'Unknown Fal error';
}

function getNestedString(obj: unknown, path: string[]): string | null {
  let current: unknown = obj;

  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }

  return typeof current === 'string' && current.trim() ? current.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapFalStatusToHttp(status: number): number {
  if (status === 400) return 400;
  if (status === 401 || status === 403) return 502;
  if (status === 404) return 502;
  if (status === 408) return 504;
  if (status === 429) return 503;
  if (status >= 500) return 503;
  return 502;
}

function sendError(
  res: VercelResponse,
  statusCode: number,
  code: string,
  error: string,
  details?: unknown
) {
  return res.status(statusCode).json({
    success: false,
    error,
    code,
    ...(details !== undefined ? { details } : {}),
  });
}

function estimateVideoCredits(mode: VideoMode, body: RequestBody): number {
  const generationCount = Math.max(1, Math.floor(Number(body.generationCount) || 1));
  if (generationCount !== 1) {
    throw new ApiError(400, 'MULTIPLE_OUTPUTS_UNSUPPORTED', 'Multiple video outputs are not supported yet. Select 1 output.');
  }
  let costUsd = 0;
  if (mode === 'image_to_video') {
    const pricePerSecond = body.resolution === '1080p'
      ? (body.generateAudio === false ? 0.112 : 0.168)
      : (body.generateAudio === false ? 0.084 : 0.126);
    costUsd = normalizeDuration(body.duration) * pricePerSecond;
  } else if (mode === 'motion_control') {
    const pricePerSecond = body.resolution === '1080p' ? 0.168 : 0.126;
    costUsd = normalizePositiveDuration(body.duration, 5) * pricePerSecond;
  } else if (body.videoUrl) {
    costUsd = Math.ceil(normalizePositiveDuration(body.duration, 5) / 5) * 5 * 0.014;
  } else {
    costUsd = normalizePositiveDuration(body.duration, 5) * 0.0562;
  }
  return Math.max(1, Math.ceil(costUsd * USD_TO_CREDITS));
}

function normalizePositiveDuration(duration: unknown, fallback: number): number {
  const value = Number(duration);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
