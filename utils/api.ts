import { supabase, dbToTemplate, DbTemplate } from './supabase';
import { Template, Plan } from '../types';

// ============================================
// 历史记录限制配置
// ============================================
export const GENERATION_LIMITS = {
  Free: 50,  // Free 用户最多 50 张历史记录
  Pro: 100,  // Pro 用户最多 100 张历史记录
};

export interface FetchTemplatesOptions {
  search?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface FetchTemplatesResult {
  templates: Template[];
  total: number;
  error: string | null;
}

/**
 * Fetch templates from Supabase with optional filtering
 */
export async function fetchTemplates(
  options: FetchTemplatesOptions = {}
): Promise<FetchTemplatesResult> {
  const { search = '', category = 'All', limit = 300, offset = 0 } = options;

  try {
    // Build query
    let query = supabase
      .from('templates')
      .select('*', { count: 'exact' });

    // Category filter
    if (category && category !== 'All') {
      query = query.eq('category', category);
    }

    // Search filter (search in name and tags)
    if (search.trim()) {
      const searchTerm = search.trim().toLowerCase();
      // Use ilike for name, or check if search term is in tags array
      query = query.or(`name.ilike.%${searchTerm}%,tags.cs.{${searchTerm}}`);
    }

    // Pagination and ordering
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching templates:', error);
      return { templates: [], total: 0, error: error.message };
    }

    const templates = (data as DbTemplate[]).map(dbToTemplate);

    return {
      templates,
      total: count || templates.length,
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error fetching templates:', err);
    return {
      templates: [],
      total: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Fetch a single template by ID
 */
export async function fetchTemplateById(id: string): Promise<Template | null> {
  try {
    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      console.error('Error fetching template:', error);
      return null;
    }

    return dbToTemplate(data as DbTemplate);
  } catch (err) {
    console.error('Unexpected error fetching template:', err);
    return null;
  }
}

/**
 * Get all unique categories from templates
 */
export async function fetchCategories(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('templates')
      .select('category');

    if (error || !data) {
      return ['All'];
    }

    const uniqueCategories = [...new Set(data.map((d) => d.category))];
    return ['All', ...uniqueCategories.sort()];
  } catch (err) {
    console.error('Error fetching categories:', err);
    return ['All'];
  }
}

// ============================================
// Generations API (用户生成历史)
// ============================================

interface DbGeneration {
  id: string;
  user_id: string;
  template_id: string;
  template_name: string | null;
  image_url: string;
  prompt: string;
  credits_used: number;
  created_at: string;
  media_type?: string;
  video_url?: string;
  video_duration?: number;
  video_aspect_ratio?: string;
  video_mode?: string;
  capability?: string;
  input_assets?: import('../types').GenerationInputAssetSnapshot[] | null;
  generation_parameters?: import('../workflows/types').JsonObject | null;
}

// 数据库格式 -> 前端格式
const dbToGeneration = (db: DbGeneration): import('../types').Generation => ({
  id: db.id,
  userId: db.user_id,
  templateId: db.template_id,
  templateName: db.template_name || undefined,
  imageUrl: db.image_url,
  prompt: db.prompt,
  creditsUsed: db.credits_used,
  createdAt: new Date(db.created_at).getTime(),
  mediaType: (db.media_type as 'image' | 'video') || 'image',
  videoUrl: db.video_url || undefined,
  videoDuration: db.video_duration || undefined,
  videoAspectRatio: db.video_aspect_ratio || undefined,
  videoMode: (db.video_mode as 'image_to_video' | 'motion_control' | 'lip_sync') || undefined,
  capability: db.capability as import('../workflows/types').WorkflowCapabilityKey | undefined,
  inputAssets: db.input_assets || undefined,
  generationParameters: db.generation_parameters || undefined,
});

/**
 * 获取用户的生成历史（带分页）
 */
export async function fetchUserGenerations(
  page: number = 1,
  limit: number = 20
): Promise<{ data: import('../types').Generation[]; hasMore: boolean; error: string | null }> {
  try {
    const offset = (page - 1) * limit;
    
    const { data, error, count } = await supabase
      .from('generations')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching generations:', error);
      return { data: [], hasMore: false, error: error.message };
    }

    const generations = (data as DbGeneration[]).map(dbToGeneration);
    const hasMore = count ? offset + limit < count : false;

    return { data: generations, hasMore, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: [], hasMore: false, error: 'Failed to fetch generations' };
  }
}

/**
 * 获取用户当前的历史记录数量
 */
export async function getUserGenerationCount(): Promise<{ count: number; error: string | null }> {
  try {
    const { count, error } = await supabase
      .from('generations')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error counting generations:', error);
      return { count: 0, error: error.message };
    }

    return { count: count || 0, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { count: 0, error: 'Failed to count generations' };
  }
}

/**
 * 删除最旧的历史记录，直到数量符合限制
 * @param userPlan 用户的计划类型
 * @param newCount 即将添加的新记录数量
 */
export async function enforceGenerationLimit(
  userPlan: Plan,
  newCount: number = 1
): Promise<{ deletedCount: number; error: string | null }> {
  try {
    const limit = GENERATION_LIMITS[userPlan] || GENERATION_LIMITS.Free;
    
    // 获取当前数量
    const { count: currentCount, error: countError } = await getUserGenerationCount();
    if (countError) {
      return { deletedCount: 0, error: countError };
    }

    // 计算需要删除多少条
    const totalAfterAdd = currentCount + newCount;
    const toDelete = totalAfterAdd - limit;

    if (toDelete <= 0) {
      console.log(`[GenerationLimit] Current: ${currentCount}, Adding: ${newCount}, Limit: ${limit} - No deletion needed`);
      return { deletedCount: 0, error: null };
    }

    console.log(`[GenerationLimit] Current: ${currentCount}, Adding: ${newCount}, Limit: ${limit} - Need to delete ${toDelete} oldest records`);

    // 获取最旧的 N 条记录的 ID
    const { data: oldestRecords, error: fetchError } = await supabase
      .from('generations')
      .select('id, image_url')
      .order('created_at', { ascending: true })
      .limit(toDelete);

    if (fetchError || !oldestRecords) {
      console.error('Error fetching oldest records:', fetchError);
      return { deletedCount: 0, error: fetchError?.message || 'Failed to fetch oldest records' };
    }

    const idsToDelete = oldestRecords.map(r => r.id);
    const imageUrls = oldestRecords.map(r => r.image_url);

    // 删除数据库记录
    const { error: deleteError } = await supabase
      .from('generations')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) {
      console.error('Error deleting old generations:', deleteError);
      return { deletedCount: 0, error: deleteError.message };
    }

    // 尝试删除 Storage 中的图片（可选，失败不影响主流程）
    try {
      const pathsToDelete = imageUrls
        .filter(url => url.includes('/generations/'))
        .map(url => {
          // 从 URL 提取文件路径
          const match = url.match(/\/generations\/(.+)$/);
          return match ? match[1].split('?')[0] : null;
        })
        .filter(Boolean) as string[];

      if (pathsToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('generations')
          .remove(pathsToDelete);
        
        if (storageError) {
          console.warn('[GenerationLimit] Failed to delete some storage files:', storageError);
        } else {
          console.log(`[GenerationLimit] Deleted ${pathsToDelete.length} files from storage`);
        }
      }
    } catch (storageErr) {
      console.warn('[GenerationLimit] Storage cleanup failed:', storageErr);
      // 不影响主流程
    }

    console.log(`[GenerationLimit] Successfully deleted ${idsToDelete.length} old records`);
    return { deletedCount: idsToDelete.length, error: null };
  } catch (err) {
    console.error('Unexpected error in enforceGenerationLimit:', err);
    return { deletedCount: 0, error: 'Failed to enforce generation limit' };
  }
}

/**
 * 保存新的生成记录到数据库（带自动清理旧记录）
 */
export async function saveGenerationToDb(
  generation: Omit<import('../types').Generation, 'id' | 'createdAt'>,
  userPlan: Plan = 'Free'
): Promise<{ data: import('../types').Generation | null; error: string | null; deletedOldCount?: number }> {
  try {
    // 先清理超限的旧记录
    const { deletedCount, error: limitError } = await enforceGenerationLimit(userPlan, 1);
    if (limitError) {
      console.warn('[SaveGeneration] Limit enforcement failed:', limitError);
      // 继续保存，不阻塞
    }

    const dbData: Record<string, unknown> = {
      user_id: generation.userId,
      template_id: generation.templateId,
      template_name: generation.templateName || null,
      image_url: generation.imageUrl,
      prompt: generation.prompt,
      credits_used: generation.creditsUsed,
      media_type: generation.mediaType || 'image',
      video_url: generation.videoUrl || null,
      video_duration: generation.videoDuration || null,
      video_aspect_ratio: generation.videoAspectRatio || null,
      video_mode: generation.videoMode || null,
      capability: generation.capability || null,
      input_assets: generation.inputAssets || [],
      generation_parameters: generation.generationParameters || {},
    };

    const { data, error } = await supabase
      .from('generations')
      .insert(dbData)
      .select()
      .single();

    if (error) {
      console.error('Error saving generation:', error);
      return { data: null, error: error.message };
    }

    return { data: dbToGeneration(data as DbGeneration), error: null, deletedOldCount: deletedCount };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to save generation' };
  }
}

/**
 * 批量保存生成记录（带自动清理旧记录）
 */
export async function saveGenerationsToDb(
  generations: Omit<import('../types').Generation, 'id' | 'createdAt'>[],
  userPlan: Plan = 'Free'
): Promise<{ data: import('../types').Generation[]; error: string | null; deletedOldCount?: number }> {
  try {
    // 先清理超限的旧记录
    const { deletedCount, error: limitError } = await enforceGenerationLimit(userPlan, generations.length);
    if (limitError) {
      console.warn('[SaveGenerations] Limit enforcement failed:', limitError);
      // 继续保存，不阻塞
    }

    const dbData = generations.map(gen => ({
      user_id: gen.userId,
      template_id: gen.templateId,
      template_name: gen.templateName || null,
      image_url: gen.imageUrl,
      prompt: gen.prompt,
      credits_used: gen.creditsUsed,
      media_type: gen.mediaType || 'image',
      video_url: gen.videoUrl || null,
      video_duration: gen.videoDuration || null,
      video_aspect_ratio: gen.videoAspectRatio || null,
      video_mode: gen.videoMode || null,
      capability: gen.capability || null,
      input_assets: gen.inputAssets || [],
      generation_parameters: gen.generationParameters || {},
    }));

    const { data, error } = await supabase
      .from('generations')
      .insert(dbData)
      .select();

    if (error) {
      console.error('Error saving generations:', error);
      return { data: [], error: error.message };
    }

    return { 
      data: (data as DbGeneration[]).map(dbToGeneration), 
      error: null,
      deletedOldCount: deletedCount
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: [], error: 'Failed to save generations' };
  }
}

/**
 * 删除生成记录
 */
export async function deleteGenerationFromDb(
  generationId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { error } = await supabase
      .from('generations')
      .delete()
      .eq('id', generationId);

    if (error) {
      console.error('Error deleting generation:', error);
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to delete generation' };
  }
}

// ============================================
// Collections API (用户收藏夹)
// ============================================

interface DbCollection {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

interface DbCollectionItem {
  id: string;
  collection_id: string;
  template_id: string;
  created_at: string;
}

/**
 * 获取用户的所有收藏夹（包含其中的模板ID）
 */
export async function fetchUserCollections(): Promise<{ 
  data: import('../types').Collection[]; 
  error: string | null 
}> {
  try {
    console.log('=== fetchUserCollections called ===');
    
    // 获取所有收藏夹
    const { data: collections, error: colError } = await supabase
      .from('collections')
      .select('*')
      .order('created_at', { ascending: true });

    if (colError) {
      console.error('Error fetching collections:', colError);
      return { data: [], error: colError.message };
    }

    if (!collections || collections.length === 0) {
      return { data: [], error: null };
    }

    // 获取所有收藏夹的项目
    const collectionIds = collections.map(c => c.id);
    const { data: items, error: itemsError } = await supabase
      .from('collection_items')
      .select('*')
      .in('collection_id', collectionIds);

    if (itemsError) {
      console.error('Error fetching collection items:', itemsError);
      // 返回空的收藏夹
      return { 
        data: collections.map(c => ({
          id: c.id,
          userId: c.user_id,
          name: c.name,
          imageIds: []
        })), 
        error: null 
      };
    }

    // 组装数据
    const result = collections.map(col => ({
      id: col.id,
      userId: col.user_id,
      name: col.name,
      imageIds: (items || [])
        .filter(item => item.collection_id === col.id)
        .map(item => item.template_id)
    }));

    console.log('Fetched collections:', result.length);
    return { data: result, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: [], error: 'Failed to fetch collections' };
  }
}

/**
 * 创建新收藏夹
 */
export async function createCollectionInDb(
  name: string
): Promise<{ data: import('../types').Collection | null; error: string | null }> {
  try {
    console.log('=== createCollectionInDb called ===', name);
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: null, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('collections')
      .insert({ user_id: user.id, name })
      .select()
      .single();

    if (error) {
      console.error('Error creating collection:', error);
      return { data: null, error: error.message };
    }

    console.log('Created collection:', data);
    return { 
      data: {
        id: data.id,
        userId: data.user_id,
        name: data.name,
        imageIds: []
      }, 
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to create collection' };
  }
}

/**
 * 删除收藏夹
 */
export async function deleteCollectionFromDb(
  collectionId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    console.log('=== deleteCollectionFromDb called ===', collectionId);
    
    const { error } = await supabase
      .from('collections')
      .delete()
      .eq('id', collectionId);

    if (error) {
      console.error('Error deleting collection:', error);
      return { success: false, error: error.message };
    }

    console.log('Deleted collection');
    return { success: true, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to delete collection' };
  }
}

/**
 * 添加模板到收藏夹
 */
export async function addItemToCollectionInDb(
  collectionId: string,
  templateId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    console.log('=== addItemToCollectionInDb called ===', { collectionId, templateId });
    
    const { error } = await supabase
      .from('collection_items')
      .insert({ collection_id: collectionId, template_id: templateId });

    if (error) {
      // 如果是重复添加，不算错误
      if (error.code === '23505') {
        console.log('Already in collection');
        return { success: true, error: null };
      }
      console.error('Error adding to collection:', error);
      return { success: false, error: error.message };
    }

    console.log('Added to collection');
    return { success: true, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to add to collection' };
  }
}

/**
 * 从收藏夹移除模板
 */
export async function removeItemFromCollectionInDb(
  collectionId: string,
  templateId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    console.log('=== removeItemFromCollectionInDb called ===', { collectionId, templateId });
    
    const { error } = await supabase
      .from('collection_items')
      .delete()
      .eq('collection_id', collectionId)
      .eq('template_id', templateId);

    if (error) {
      console.error('Error removing from collection:', error);
      return { success: false, error: error.message };
    }

    console.log('Removed from collection');
    return { success: true, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to remove from collection' };
  }
}

// ============================================
// User Credits API (用户积分)
// ============================================

export interface UserCreditsData {
  credits: number;
  plan: string;
  maxCredits: number;
  isWhitelisted: boolean;
  isAdmin?: boolean;
  welcomeGiftEligible: boolean;
  welcomeGiftRedeemed: boolean;
  welcomeGiftExpiresAt: string | null;
  welcomeGiftReason: string;
}

/**
 * 从数据库获取用户积分信息
 */
export async function fetchUserCredits(): Promise<{ 
  data: UserCreditsData | null; 
  error: string | null 
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: null, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('users')
      .select('credits, plan, max_credits, is_whitelisted, is_admin')
      .eq('id', user.id)
      .single();

    if (error) {
      // New-user provisioning must be server-controlled. The RPC assigns the fixed
      // welcome balance and prevents callers from choosing credits, plan, or admin flags.
      if (error.code === 'PGRST116') {
        console.log('User not found in users table, provisioning securely...');
        const { data: ensured, error: ensureError } = await supabase.rpc(
          'ensure_user_profile'
        );

        if (ensureError) {
          console.error('Secure user provisioning failed:', ensureError);
          return { data: null, error: ensureError.message };
        }

        const newUser = Array.isArray(ensured) ? ensured[0] : ensured;
        if (!newUser || typeof newUser !== 'object') {
          return { data: null, error: 'User profile provisioning returned no data' };
        }

        const { data: eligibility } = await supabase.rpc(
          'get_my_welcome_gift_eligibility'
        );

        return {
          data: {
            credits: Number(newUser.credits) || 0,
            plan: String(newUser.plan || 'Free'),
            maxCredits: Number(newUser.max_credits) || 0,
            isWhitelisted: Boolean(newUser.is_whitelisted),
            isAdmin: Boolean(newUser.is_admin),
            welcomeGiftEligible: Boolean(eligibility?.eligible),
            welcomeGiftRedeemed: Boolean(eligibility?.redeemed),
            welcomeGiftExpiresAt: eligibility?.expires_at || null,
            welcomeGiftReason: String(eligibility?.reason || 'not_eligible'),
          },
          error: null,
        };
      }
      
      console.error('Error fetching user credits:', error);
      return { data: null, error: error.message };
    }

    const { data: eligibility, error: eligibilityError } = await supabase.rpc(
      'get_my_welcome_gift_eligibility'
    );
    if (eligibilityError) {
      console.warn('Failed to fetch welcome gift eligibility:', eligibilityError.message);
    }

    return { 
      data: {
        credits: data.credits,
        plan: data.plan,
        maxCredits: data.max_credits,
        isWhitelisted: data.is_whitelisted || false,
        isAdmin: data.is_admin || false,
        welcomeGiftEligible: Boolean(eligibility?.eligible),
        welcomeGiftRedeemed: Boolean(eligibility?.redeemed),
        welcomeGiftExpiresAt: eligibility?.expires_at || null,
        welcomeGiftReason: String(eligibility?.reason || 'not_eligible')
      }, 
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch credits' };
  }
}

/**
 * @deprecated Credit balances are server-controlled.
 * Client code must never write the users.credits column directly.
 */
export async function deductUserCredits(
  _amount: number
): Promise<{ success: boolean; newCredits: number; error: string | null }> {
  return {
    success: false,
    newCredits: 0,
    error: 'Client-side credit changes are disabled',
  };
}

/**
 * @deprecated Credits may only be granted by trusted server code or payment webhooks.
 */
export async function addUserCredits(
  _amount: number
): Promise<{ success: boolean; newCredits: number; error: string | null }> {
  return {
    success: false,
    newCredits: 0,
    error: 'Client-side credit changes are disabled',
  };
}
/**
 * 记录用户对视频生成功能的兴趣点击
 */
export async function logVideoInterest(): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('log_video_interest');
    if (error) {
      console.error('Error logging video interest:', error);
      return { success: false, error: error.message };
    }
    return { success: data?.success ?? false, error: data?.error || null };
  } catch (err) {
    console.error('Unexpected error logging video interest:', err);
    return { success: false, error: 'Failed to log video interest' };
  }
}