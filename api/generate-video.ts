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
};

type FalSubmitResult = {
  requestId: string;
  statusUrl?: string;
  responseUrl?: string;
  cancelUrl?: string;
};

const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';

const KLING_ENDPOINTS: Record<VideoMode, string> = {
  // If you later want Pro, you can set this env var in Vercel:
  // FAL_KLING_IMAGE_TO_VIDEO_ENDPOINT=fal-ai/kling-video/v3/pro/image-to-video
  image_to_video:
    process.env.FAL_KLING_IMAGE_TO_VIDEO_ENDPOINT ||
    'fal-ai/kling-video/v3/standard/image-to-video',
  motion_control:
    process.env.FAL_KLING_MOTION_CONTROL_ENDPOINT ||
    'fal-ai/kling-video/v3/standard/motion-control',
  lip_sync:
    process.env.FAL_KLING_LIP_SYNC_ENDPOINT ||
    'fal-ai/kling-video/lipsync/audio-to-video',
};

const MAX_PROMPT_LENGTH = 2000;
const MIN_VIDEO_CREDITS = 10;
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

    await checkRateLimit(supabase, user.id);
    const userData = await checkCredits(supabase, user.id);

    const endpoint = KLING_ENDPOINTS[mode];
    const payload = buildFalPayload(mode, body);

    console.log('[generate-video] Submitting Fal job:', {
      mode,
      endpoint,
      userId: user.id,
      duration: body.duration,
      normalizedDuration: mode === 'image_to_video' ? normalizeDuration(body.duration) : undefined,
      resolution: body.resolution,
      isWhitelisted: userData.is_whitelisted,
      payloadKeys: Object.keys(payload),
    });

    const falJob = await submitFalJob(endpoint, payload, falKey);

    console.log('[generate-video] Fal request submitted:', {
      mode,
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

async function checkCredits(supabase: any, userId: string) {
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

  if (!isWhitelisted && credits < MIN_VIDEO_CREDITS) {
    throw new ApiError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits', {
      required: MIN_VIDEO_CREDITS,
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
      const prompt = validatePrompt(body.prompt, true);
      const startImageUrl = validateFalFileUrl(body.startImageUrl, 'startImageUrl');
      const endImageUrl = body.endImageUrl
        ? validateFalFileUrl(body.endImageUrl, 'endImageUrl')
        : undefined;

      // Keep the Kling v3 standard field names you already used.
      // Do not convert duration to 5/10; Kling v3 accepts the 3-15s UI range in your current setup.
      const payload: Record<string, unknown> = {
        prompt,
        start_image_url: startImageUrl,
        duration: String(normalizeDuration(body.duration)),
        generate_audio: true,
        negative_prompt: 'blur, distort, and low quality',
        cfg_scale: 0.5,
      };

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
      const videoUrl = validateFalFileUrl(body.videoUrl, 'videoUrl');
      const audioUrl = validateFalFileUrl(body.audioUrl, 'audioUrl');

      return {
        video_url: videoUrl,
        audio_url: audioUrl,
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
