import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

export const config = { maxDuration: 60 };

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const falKey = process.env.FAL_KEY;
const FAL_EXTRACT_FRAME_URL = 'https://fal.run/fal-ai/ffmpeg-api/extract-frame';

type TemplateRow = {
  id: string;
  creator_id: string | null;
  status: string;
  current_version_id: string | null;
  draft_version_id: string | null;
  submitted_version_id: string | null;
};

type AssetRow = {
  id: string;
  asset_key: string;
  asset_type: string;
  generation_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  sort_order: number;
};

function sendError(res: VercelResponse, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readBody(body: unknown): { templateId: string; versionId: string } {
  if (!body || typeof body !== 'object') return { templateId: '', versionId: '' };
  const value = body as Record<string, unknown>;
  return {
    templateId: typeof value.templateId === 'string' ? value.templateId.trim() : '',
    versionId: typeof value.versionId === 'string' ? value.versionId.trim() : '',
  };
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

async function extractFirstFrame(videoUrl: string): Promise<string> {
  if (!falKey) throw new Error('FAL_KEY is missing.');
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
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`Frame extraction failed (${response.status}): ${String(payload.message || response.statusText)}`);
    }
    const url = extractedImageUrl(payload);
    if (!url) throw new Error('Frame extraction returned no image.');
    return url;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Could not download extracted frame (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed.');
  if (!supabaseUrl || !supabaseServiceKey) {
    return sendError(res, 500, 'Supabase server credentials are missing.');
  }

  const authHeader = headerValue(req.headers.authorization);
  if (!authHeader?.startsWith('Bearer ')) {
    return sendError(res, 401, 'Authentication required.');
  }
  const { templateId, versionId } = readBody(req.body);
  if (!templateId || !versionId) {
    return sendError(res, 400, 'templateId and versionId are required.');
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) return sendError(res, 401, 'Invalid or expired session.');

    const { data: templateData, error: templateError } = await supabase
      .from('templates')
      .select('id,creator_id,status,current_version_id,draft_version_id,submitted_version_id')
      .eq('id', templateId)
      .maybeSingle();
    if (templateError) throw templateError;
    const template = templateData as TemplateRow | null;
    if (!template) return sendError(res, 404, 'Template not found.');

    const isOwner = template.creator_id === user.id;
    const isCurrentPublishedVersion = template.status === 'published'
      && template.current_version_id === versionId;
    const isOwnerVersion = isOwner && [
      template.current_version_id,
      template.draft_version_id,
      template.submitted_version_id,
    ].includes(versionId);
    if (!isCurrentPublishedVersion && !isOwnerVersion) {
      return sendError(res, 403, 'This template version is not available.');
    }

    const [{ data: versionData, error: versionError }, { data: assetData, error: assetError }] =
      await Promise.all([
        supabase
          .from('template_versions')
          .select('workflow')
          .eq('id', versionId)
          .eq('template_id', templateId)
          .maybeSingle(),
        supabase
          .from('template_assets')
          .select('id,asset_key,asset_type,generation_id,storage_bucket,storage_path,public_url,sort_order')
          .eq('template_id', templateId)
          .eq('version_id', versionId)
          .order('sort_order', { ascending: true }),
      ]);
    if (versionError || !versionData) throw versionError || new Error('Version not found.');
    if (assetError) throw assetError;

    const assets = (assetData || []) as AssetRow[];
    const workflowSteps = Array.isArray(versionData.workflow?.steps)
      ? versionData.workflow.steps as Array<{ capability?: string }>
      : [];
    const resultAssets = assets.filter((asset) => /^step-\d+-result$/.test(asset.asset_key));
    const resultAsset = [...resultAssets].reverse().find((asset) => {
      const match = /^step-(\d+)-result$/.exec(asset.asset_key);
      const stepIndex = match ? Number(match[1]) - 1 : -1;
      return asset.asset_type === 'video'
        || workflowSteps[stepIndex]?.capability?.startsWith('video.');
    });
    if (!resultAsset) return sendError(res, 422, 'This version has no video result.');

    const posterKey = `${resultAsset.asset_key}-thumbnail`;
    const existingPoster = assets.find((asset) => asset.asset_key === posterKey);
    if (existingPoster?.public_url) {
      return res.status(200).json({
        success: true,
        thumbnailUrl: existingPoster.public_url,
        cached: true,
      });
    }

    let frameSourceUrl: string | null = null;
    let videoUrl = resultAsset.public_url;
    if (resultAsset.generation_id) {
      const { data: generation } = await supabase
        .from('generations')
        .select('thumbnail_url,video_url,image_url')
        .eq('id', resultAsset.generation_id)
        .maybeSingle();
      frameSourceUrl = generation?.thumbnail_url || null;
      videoUrl = videoUrl || generation?.video_url || null;
    }
    if (!videoUrl && resultAsset.storage_bucket && resultAsset.storage_path) {
      const { data: signed, error: signedError } = await supabase.storage
        .from(resultAsset.storage_bucket)
        .createSignedUrl(resultAsset.storage_path, 300);
      if (signedError) throw signedError;
      videoUrl = signed?.signedUrl || null;
    }
    if (!frameSourceUrl) {
      if (!videoUrl) return sendError(res, 422, 'The video result has no readable URL.');
      frameSourceUrl = await extractFirstFrame(videoUrl);
    }

    const frameBytes = await fetchImage(frameSourceUrl);
    const { data: webp, info } = await sharp(frameBytes)
      .rotate()
      .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const ownerId = template.creator_id || user.id;
    const storagePath = `${ownerId}/${templateId}/${versionId}/${posterKey}.webp`;
    const { error: uploadError } = await supabase.storage
      .from('template-previews')
      .upload(storagePath, webp, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: true,
      });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage
      .from('template-previews')
      .getPublicUrl(storagePath);
    const thumbnailUrl = publicData.publicUrl;

    const { error: assetUpsertError } = await supabase
      .from('template_assets')
      .upsert({
        template_id: templateId,
        version_id: versionId,
        owner_id: ownerId,
        asset_key: posterKey,
        asset_type: 'image',
        source_kind: 'upload',
        generation_id: resultAsset.generation_id,
        storage_bucket: 'template-previews',
        storage_path: storagePath,
        public_url: thumbnailUrl,
        mime_type: 'image/webp',
        byte_size: webp.byteLength,
        width: info.width || null,
        height: info.height || null,
        duration_seconds: null,
        sort_order: resultAsset.sort_order + 1,
        is_reusable: false,
      }, { onConflict: 'template_id,version_id,asset_key' });
    if (assetUpsertError) throw assetUpsertError;

    return res.status(200).json({ success: true, thumbnailUrl, cached: false });
  } catch (error) {
    console.error('[Template result thumbnail] Failed:', error);
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Could not create the template video thumbnail.',
    );
  }
}
