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
  const { search = '', category = 'All', limit = 50, offset = 0 } = options;

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