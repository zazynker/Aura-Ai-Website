import { supabase } from './supabase';
import {
  TEMPLATE_ASSETS_BUCKET,
  TEMPLATE_PREVIEWS_BUCKET,
  removeTemplateStorageObjects,
} from './templateStorage';

export type CreatorTemplateStatus =
  | 'Draft'
  | 'In review'
  | 'Published'
  | 'Changes requested';

export interface CreatorTemplateCard {
  id: string;
  slug: string;
  name: string;
  coverUrl: string;
  coverType: 'image' | 'video';
  status: CreatorTemplateStatus;
  updatedAt: string;
  stepsCount: number;
  uses: number;
  creditsEarned: number;
  feedback?: string;
}

interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  image_url: string;
  thumb_url: string | null;
  cover_url: string | null;
  cover_type: string;
  status: 'draft' | 'pending_review' | 'published' | 'rejected';
  current_version_id: string | null;
  updated_at: string;
  use_count: number | string | null;
}

const STATUS_LABELS: Record<TemplateRow['status'], CreatorTemplateStatus> = {
  draft: 'Draft',
  pending_review: 'In review',
  published: 'Published',
  rejected: 'Changes requested',
};

function workflowStepCount(workflow: unknown): number {
  if (!workflow || typeof workflow !== 'object') return 0;
  const steps = (workflow as { steps?: unknown }).steps;
  return Array.isArray(steps) ? steps.length : 0;
}

export async function fetchCreatorTemplates(
  userId: string,
): Promise<CreatorTemplateCard[]> {
  const { data: templateData, error: templateError } = await supabase
    .from('templates')
    .select('id,slug,name,display_name,image_url,thumb_url,cover_url,cover_type,status,current_version_id,updated_at,use_count')
    .eq('creator_id', userId)
    .in('status', ['draft', 'pending_review', 'published', 'rejected'])
    .like('template_kind', 'workflow_%')
    .order('updated_at', { ascending: false });
  if (templateError) {
    throw new Error(`Could not load your templates: ${templateError.message}`);
  }

  const templates = (templateData || []) as TemplateRow[];
  if (templates.length === 0) return [];

  const templateIds = templates.map((template) => template.id);
  const versionIds = templates
    .map((template) => template.current_version_id)
    .filter((id): id is string => Boolean(id));

  const [versionsResult, logsResult, rewardsResult, coverAssetsResult] = await Promise.all([
    versionIds.length
      ? supabase
          .from('template_versions')
          .select('id,workflow')
          .in('id', versionIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('template_review_logs')
      .select('template_id,action,note,created_at')
      .in('template_id', templateIds)
      .order('created_at', { ascending: false }),
    supabase
      .from('template_creator_rewards')
      .select('template_id,reward_credits')
      .eq('creator_id', userId)
      .in('template_id', templateIds),
    supabase
      .from('template_assets')
      .select('template_id,asset_key,asset_type,public_url')
      .in('template_id', templateIds)
      .in('asset_key', ['cover-thumbnail', 'cover-original']),
  ]);

  if (versionsResult.error) {
    throw new Error(`Could not load workflow versions: ${versionsResult.error.message}`);
  }
  if (logsResult.error) {
    throw new Error(`Could not load review feedback: ${logsResult.error.message}`);
  }

  const workflowByVersion = new Map<string, unknown>(
    (versionsResult.data || []).map((row: { id: string; workflow: unknown }) => [
      row.id,
      row.workflow,
    ]),
  );
  const latestFeedbackByTemplate = new Map<string, string>();
  for (const row of logsResult.data || []) {
    if (
      row.action === 'rejected' &&
      row.note &&
      !latestFeedbackByTemplate.has(row.template_id)
    ) {
      latestFeedbackByTemplate.set(row.template_id, row.note);
    }
  }
  const creditsByTemplate = new Map<string, number>();
  if (!rewardsResult.error) {
    for (const row of rewardsResult.data || []) {
      creditsByTemplate.set(
        row.template_id,
        (creditsByTemplate.get(row.template_id) || 0) +
          Number(row.reward_credits || 0),
      );
    }
  }

  const coverAssetsByTemplate = new Map<
    string,
    { thumbnail?: string; original?: string; originalType?: 'image' | 'video' }
  >();
  if (!coverAssetsResult.error) {
    for (const row of coverAssetsResult.data || []) {
      const cover = coverAssetsByTemplate.get(row.template_id) || {};
      if (row.asset_key === 'cover-thumbnail' && row.public_url) {
        cover.thumbnail = row.public_url;
      }
      if (row.asset_key === 'cover-original' && row.public_url) {
        cover.original = row.public_url;
        cover.originalType = row.asset_type === 'video' ? 'video' : 'image';
      }
      coverAssetsByTemplate.set(row.template_id, cover);
    }
  }

  return templates.map((template) => {
    const savedCover = coverAssetsByTemplate.get(template.id);
    const thumbnailUrl = savedCover?.thumbnail || template.thumb_url;
    const originalUrl = savedCover?.original || template.cover_url;
    return {
      id: template.id,
      slug: template.slug,
      name: template.display_name || template.name,
      coverUrl: thumbnailUrl || originalUrl || '',
      coverType: thumbnailUrl
        ? 'image'
        : savedCover?.originalType || (template.cover_type === 'video' ? 'video' : 'image'),
      status: STATUS_LABELS[template.status],
      updatedAt: template.updated_at,
      stepsCount: template.current_version_id
        ? workflowStepCount(workflowByVersion.get(template.current_version_id))
        : 0,
      uses: Number(template.use_count || 0),
      creditsEarned: creditsByTemplate.get(template.id) || 0,
      feedback: latestFeedbackByTemplate.get(template.id),
    };
  });
}

export async function deleteCreatorDraft(
  templateId: string,
  userId: string,
): Promise<void> {
  const { data: assets, error: assetError } = await supabase
    .from('template_assets')
    .select('storage_bucket,storage_path')
    .eq('template_id', templateId);
  if (assetError) {
    throw new Error(`Could not inspect draft files: ${assetError.message}`);
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('templates')
    .delete()
    .eq('id', templateId)
    .eq('creator_id', userId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();
  if (deleteError) {
    throw new Error(`Could not delete the draft: ${deleteError.message}`);
  }
  if (!deleted) {
    throw new Error('Only your own draft templates can be deleted.');
  }

  const previewPaths: string[] = [];
  const assetPaths: string[] = [];
  for (const asset of assets || []) {
    if (!asset.storage_path) continue;
    if (asset.storage_bucket === TEMPLATE_PREVIEWS_BUCKET) {
      previewPaths.push(asset.storage_path);
    }
    if (asset.storage_bucket === TEMPLATE_ASSETS_BUCKET) {
      assetPaths.push(asset.storage_path);
    }
  }
  await Promise.allSettled([
    removeTemplateStorageObjects(TEMPLATE_PREVIEWS_BUCKET, previewPaths),
    removeTemplateStorageObjects(TEMPLATE_ASSETS_BUCKET, assetPaths),
  ]);
}
