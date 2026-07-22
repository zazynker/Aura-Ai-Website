import { supabase } from './supabase';
import { fetchPublicProfiles } from './profileApi';
import { AdminUser, AdminStats, TemplateStats, UnusedTemplate } from '../types';

// ============================================
// Admin API Functions
// ============================================

/**
 * 检查当前用户是否是管理员
 */
export async function checkIsAdmin(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (error || !data) return false;
    return data.is_admin === true;
  } catch (err) {
    console.error('Error checking admin status:', err);
    return false;
  }
}

/**
 * 获取用户列表（管理员专用）- 包含用户消耗的总积分
 */
export async function adminGetUsers(
  searchQuery: string = '',
  page: number = 1,
  pageSize: number = 20
): Promise<{ 
  data: { users: AdminUser[]; total: number } | null; 
  error: string | null 
}> {
  try {
    const { data, error } = await supabase.rpc('admin_get_users', {
      search_query: searchQuery,
      page_num: page,
      page_size: pageSize
    });

    if (error) {
      console.error('Error fetching users:', error);
      return { data: null, error: error.message };
    }

    if (!data.success) {
      return { data: null, error: data.error || 'Unknown error' };
    }

    return { 
      data: { 
        users: data.users || [], 
        total: data.total || 0 
      }, 
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch users' };
  }
}

/**
 * 修改用户积分（管理员专用）
 */
export async function adminUpdateCredits(
  userId: string,
  amount: number,
  operation: 'set' | 'add' | 'subtract' = 'set'
): Promise<{ 
  success: boolean; 
  data?: { previous_credits: number; new_credits: number }; 
  error: string | null 
}> {
  try {
    const { data, error } = await supabase.rpc('admin_update_user_credits', {
      target_user_id: userId,
      new_credits: amount,
      operation: operation
    });

    if (error) {
      console.error('Error updating credits:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      return { success: false, error: data.error || 'Unknown error' };
    }

    return { 
      success: true, 
      data: {
        previous_credits: data.previous_credits,
        new_credits: data.new_credits
      },
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to update credits' };
  }
}

/**
 * 修改用户 Plan（管理员专用）
 */
export async function adminUpdatePlan(
  userId: string,
  newPlan: 'Free' | 'Pro',
  bonusCredits: number = 0
): Promise<{ 
  success: boolean; 
  data?: { previous_plan: string; new_plan: string; new_credits: number }; 
  error: string | null 
}> {
  try {
    const { data, error } = await supabase.rpc('admin_update_user_plan', {
      target_user_id: userId,
      new_plan: newPlan,
      bonus_credits: bonusCredits
    });

    if (error) {
      console.error('Error updating plan:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      return { success: false, error: data.error || 'Unknown error' };
    }

    return { 
      success: true, 
      data: {
        previous_plan: data.previous_plan,
        new_plan: data.new_plan,
        new_credits: data.new_credits
      },
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to update plan' };
  }
}

/**
 * 获取统计数据（管理员专用）
 */
export async function adminGetStats(): Promise<{ 
  data: AdminStats | null; 
  error: string | null 
}> {
  try {
    const { data, error } = await supabase.rpc('admin_get_stats');

    if (error) {
      console.error('Error fetching stats:', error);
      return { data: null, error: error.message };
    }

    if (!data.success) {
      return { data: null, error: data.error || 'Unknown error' };
    }

    return { 
      data: {
        total_users: data.total_users,
        pro_users: data.pro_users,
        free_users: data.free_users,
        total_generations: data.total_generations,
        generations_today: data.generations_today,
        generations_this_week: data.generations_this_week,
        total_credits_used: data.total_credits_used
      }, 
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch stats' };
  }
}

/**
 * 获取模板使用统计（管理员专用）- 排除特殊模板，包含缩略图
 */
export async function adminGetTemplateStats(
  limit: number = 20
): Promise<{ 
  data: TemplateStats[] | null; 
  error: string | null 
}> {
  try {
    const { data, error } = await supabase.rpc('admin_get_template_stats', {
      limit_num: limit
    });

    if (error) {
      console.error('Error fetching template stats:', error);
      return { data: null, error: error.message };
    }

    if (!data.success) {
      return { data: null, error: data.error || 'Unknown error' };
    }

    return { 
      data: data.templates || [], 
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch template stats' };
  }
}

/**
 * 获取低使用率/未使用的模板（管理员专用）
 */
export async function adminGetUnusedTemplates(
  maxUsage: number = 2,
  limit: number = 50
): Promise<{ 
  data: UnusedTemplate[] | null; 
  error: string | null 
}> {
  try {
    const { data, error } = await supabase.rpc('admin_get_unused_templates', {
      max_usage: maxUsage,
      limit_num: limit
    });

    if (error) {
      console.error('Error fetching unused templates:', error);
      return { data: null, error: error.message };
    }

    if (!data.success) {
      return { data: null, error: data.error || 'Unknown error' };
    }

    return { 
      data: data.templates || [], 
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch unused templates' };
  }
}
/**
 * 获取指定用户的生成记录（管理员专用）
 */
export interface AdminGeneration {
  id: string;
  image_url: string;
  template_name: string | null;
  prompt: string;
  credits_used: number;
  created_at: string;
}

export async function adminGetUserGenerations(
  userId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  data: { generations: AdminGeneration[]; total: number } | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.rpc('admin_get_user_generations', {
      target_user_id: userId,
      page_num: page,
      page_size: pageSize,
    });

    if (error) {
      console.error('Error fetching user generations:', error);
      return { data: null, error: error.message };
    }

    if (!data.success) {
      return { data: null, error: data.error || 'Unknown error' };
    }

    return {
      data: {
        generations: data.generations || [],
        total: data.total || 0,
      },
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch user generations' };
  }
}
/**
 * 获取视频兴趣点击统计（管理员专用）
 */
export async function adminGetVideoInterestStats(
  searchEmail: string = '',
  dateFrom: string | null = null,
  dateTo: string | null = null
): Promise<{
  data: {
    total_clicks: number;
    unique_users: number;
    grouped_users: Array<{
      email: string;
      click_count: number;
      last_clicked_at: string;
      first_clicked_at: string;
      click_times: string[];
    }>;
  } | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.rpc('admin_get_video_interest_stats', {
      search_email: searchEmail,
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (error) {
      console.error('Error fetching video interest stats:', error);
      return { data: null, error: error.message };
    }
    if (!data?.success) {
      return { data: null, error: data?.error || 'Unknown error' };
    }
    return {
      data: {
        total_clicks: data.total_clicks || 0,
        unique_users: data.unique_users || 0,
        grouped_users: data.grouped_users || [],
      },
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch video interest stats' };
  }
}

export interface AdminReviewMaterial {
  id: string;
  type: 'image' | 'video' | 'audio';
  url?: string;
  reusable: boolean;
}

export interface AdminReviewStep {
  id: string;
  name: string;
  feature: string;
  prompt: string;
  settings: string;
  materials: AdminReviewMaterial[];
  reusable: boolean;
  resultUrl?: string;
  resultType?: 'image' | 'video';
}

export interface AdminReviewTemplate {
  id: string;
  versionId: string;
  name: string;
  coverUrl: string;
  coverType: 'image' | 'video';
  coverPosterUrl?: string;
  authorName: string;
  authorAvatar: string;
  submittedAt: string;
  stepsCount: number;
  description: string;
  status: 'In review';
  steps: AdminReviewStep[];
}

export interface AdminReviewedTemplate {
  id: string;
  name: string;
  authorName: string;
  status: 'Published' | 'Changes requested';
  reviewedAt: string;
}

type RawReviewAsset = {
  asset_key?: string;
  asset_type?: string;
  public_url?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  is_reusable?: boolean | null;
};

type RawReviewTemplate = {
  id: string;
  version_id: string;
  creator_id?: string | null;
  creator_username?: string | null;
  creator_avatar_url?: string | null;
  name?: string | null;
  cover_url?: string | null;
  thumb_url?: string | null;
  image_url?: string | null;
  cover_type?: string | null;
  creator_email?: string | null;
  submitted_at?: string | null;
  description?: string | null;
  workflow?: Record<string, unknown> | null;
  assets?: RawReviewAsset[] | null;
};

async function signedAssetUrl(asset?: RawReviewAsset): Promise<string | undefined> {
  if (!asset) return undefined;
  if (asset.public_url) return asset.public_url;
  if (!asset.storage_bucket || !asset.storage_path) return undefined;
  const { data, error } = await supabase.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_path, 3600);
  if (error) return undefined;
  return data.signedUrl;
}

async function mapPendingReview(
  row: RawReviewTemplate,
  creatorProfile?: { username: string; avatarUrl: string | null },
): Promise<AdminReviewTemplate> {
  const workflowSteps = Array.isArray(row.workflow?.steps)
    ? row.workflow.steps as Array<Record<string, unknown>>
    : [];
  const assets = Array.isArray(row.assets) ? row.assets : [];
  const coverOriginalAsset = assets.find((asset) => asset.asset_key === 'cover-original');
  const coverThumbnailAsset = assets.find((asset) => asset.asset_key === 'cover-thumbnail');
  const [savedCoverUrl, savedPosterUrl] = await Promise.all([
    signedAssetUrl(coverOriginalAsset),
    signedAssetUrl(coverThumbnailAsset),
  ]);
  const originalCoverUrl = savedCoverUrl || row.cover_url || row.image_url || '';
  const coverPosterUrl = savedPosterUrl || row.thumb_url || row.image_url || undefined;
  const coverType = coverOriginalAsset?.asset_type === 'video'
    || row.cover_type === 'video'
    || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(originalCoverUrl)
    ? 'video' as const
    : 'image' as const;
  const steps = await Promise.all(workflowSteps.map(async (step, index): Promise<AdminReviewStep> => {
    const parameters = step.parameters && typeof step.parameters === 'object'
      ? step.parameters as Record<string, unknown>
      : {};
    const resultAsset = assets.find((asset) => asset.asset_key === `step-${index + 1}-result`);
    const materialAssets = assets.filter((asset) => asset.asset_key?.startsWith(`step-${index + 1}-material-`));
    const prompt = typeof step.instruction === 'string'
      ? step.instruction
      : typeof parameters.prompt === 'string' ? parameters.prompt : '';
    const resultUrl = await signedAssetUrl(resultAsset);
    const materials = await Promise.all(
      materialAssets.map(async (asset, materialIndex): Promise<AdminReviewMaterial> => ({
        id: asset.asset_key || `step-${index + 1}-material-${materialIndex + 1}`,
        type:
          asset.asset_type === 'video'
            ? 'video'
            : asset.asset_type === 'audio'
              ? 'audio'
              : 'image',
        url: await signedAssetUrl(asset),
        reusable: asset.is_reusable !== false,
      })),
    );
    const output = step.output && typeof step.output === 'object'
      ? step.output as Record<string, unknown>
      : {};
    const capability = typeof step.capability === 'string' ? step.capability : '';
    const isVideoResult = resultAsset?.asset_type === 'video'
      || output.assetType === 'video'
      || capability.startsWith('video.')
      || Boolean(resultUrl && /\.(mp4|webm|mov)(?:$|[?#])/i.test(resultUrl));
    return {
      id: typeof step.id === 'string' ? step.id : `step-${index + 1}`,
      name: typeof step.title === 'string' ? step.title : `Step ${index + 1}`,
      feature: capability || 'Unknown capability',
      prompt,
      settings: JSON.stringify(parameters, null, 2),
      materials,
      reusable: materials.length === 0 || materials.every((asset) => asset.reusable),
      resultUrl,
      resultType: isVideoResult ? 'video' : 'image',
    };
  }));
  const email = row.creator_email || 'Creator';
  return {
    id: row.id,
    versionId: row.version_id,
    name: row.name || 'Untitled workflow template',
    coverUrl: coverType === 'video'
      ? originalCoverUrl || coverPosterUrl || ''
      : coverPosterUrl || originalCoverUrl,
    coverType,
    coverPosterUrl: coverType === 'video' ? coverPosterUrl : undefined,
    authorName: row.creator_username
      || creatorProfile?.username
      || (email.includes('@') ? email.split('@')[0] : email),
    authorAvatar: row.creator_avatar_url || creatorProfile?.avatarUrl || '',
    submittedAt: row.submitted_at || new Date().toISOString(),
    stepsCount: steps.length,
    description: row.description || 'No description provided.',
    status: 'In review',
    steps,
  };
}

export async function adminGetTemplateReviews(): Promise<{
  data: { pending: AdminReviewTemplate[]; recent: AdminReviewedTemplate[] } | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.rpc('admin_list_template_reviews', { p_limit: 50 });
    if (error) return { data: null, error: error.message };
    if (!data?.success) return { data: null, error: data?.error || 'Could not load reviews.' };
    const pendingRows = (data.pending || []) as RawReviewTemplate[];
    const recentRows = (data.recent || []) as Array<Record<string, unknown>>;
    const profiles = await fetchPublicProfiles(
      [
        ...pendingRows.map((row) => row.creator_id),
        ...recentRows.map((row) => typeof row.creator_id === 'string' ? row.creator_id : null),
      ].filter((id): id is string => Boolean(id)),
    );
    const pending = await Promise.all(pendingRows.map((row) => mapPendingReview(
      row,
      row.creator_id ? profiles.get(row.creator_id) : undefined,
    )));
    const recent = recentRows.map((row): AdminReviewedTemplate => ({
      id: String(row.id || ''),
      name: String(row.name || 'Untitled workflow template'),
      authorName: (typeof row.creator_username === 'string' && row.creator_username)
        || (typeof row.creator_id === 'string' && profiles.get(row.creator_id)?.username)
        || String(row.creator_email || 'Creator').split('@')[0],
      status: row.action === 'approved' ? 'Published' : 'Changes requested',
      reviewedAt: String(row.reviewed_at || new Date().toISOString()),
    }));
    return { data: { pending, recent }, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Could not load reviews.' };
  }
}

export async function adminReviewTemplate(
  templateId: string,
  versionId: string,
  decision: 'approve' | 'request_changes',
  feedback?: string,
): Promise<{ success: boolean; error: string | null; alreadyProcessed?: boolean }> {
  try {
    const { data, error } = await supabase.rpc('admin_review_template', {
      p_template_id: templateId,
      p_version_id: versionId,
      p_decision: decision,
      p_feedback: feedback || null,
    });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'Could not save this review.' };
    return { success: true, error: null, alreadyProcessed: Boolean(data.already_processed) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not save this review.' };
  }
}
