import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

type GenerationRow = {
  id: string;
  user_id: string;
  media_type: string | null;
  image_url: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
};

const FAL_EXTRACT_FRAME_URL = 'https://fal.run/fal-ai/ffmpeg-api/extract-frame';
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendError(res: VercelResponse, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readGenerationId(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const value = (body as { generationId?: unknown }).generationId;
  return typeof value === 'string' ? value.trim() : '';
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function extractedImageUrl(payload: Record<string, unknown>): string | null {
  const images = payload.images;
  if (!Array.isArray(images)) return null;
  const first = images[0];
  if (!first || typeof first !== 'object') return null;
  const url = (first as { url?: unknown }).url;
  return typeof url === 'string' && url ? url : null;
}

async function extractFirstFrame(videoUrl: string, falKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
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
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`Fal frame extraction failed (${response.status}): ${String(payload.message || response.statusText)}`);
    }
    const url = extractedImageUrl(payload);
    if (!url) throw new Error('Fal did not return an extracted image URL.');
    return url;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed.');
  if (!supabaseUrl || !supabaseServiceKey) return sendError(res, 500, 'Supabase server credentials are missing.');

  const authHeader = headerValue(req.headers.authorization);
  if (!authHeader?.startsWith('Bearer ')) return sendError(res, 401, 'Authentication required.');

  const generationId = readGenerationId(req.body);
  if (!generationId) return sendError(res, 400, 'generationId is required.');

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return sendError(res, 401, 'Invalid or expired session.');

    const { data, error: selectError } = await supabase
      .from('generations')
      .select('id,user_id,media_type,image_url,video_url,thumbnail_url')
      .eq('id', generationId)
      .maybeSingle();
    if (selectError) throw selectError;
    const generation = data as GenerationRow | null;
    if (!generation || generation.user_id !== user.id) return sendError(res, 404, 'Generation not found.');

    if (generation.thumbnail_url) {
      return res.status(200).json({ success: true, thumbnailUrl: generation.thumbnail_url, cached: true });
    }

    let thumbnailUrl: string | null = null;
    const isVideo = generation.media_type === 'video' || Boolean(generation.video_url);
    if (isVideo && generation.video_url) {
      const falKey = process.env.FAL_KEY;
      if (!falKey) return sendError(res, 500, 'FAL_KEY is missing.');
      thumbnailUrl = await extractFirstFrame(generation.video_url, falKey);
    } else {
      thumbnailUrl = generation.image_url;
    }
    if (!thumbnailUrl) return sendError(res, 422, 'This generation has no usable media URL.');

    const { error: updateError } = await supabase
      .from('generations')
      .update({ thumbnail_url: thumbnailUrl })
      .eq('id', generation.id)
      .eq('user_id', user.id);
    if (updateError) throw updateError;

    return res.status(200).json({ success: true, thumbnailUrl, cached: false });
  } catch (error) {
    console.error('[generation-thumbnail] Failed:', error);
    const message = error instanceof Error ? error.message : 'Could not create thumbnail.';
    return sendError(res, 500, message);
  }
}
