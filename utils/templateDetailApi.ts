import { supabase } from './supabase';

export interface TemplateDetailMaterial {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  permission: 'preview' | 'download';
  url: string;
}

export interface TemplateDetailResult {
  id: string;
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
}

export interface TemplateDetailStep {
  id: string;
  name: string;
  featureName: string;
  materials: TemplateDetailMaterial[];
  prompt: string;
  results: TemplateDetailResult[];
}

export interface RealTemplateDetail {
  id: string;
  slug: string;
  name: string;
  status: 'draft' | 'pending_review' | 'published' | 'rejected' | 'archived';
  creatorId: string | null;
  usageCount: number;
  description: string;
  finalResult: TemplateDetailResult;
  steps: TemplateDetailStep[];
}

interface AssetRow {
  id: string;
  asset_key: string;
  asset_type: 'image' | 'video' | 'audio';
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  is_reusable: boolean;
}

const FEATURE_NAMES: Record<string, string> = {
  'image.text_to_image': 'Text to Image',
  'image.replace_product': 'Replace Product',
  'image.modify': 'Modify Image',
  'video.image_to_video': 'Image to Video',
  'video.motion_control': 'Motion Control',
  'video.lip_sync_image': 'Image Lip Sync',
  'video.lip_sync_video': 'Video Lip Sync',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function createReadableUrls(assets: AssetRow[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  await Promise.all(
    assets.map(async (asset) => {
      if (asset.public_url) {
        urls.set(asset.id, asset.public_url);
        return;
      }
      if (!asset.storage_bucket || !asset.storage_path) return;
      const { data, error } = await supabase.storage
        .from(asset.storage_bucket)
        .createSignedUrl(asset.storage_path, 60 * 60);
      if (!error && data?.signedUrl) urls.set(asset.id, data.signedUrl);
    }),
  );
  return urls;
}

export async function fetchTemplateDetail(
  idOrSlug: string,
): Promise<RealTemplateDetail> {
  let query = supabase
    .from('templates')
    .select('id,slug,name,display_name,description,status,creator_id,use_count,current_version_id,draft_version_id,submitted_version_id,cover_url,thumb_url,cover_type');
  query = UUID_PATTERN.test(idOrSlug)
    ? query.eq('id', idOrSlug)
    : query.eq('slug', idOrSlug);
  const { data: template, error: templateError } = await query.single();
  if (templateError || !template) {
    throw new Error('This template could not be found or you do not have permission to view it.');
  }
  const { data: authData } = await supabase.auth.getUser();
  const isOwner = authData.user?.id === template.creator_id;
  const selectedVersionId = template.current_version_id
    || (isOwner ? template.submitted_version_id || template.draft_version_id : null);
  if (!selectedVersionId) {
    throw new Error('This template has no workflow version.');
  }

  const [{ data: version, error: versionError }, { data: assetData, error: assetError }] =
    await Promise.all([
      supabase
        .from('template_versions')
        .select('id,workflow')
        .eq('id', selectedVersionId)
        .eq('template_id', template.id)
        .single(),
      supabase
        .from('template_assets')
        .select('id,asset_key,asset_type,storage_bucket,storage_path,public_url,is_reusable')
        .eq('template_id', template.id)
        .eq('version_id', selectedVersionId)
        .order('sort_order', { ascending: true }),
    ]);
  if (versionError || !version) {
    throw new Error('The workflow version could not be loaded.');
  }
  if (assetError) {
    throw new Error(`The template materials could not be loaded: ${assetError.message}`);
  }

  const workflow = version.workflow as {
    steps?: Array<{
      id: string;
      title?: string;
      capability: string;
      instruction?: string;
      parameters?: Record<string, unknown>;
    }>;
  };
  if (!Array.isArray(workflow?.steps) || workflow.steps.length === 0) {
    throw new Error('This template has no workflow steps.');
  }

  const assets = (assetData || []) as AssetRow[];
  const urls = await createReadableUrls(assets);
  const coverThumbnailAsset = assets.find((asset) => asset.asset_key === 'cover-thumbnail');
  const coverOriginalAsset = assets.find((asset) => asset.asset_key === 'cover-original');
  const coverThumbnail =
    (coverThumbnailAsset && urls.get(coverThumbnailAsset.id)) || template.thumb_url || undefined;
  const coverOriginal =
    (coverOriginalAsset && urls.get(coverOriginalAsset.id)) || template.cover_url || '';

  const steps: TemplateDetailStep[] = workflow.steps.map((step, stepIndex) => {
    const materials = assets
      .filter((asset) => asset.asset_key.startsWith(`step-${stepIndex + 1}-material-`))
      .map((asset, materialIndex): TemplateDetailMaterial | null => {
        const url = urls.get(asset.id);
        if (!url) return null;
        return {
          id: asset.id,
          name: `Material ${materialIndex + 1}`,
          type: asset.asset_type,
          permission: asset.is_reusable ? 'download' : 'preview',
          url,
        };
      })
      .filter((material): material is TemplateDetailMaterial => Boolean(material));
    const resultAsset = assets.find(
      (asset) => asset.asset_key === `step-${stepIndex + 1}-result`,
    );
    const resultUrl = resultAsset ? urls.get(resultAsset.id) : undefined;
    // Older saved Lip Sync/Motion Control rows may have been persisted with
    // asset_type=image. The workflow capability is the source of truth for
    // the generated result type, so those existing templates still play.
    const resultType = step.capability.startsWith('video.') ? 'video' : 'image';
    const results: TemplateDetailResult[] = resultAsset && resultUrl
      ? [{
          id: resultAsset.id,
          type: resultType,
          url: resultUrl,
          thumbnail: resultType === 'video' ? coverThumbnail : undefined,
        }]
      : [];
    const prompt = typeof step.parameters?.prompt === 'string'
      ? step.parameters.prompt
      : step.instruction || '';
    return {
      id: step.id,
      name: step.title || `Step ${stepIndex + 1}`,
      featureName: FEATURE_NAMES[step.capability] || step.capability,
      materials,
      prompt,
      results,
    };
  });

  const finalStepResult = [...steps]
    .reverse()
    .find((step) => step.results.length > 0)
    ?.results[0];
  const fallbackType = coverOriginalAsset?.asset_type === 'video' || template.cover_type === 'video'
    ? 'video'
    : 'image';

  return {
    id: template.id,
    slug: template.slug,
    name: template.display_name || template.name,
    status: template.status,
    creatorId: template.creator_id,
    usageCount: Number(template.use_count || 0),
    description: template.description || '',
    finalResult: finalStepResult || {
      id: 'cover',
      type: fallbackType,
      url: coverOriginal,
      thumbnail: coverThumbnail,
    },
    steps,
  };
}
