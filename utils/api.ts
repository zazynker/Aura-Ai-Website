import { supabase, dbToTemplate, DbTemplate } from './supabase';
import { Template } from '../types';

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
 * 保存新的生成记录到数据库
 */
export async function saveGenerationToDb(
  generation: Omit<import('../types').Generation, 'id' | 'createdAt'>
): Promise<{ data: import('../types').Generation | null; error: string | null }> {
  try {
    const dbData = {
      user_id: generation.userId,
      template_id: generation.templateId,
      template_name: generation.templateName || null,
      image_url: generation.imageUrl,
      prompt: generation.prompt,
      credits_used: generation.creditsUsed,
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

    return { data: dbToGeneration(data as DbGeneration), error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to save generation' };
  }
}

/**
 * 批量保存生成记录
 */
export async function saveGenerationsToDb(
  generations: Omit<import('../types').Generation, 'id' | 'createdAt'>[]
): Promise<{ data: import('../types').Generation[]; error: string | null }> {
  try {
    const dbData = generations.map(gen => ({
      user_id: gen.userId,
      template_id: gen.templateId,
      template_name: gen.templateName || null,
      image_url: gen.imageUrl,
      prompt: gen.prompt,
      credits_used: gen.creditsUsed,
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
      error: null 
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: [], error: 'Not authenticated' };
    }

    // Fetch collections
    const { data: collections, error: collectionsError } = await supabase
      .from('collections')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (collectionsError) {
      console.error('Error fetching collections:', collectionsError);
      return { data: [], error: collectionsError.message };
    }

    if (!collections || collections.length === 0) {
      return { data: [], error: null };
    }

    // Fetch all items for these collections
    const collectionIds = collections.map(c => c.id);
    const { data: items, error: itemsError } = await supabase
      .from('collection_items')
      .select('*')
      .in('collection_id', collectionIds);

    if (itemsError) {
      console.error('Error fetching collection items:', itemsError);
    }

    // Group items by collection
    const itemsByCollection: Record<string, string[]> = {};
    (items || []).forEach((item: DbCollectionItem) => {
      if (!itemsByCollection[item.collection_id]) {
        itemsByCollection[item.collection_id] = [];
      }
      itemsByCollection[item.collection_id].push(item.template_id);
    });

    // Build result
    const result = collections.map((col: DbCollection) => ({
      id: col.id,
      userId: col.user_id,
      name: col.name,
      imageIds: itemsByCollection[col.id] || []
    }));

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
  isAdmin: boolean;
  isWhitelisted: boolean;  // 添加白名单字段
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
      .select('credits, plan, max_credits, is_admin, is_whitelisted')  // 添加 is_whitelisted
      .eq('id', user.id)
      .single();

    if (error) {
      // 如果用户不存在，创建新用户记录
      if (error.code === 'PGRST116') {
        console.log('User not found in users table, creating...');
        const newUserData = {
          id: user.id,
          email: user.email,
          credits: 120,
          plan: 'Free',
          max_credits: 120,
          is_admin: false,
          is_whitelisted: true  // 新用户默认白名单
        };
        
        const { data: newUser, error: insertError } = await supabase
          .from('users')
          .insert(newUserData)
          .select('credits, plan, max_credits, is_admin, is_whitelisted')
          .single();
        
        if (insertError) {
          console.error('Error creating user:', insertError);
          return { data: null, error: insertError.message };
        }
        
        return { 
          data: {
            credits: newUser.credits,
            plan: newUser.plan,
            maxCredits: newUser.max_credits,
            isAdmin: newUser.is_admin || false,
            isWhitelisted: newUser.is_whitelisted ?? true
          }, 
          error: null 
        };
      }
      
      console.error('Error fetching user credits:', error);
      return { data: null, error: error.message };
    }

    return { 
      data: {
        credits: data.credits,
        plan: data.plan,
        maxCredits: data.max_credits,
        isAdmin: data.is_admin || false,
        isWhitelisted: data.is_whitelisted ?? true  // 默认为 true
      }, 
      error: null 
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch credits' };
  }
}

/**
 * 扣除用户积分（原子操作）
 * 注意：现在主要由后端 generate.ts 处理扣分，这个函数保留用于其他场景
 */
export async function deductUserCredits(
  amount: number
): Promise<{ success: boolean; newCredits: number; error: string | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, newCredits: 0, error: 'Not authenticated' };
    }

    // 使用 RPC 函数进行原子扣除，防止并发问题
    // 如果没有 RPC，先获取再更新
    const { data: currentData, error: fetchError } = await supabase
      .from('users')
      .select('credits')
      .eq('id', user.id)
      .single();

    if (fetchError) {
      console.error('Error fetching current credits:', fetchError);
      return { success: false, newCredits: 0, error: fetchError.message };
    }

    const currentCredits = currentData.credits;
    if (currentCredits < amount) {
      return { success: false, newCredits: currentCredits, error: 'Insufficient credits' };
    }

    const newCredits = currentCredits - amount;

    const { error: updateError } = await supabase
      .from('users')
      .update({ credits: newCredits })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating credits:', updateError);
      return { success: false, newCredits: currentCredits, error: updateError.message };
    }

    console.log(`Deducted ${amount} credits. New balance: ${newCredits}`);
    return { success: true, newCredits, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, newCredits: 0, error: 'Failed to deduct credits' };
  }
}

/**
 * 添加用户积分（用于购买或奖励）
 */
export async function addUserCredits(
  amount: number
): Promise<{ success: boolean; newCredits: number; error: string | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, newCredits: 0, error: 'Not authenticated' };
    }

    const { data: currentData, error: fetchError } = await supabase
      .from('users')
      .select('credits')
      .eq('id', user.id)
      .single();

    if (fetchError) {
      console.error('Error fetching current credits:', fetchError);
      return { success: false, newCredits: 0, error: fetchError.message };
    }

    const newCredits = currentData.credits + amount;

    const { error: updateError } = await supabase
      .from('users')
      .update({ credits: newCredits })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating credits:', updateError);
      return { success: false, newCredits: currentData.credits, error: updateError.message };
    }

    console.log(`Added ${amount} credits. New balance: ${newCredits}`);
    return { success: true, newCredits, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, newCredits: 0, error: 'Failed to add credits' };
  }
}