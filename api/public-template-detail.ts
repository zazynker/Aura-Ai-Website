import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { QuickUseDefinition } from '../workflows/quickUseTypes';
import {
  QUICK_USE_EXAMPLE_ASSET_KEY_PREFIX,
  deriveQuickUseCandidates,
  toQuickUsePresentationDefinition,
} from '../workflows/quickUseCandidates';
import { validateQuickUseDefinition } from '../workflows/quickUseValidators';

export const config = { maxDuration: 30 };

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_URL_PATTERN = /\.(mp4|webm|mov|m4v)(?:$|[?#])/i;

const FEATURE_NAMES: Record<string, string> = {
  'image.text_to_image': 'Image Generation',
  'image.replace_product': 'Replace Product',
  'image.modify': 'Modify Image',
  'video.image_to_video': 'Image to Video',
  'video.motion_control': 'Motion Control',
  'video.lip_sync_image': 'Image Lip Sync',
  'video.lip_sync_video': 'Video Lip Sync',
};

type AssetRow = {
  id: string;
  asset_key: string;
  asset_type: 'image' | 'video' | 'audio';
  generation_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  is_reusable: boolean;
  sort_order: number;
};

type WorkflowStep = {
  id: string;
  title?: string;
  capability: string;
  instruction?: string;
  parameters?: Record<string, unknown>;
};

type TemplateRow = {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  description: string | null;
  status: string;
  creator_id: string | null;
  use_count: number | string | null;
  current_version_id: string | null;
  cover_url: string | null;
  thumb_url: string | null;
  cover_type: string | null;
  image_url: string | null;
  preview_url: string | null;
};

function errorResponse(res: VercelResponse, status: number, message: string) {
  return res.status(status).json({ success: false, error: message });
}

function safeSettings(
  parameters: Record<string, unknown> | undefined,
  capability: string,
) {
  const settings = Object.fromEntries(
    Object.entries(parameters || {}).filter(([key, value]) => (
      key !== 'prompt'
      && (typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean')
    )),
  );
  if (capability === 'image.text_to_image' && !settings.model) {
    settings.model = 'gpt-image-2';
  }
  return settings;
}

function safeImageUrl(value: string | null | undefined) {
  return value && !VIDEO_URL_PATTERN.test(value) ? value : undefined;
}

async function readableUrl(
  supabase: SupabaseClient,
  asset: AssetRow | undefined,
) {
  if (!asset) return undefined;
  if (asset.public_url) return asset.public_url;
  if (!asset.storage_bucket || !asset.storage_path) return undefined;
  const { data, error } = await supabase.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_path, 5 * 60);
  if (error) {
    console.warn('[Public template detail] Could not sign asset:', error.message);
    return undefined;
  }
  return data?.signedUrl;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return errorResponse(res, 405, 'Method not allowed.');
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(res, 500, 'Supabase server credentials are missing.');
  }

  const idOrSlug = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!idOrSlug || idOrSlug.length > 160) {
    return errorResponse(res, 400, 'A template id or slug is required.');
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    let templateQuery = supabase
      .from('templates')
      .select('id,slug,name,display_name,description,status,creator_id,use_count,current_version_id,cover_url,thumb_url,cover_type,image_url,preview_url')
      .eq('status', 'published');
    templateQuery = UUID_PATTERN.test(idOrSlug)
      ? templateQuery.eq('id', idOrSlug)
      : templateQuery.eq('slug', idOrSlug);
    const { data: templateData, error: templateError } = await templateQuery.maybeSingle();
    if (templateError) throw templateError;
    const template = templateData as TemplateRow | null;
    if (!template || !template.current_version_id) {
      return errorResponse(res, 404, 'This published template could not be found.');
    }

    const [{ data: version, error: versionError }, { data: assetData, error: assetError }] =
      await Promise.all([
        supabase
          .from('template_versions')
          .select('id,workflow,quick_use_definition')
          .eq('id', template.current_version_id)
          .eq('template_id', template.id)
          .maybeSingle(),
        supabase
          .from('template_assets')
          .select('id,asset_key,asset_type,generation_id,storage_bucket,storage_path,public_url,is_reusable,sort_order')
          .eq('template_id', template.id)
          .eq('version_id', template.current_version_id)
          .order('sort_order', { ascending: true }),
      ]);
    if (versionError || !version) return errorResponse(res, 404, 'The published workflow version could not be loaded.');
    if (assetError) throw assetError;

    const workflow = version.workflow as { steps?: WorkflowStep[] };
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    if (steps.length === 0) return errorResponse(res, 404, 'This template has no workflow steps.');
    const quickUseDefinition = version.quick_use_definition == null
      ? null
      : version.quick_use_definition as QuickUseDefinition;
    if (quickUseDefinition) {
      const validation = validateQuickUseDefinition(version.workflow, quickUseDefinition);
      if (!validation.valid) {
        return errorResponse(res, 500, 'The published Quick Use definition is invalid.');
      }
    }
    const quickUseCandidates = quickUseDefinition
      ? deriveQuickUseCandidates(version.workflow, quickUseDefinition).candidates
      : [];

    const assets = (assetData || []) as AssetRow[];
    const assetByKey = new Map(assets.map((asset) => [asset.asset_key, asset]));
    const relevantAssets = assets.filter((asset) => (
      asset.asset_key === 'cover-thumbnail'
      || asset.asset_key === 'cover-original'
      || asset.asset_key === 'final-result'
      || asset.asset_key === 'final-result-thumbnail'
      || asset.asset_key.startsWith('step-1-material-')
      || asset.asset_key === 'step-1-result'
      || asset.asset_key === 'step-1-result-thumbnail'
      || /^step-\d+-result(?:-thumbnail)?$/.test(asset.asset_key)
      || asset.asset_key.startsWith(QUICK_USE_EXAMPLE_ASSET_KEY_PREFIX)
    ));
    const urlEntries = await Promise.all(
      relevantAssets.map(async (asset) => [asset.id, await readableUrl(supabase, asset)] as const),
    );
    const urls = new Map(urlEntries.filter((entry): entry is [string, string] => Boolean(entry[1])));
    const quickUseExampleUrls = Object.fromEntries(
      relevantAssets
        .filter((asset) => asset.asset_key.startsWith(QUICK_USE_EXAMPLE_ASSET_KEY_PREFIX))
        .map((asset) => [asset.asset_key, urls.get(asset.id)])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );

    const generationIds = [...new Set(
      relevantAssets.map((asset) => asset.generation_id).filter((id): id is string => Boolean(id)),
    )];
    const generationPosters = new Map<string, string>();
    if (generationIds.length > 0) {
      const { data: generations } = await supabase
        .from('generations')
        .select('id,thumbnail_url,image_url,video_url')
        .in('id', generationIds);
      for (const generation of generations || []) {
        const poster = generation.thumbnail_url || safeImageUrl(generation.image_url);
        if (poster) generationPosters.set(generation.id, poster);
      }
    }

    const coverThumbnail = (
      urls.get(assetByKey.get('cover-thumbnail')?.id || '')
      || template.thumb_url
      || safeImageUrl(template.cover_url)
      || safeImageUrl(template.image_url)
      || undefined
    );
    const coverOriginal = (
      urls.get(assetByKey.get('cover-original')?.id || '')
      || template.cover_url
      || template.preview_url
      || template.image_url
      || ''
    );

    const resultForAsset = async (
      asset: AssetRow | undefined,
      capability: string,
      thumbnailAsset?: AssetRow,
    ) => {
      const url = await Promise.resolve(urls.get(asset?.id || ''));
      if (!asset || !url) return undefined;
      const type = capability.startsWith('video.') || asset.asset_type === 'video'
        ? 'video'
        : 'image';
      const dedicatedThumbnail = thumbnailAsset
        ? urls.get(thumbnailAsset.id)
        : asset.generation_id
          ? generationPosters.get(asset.generation_id)
          : undefined;
      return {
        id: asset.id,
        type,
        url,
        thumbnail: type === 'video' ? dedicatedThumbnail || coverThumbnail : undefined,
        thumbnailIsFallback: type === 'video' && !dedicatedThumbnail,
      };
    };

    const firstStep = steps[0];
    const firstStepResultAsset = assetByKey.get('step-1-result');
    const firstStepResultThumbnailAsset = assetByKey.get('step-1-result-thumbnail');
    const firstStepResult = await resultForAsset(
      firstStepResultAsset,
      firstStep.capability,
      firstStepResultThumbnailAsset,
    );
    const firstMaterials = await Promise.all(
      assets
        .filter((asset) => asset.asset_key.startsWith('step-1-material-'))
        .map(async (asset, index) => {
          const url = urls.get(asset.id);
          if (!url) return null;
          return {
            id: asset.id,
            name: `Material ${index + 1}`,
            type: asset.asset_type,
            permission: 'preview' as const,
            url,
          };
        }),
    );

    const stepResults = new Map<string, NonNullable<Awaited<ReturnType<typeof resultForAsset>>>>();
    for (let index = 0; index < steps.length; index += 1) {
      const resultAsset = assetByKey.get(`step-${index + 1}-result`);
      const thumbnailAsset = assetByKey.get(`step-${index + 1}-result-thumbnail`);
      const result = await resultForAsset(resultAsset, steps[index].capability, thumbnailAsset);
      if (result) stepResults.set(steps[index].id, result);
    }
    const manualFinal = await resultForAsset(
      assetByKey.get('final-result'),
      assetByKey.get('final-result')?.asset_type === 'video' ? 'video.final' : 'image.final',
      assetByKey.get('final-result-thumbnail'),
    );
    const lastStepResult = [...steps]
      .reverse()
      .map((step) => stepResults.get(step.id))
      .find(Boolean);
    const finalResult = manualFinal || lastStepResult || {
      id: 'cover',
      type: template.cover_type === 'video' ? 'video' : 'image',
      url: coverOriginal,
      thumbnail: coverThumbnail,
    };

    const publicProfile = template.creator_id
      ? await supabase
        .from('user_profiles')
        .select('username,avatar_url')
        .eq('user_id', template.creator_id)
        .maybeSingle()
      : { data: null };

    const publicSteps = steps.map((step, index) => {
      const isFirst = index === 0;
      return {
        id: step.id,
        name: FEATURE_NAMES[step.capability] || step.title || `Step ${index + 1}`,
        featureName: FEATURE_NAMES[step.capability] || step.capability,
        locked: !isFirst,
        materials: isFirst ? firstMaterials.filter(Boolean) : [],
        prompt: isFirst
          ? (typeof step.parameters?.prompt === 'string' ? step.parameters.prompt : step.instruction || '')
          : '',
        settings: isFirst ? safeSettings(step.parameters, step.capability) : {},
        results: isFirst && firstStepResult ? [firstStepResult] : [],
      };
    });

    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return res.status(200).json({
      success: true,
      template: {
        id: template.id,
        versionId: template.current_version_id,
        slug: template.slug,
        name: template.display_name || template.name,
        status: 'published',
        creatorId: template.creator_id,
        creatorName: publicProfile.data?.username || 'Lazora creator',
        creatorAvatarUrl: publicProfile.data?.avatar_url || null,
        usageCount: Number(template.use_count || 0),
        description: template.description || '',
        finalResult,
        steps: publicSteps,
        quickUseDefinition: quickUseDefinition
          ? toQuickUsePresentationDefinition(quickUseDefinition, quickUseCandidates)
          : null,
        quickUseExampleUrls,
      },
    });
  } catch (error) {
    console.error('[Public template detail] Failed:', error);
    return errorResponse(res, 500, 'The published template could not be loaded.');
  }
}
