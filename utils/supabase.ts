import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// Create Supabase client
export const supabase = createClient(env.supabase.url, env.supabase.anonKey);

// Database types for templates table
export interface DbTemplate {
  id: string;
  name: string;
  image_url: string;
  category: string;
  tags: string[];
  is_pro: boolean;
  width: number;
  height: number;
  prompt_template: string | null;
  created_at: string;
}

// Convert database row to frontend Template type
export function dbToTemplate(row: DbTemplate): import('../types').Template {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    category: row.category,
    tags: row.tags || [],
    isPro: row.is_pro,
    width: row.width,
    height: row.height,
  };
}