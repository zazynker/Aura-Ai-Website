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
    console.log('=== fetchUserGenerations called ===', { page, limit });
    
    const offset = (page - 1) * limit;
    
    const { data, error, count } = await supabase
      .from('generations')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('=== fetchUserGenerations ERROR ===', error);
      return { data: [], hasMore: false, error: error.message };
    }

    console.log('=== fetchUserGenerations SUCCESS ===', { count, dataLength: data?.length });
    
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
    console.log('=== saveGenerationToDb called ===');
    console.log('Input generation:', generation);
    
    const dbData = {
      user_id: generation.userId,
      template_id: generation.templateId,
      template_name: generation.templateName || null,
      image_url: generation.imageUrl,
      prompt: generation.prompt,
      credits_used: generation.creditsUsed,
    };

    console.log('DB data to insert:', dbData);

    const { data, error } = await supabase
      .from('generations')
      .insert(dbData)
      .select()
      .single();

    if (error) {
      console.error('=== saveGenerationToDb ERROR ===', error);
      return { data: null, error: error.message };
    }

    console.log('=== saveGenerationToDb SUCCESS ===', data);
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
    console.log('=== saveGenerationsToDb called ===');
    console.log('Input generations:', generations);
    
    const dbData = generations.map(gen => ({
      user_id: gen.userId,
      template_id: gen.templateId,
      template_name: gen.templateName || null,
      image_url: gen.imageUrl,
      prompt: gen.prompt,
      credits_used: gen.creditsUsed,
    }));

    console.log('DB data to insert:', dbData);

    const { data, error } = await supabase
      .from('generations')
      .insert(dbData)
      .select();

    if (error) {
      console.error('=== saveGenerationsToDb ERROR ===', error);
      return { data: [], error: error.message };
    }

    console.log('=== saveGenerationsToDb SUCCESS ===', data);
    
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
    console.log('=== deleteGenerationFromDb called ===', generationId);
    
    const { error } = await supabase
      .from('generations')
      .delete()
      .eq('id', generationId);

    if (error) {
      console.error('=== deleteGenerationFromDb ERROR ===', error);
      return { success: false, error: error.message };
    }

    console.log('=== deleteGenerationFromDb SUCCESS ===');
    return { success: true, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to delete generation' };
  }
}