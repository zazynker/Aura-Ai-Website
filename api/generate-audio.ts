import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fal } from '@fal-ai/client';
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 300 };

const ENDPOINT = process.env.FAL_MINIMAX_SPEECH_ENDPOINT
  || 'fal-ai/minimax/preview/speech-2.5-hd';
const USD_TO_CREDITS = 195;
const USD_PER_THOUSAND_CHARACTERS = 0.1;
const MAX_TEXT_LENGTH = 5000;
const RATE_LIMIT_PER_MINUTE = 5;
const EMOTIONS = new Set(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral']);
const FORMATS = new Set(['mp3', 'flac']);
const LANGUAGE_BOOSTS = new Set([
  'auto',
  'Chinese',
  'English',
  'Japanese',
  'Korean',
  'French',
  'German',
  'Spanish',
  'Portuguese',
  'Russian',
  'Italian',
]);

type AudioRequestBody = {
  text?: string;
  voiceId?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  emotion?: string;
  languageBoost?: string;
  format?: string;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
};

class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const sendError = (
  res: VercelResponse,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
) => res.status(statusCode).json({ success: false, error: { code, message, details } });

const parseBody = (body: unknown): AudioRequestBody => {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as AudioRequestBody;
    } catch {
      throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON request body');
    }
  }
  if (typeof body === 'object') return body as AudioRequestBody;
  throw new ApiError(400, 'INVALID_INPUT', 'Invalid request body');
};

const boundedNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ApiError(400, 'INVALID_INPUT', `${field} must be between ${min} and ${max}`);
  }
  return number;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  try {
    const falKey = process.env.FAL_KEY;
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!falKey || !supabaseUrl || !serviceKey) {
      throw new ApiError(500, 'CONFIG_ERROR', 'Server configuration error');
    }

    const authorization = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !user) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }

    const body = parseBody(req.body);
    const text = String(body.text || '').trim();
    if (!text || text.length > MAX_TEXT_LENGTH) {
      throw new ApiError(400, 'INVALID_INPUT', `Speech text must contain 1-${MAX_TEXT_LENGTH} characters`);
    }

    const voiceId = String(body.voiceId || 'Wise_Woman').trim();
    if (!voiceId || voiceId.length > 100) {
      throw new ApiError(400, 'INVALID_INPUT', 'Voice ID must contain 1-100 characters');
    }
    const speed = boundedNumber(body.speed, 1, 0.5, 2, 'speed');
    const volume = boundedNumber(body.volume, 1, 0, 10, 'volume');
    const pitch = boundedNumber(body.pitch, 0, -12, 12, 'pitch');
    const emotion = String(body.emotion || 'neutral');
    const format = String(body.format || 'mp3');
    const languageBoost = String(body.languageBoost || 'auto');
    if (!EMOTIONS.has(emotion)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid emotion');
    if (!FORMATS.has(format)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid audio format');
    if (!LANGUAGE_BOOSTS.has(languageBoost)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid language boost');

    const requiredCredits = Math.max(
      1,
      Math.ceil((text.length / 1000) * USD_PER_THOUSAND_CHARACTERS * USD_TO_CREDITS),
    );
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from('generations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', oneMinuteAgo);
    if (count !== null && count >= RATE_LIMIT_PER_MINUTE) {
      throw new ApiError(429, 'RATE_LIMITED', 'Please wait a moment before generating more audio.');
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('credits,is_whitelisted')
      .eq('id', user.id)
      .single();
    if (userError || !userData) throw new ApiError(500, 'USER_DATA_ERROR', 'Failed to verify user credits');
    if (!userData.is_whitelisted && Number(userData.credits) < requiredCredits) {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits', {
        required: requiredCredits,
        available: Number(userData.credits) || 0,
      });
    }

    fal.config({ credentials: falKey });
    const result = await fal.subscribe(ENDPOINT, {
      input: {
        text,
        output_format: 'url',
        voice_setting: {
          voice_id: voiceId,
          speed,
          vol: volume,
          pitch,
          emotion,
          english_normalization: true,
        },
        audio_setting: {
          sample_rate: 44100,
          bitrate: 128000,
          format,
          channel: 2,
        },
        language_boost: languageBoost,
      },
      logs: false,
    }) as unknown as {
      requestId?: string;
      data?: { audio?: { url?: string }; duration_ms?: number };
    };

    const audioUrl = result.data?.audio?.url;
    const requestId = result.requestId;
    if (!audioUrl || !requestId) {
      throw new ApiError(502, 'INVALID_PROVIDER_RESPONSE', 'Audio provider returned no downloadable audio');
    }

    const { data: deduction, error: deductionError } = await supabase.rpc(
      'deduct_generation_credits',
      {
        p_user_id: user.id,
        p_amount: requiredCredits,
        p_request_id: requestId,
        p_template_run_id: body.templateRunId || null,
        p_template_step_id: body.templateStepId || null,
        p_capability: body.templateCapability || 'audio.text_to_speech',
      },
    );
    if (deductionError || !deduction?.success) {
      throw new ApiError(500, 'CREDIT_DEDUCTION_FAILED', 'Audio was generated but credit settlement failed.', { requestId });
    }

    return res.status(200).json({
      success: true,
      audioUrl,
      durationMs: Number(result.data?.duration_ms) || 0,
      requestId,
      endpoint: ENDPOINT,
      creditsUsed: requiredCredits,
      creditsDeducted: Number(deduction.credits_deducted) || 0,
      eligiblePaidCredits: Number(deduction.eligible_paid_credits) || 0,
      creditDeductionId: deduction.deduction_id,
      newCredits: Number(deduction.new_balance ?? deduction.new_credits ?? userData.credits),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendError(res, error.statusCode, error.code, error.message, error.details);
    }
    console.error('[generate-audio] Unexpected error:', error);
    return sendError(
      res,
      500,
      'AUDIO_GENERATION_FAILED',
      error instanceof Error ? error.message : 'Audio generation failed',
    );
  }
}
