import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type RequestBody = {
  requestId?: string;
  endpoint?: string;
  statusUrl?: string;
  responseUrl?: string;
};

const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';

const ALLOWED_ENDPOINTS = new Set<string>([
  'fal-ai/kling-video/v3/standard/image-to-video',
  'fal-ai/kling-video/v3/pro/image-to-video',
  'fal-ai/kling-video/v3/standard/motion-control',
  'fal-ai/kling-video/v3/pro/motion-control',
  'fal-ai/kling-video/lipsync/audio-to-video',
]);

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
      console.error('[video-status] FAL_KEY not configured');
      return sendError(res, 500, 'CONFIG_ERROR', 'Fal API key not configured');
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[video-status] Supabase credentials not configured');
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
      console.error('[video-status] Auth verification failed:', authError?.message);
      return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired token');
    }

    const body = parseBody(req.body);
    const requestId = validateRequestId(body.requestId);
    const endpoint = validateEndpoint(body.endpoint);
    const statusUrl = validateOptionalFalQueueUrl(body.statusUrl, 'statusUrl');
    const responseUrl = validateOptionalFalQueueUrl(body.responseUrl, 'responseUrl');

    const statusData = await getFalStatus(endpoint, requestId, falKey, statusUrl);
    const status = String(statusData.status || '').toUpperCase();

    console.log('[video-status] Fal status:', {
      userId: user.id,
      requestId,
      endpoint,
      status,
      usingReturnedStatusUrl: Boolean(statusUrl),
    });

    if (status === 'COMPLETED') {
      const result = await getFalResult(endpoint, requestId, falKey, responseUrl);
      const videoUrl = extractVideoUrl(result);

      if (!videoUrl) {
        console.error(
          '[video-status] Fal result missing video URL:',
          safeStringify(result).slice(0, 1500)
        );

        return res.status(200).json({
          status: 'FAILED',
          error: 'Fal completed but did not return a video URL',
        });
      }

      return res.status(200).json({
        status: 'COMPLETED',
        videoUrl,
      });
    }

    if (status === 'FAILED' || status === 'CANCELLED') {
      return res.status(200).json({
        status: 'FAILED',
        error: extractFalErrorMessage(statusData),
      });
    }

    return res.status(200).json({
      status: status || 'IN_PROGRESS',
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error('[video-status] ApiError:', {
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
        details: err.details,
      });

      return sendError(res, err.statusCode, err.code, err.message, err.details);
    }

    console.error('[video-status] Unexpected error:', err);

    return sendError(
      res,
      500,
      'VIDEO_STATUS_FAILED',
      err instanceof Error ? err.message : 'Failed to check video status'
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

function validateRequestId(value: unknown): string {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'INVALID_INPUT', 'requestId is required');
  }

  return value.trim();
}

function validateEndpoint(value: unknown): string {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'INVALID_INPUT', 'endpoint is required');
  }

  const endpoint = value.trim();

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    throw new ApiError(400, 'INVALID_ENDPOINT', 'Unsupported video endpoint');
  }

  return endpoint;
}

function validateOptionalFalQueueUrl(value: unknown, fieldName: string): string | undefined {
  if (!value) return undefined;

  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_INPUT', `${fieldName} must be a string`);
  }

  const url = value.trim();
  if (!url) return undefined;

  if (!url.startsWith(FAL_QUEUE_BASE_URL)) {
    throw new ApiError(400, 'INVALID_INPUT', `${fieldName} must be a Fal queue URL`);
  }

  return url;
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function getFalStatus(
  endpoint: string,
  requestId: string,
  falKey: string,
  statusUrl?: string
): Promise<Record<string, unknown>> {
  const url = statusUrl || `${FAL_QUEUE_BASE_URL}/${endpoint}/requests/${requestId}/status`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Key ${falKey}`,
    },
  });

  const data = await readJsonOrText(response);

  if (!response.ok) {
    console.error('[video-status] Fal status HTTP error:', {
      falHttpStatus: response.status,
      falStatusText: response.statusText,
      url,
      endpoint,
      requestId,
      falBody: data,
    });

    throw new ApiError(
      mapFalStatusToHttp(response.status),
      'FAL_STATUS_FAILED',
      `Fal status failed. HTTP ${response.status} ${response.statusText}: ${extractFalErrorMessage(data)}`,
      {
        falHttpStatus: response.status,
        falStatusText: response.statusText,
        url,
        endpoint,
        requestId,
        falBody: data,
      }
    );
  }

  if (!isRecord(data)) {
    throw new ApiError(
      502,
      'FAL_STATUS_INVALID_RESPONSE',
      'Invalid Fal status response',
      data
    );
  }

  return data;
}

async function getFalResult(
  endpoint: string,
  requestId: string,
  falKey: string,
  responseUrl?: string
): Promise<unknown> {
  const url = responseUrl || `${FAL_QUEUE_BASE_URL}/${endpoint}/requests/${requestId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Key ${falKey}`,
    },
  });

  const data = await readJsonOrText(response);

  if (!response.ok) {
    console.error('[video-status] Fal result HTTP error:', {
      falHttpStatus: response.status,
      falStatusText: response.statusText,
      url,
      endpoint,
      requestId,
      falBody: data,
    });

    throw new ApiError(
      mapFalStatusToHttp(response.status),
      'FAL_RESULT_FAILED',
      `Fal result failed. HTTP ${response.status} ${response.statusText}: ${extractFalErrorMessage(data)}`,
      {
        falHttpStatus: response.status,
        falStatusText: response.statusText,
        url,
        endpoint,
        requestId,
        falBody: data,
      }
    );
  }

  return data;
}

function extractVideoUrl(result: unknown): string | null {
  const candidates = [
    ['video', 'url'],
    ['data', 'video', 'url'],
    ['output', 'video', 'url'],
    ['result', 'video', 'url'],
    ['url'],
    ['video_url'],
    ['videoUrl'],
  ];

  for (const path of candidates) {
    const value = getNestedString(result, path);
    if (value) return value;
  }

  return null;
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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
