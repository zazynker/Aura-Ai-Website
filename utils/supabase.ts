import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// ============================================
// 启动时自动检测并清理无效的 Auth Token
// 解决：更换 API Key 后旧 Token 导致页面卡住的问题
// ============================================
(async () => {
  const authKey = Object.keys(localStorage).find(k => k.includes('lazora-auth'));
  if (!authKey) return; // 没有 Token，不需要检查
  
  try {
    // 用当前 API Key 测试一个简单请求
    const response = await fetch(`${env.supabase.url}/rest/v1/templates?select=id&limit=1`, {
      headers: { 'apikey': env.supabase.anonKey }
    });
    
    // 如果返回 401，说明 Key 有问题或 Token 无效
    if (response.status === 401) {
      console.warn('Auth token invalid, clearing...');
      Object.keys(localStorage).filter(k => 
        k.includes('lazora-auth') || k.includes('sb-')
      ).forEach(k => localStorage.removeItem(k));
      window.location.reload();
    }
  } catch (e) {
    // 网络错误不处理，让正常流程继续
  }
})();

// Create Supabase client
export const supabase = createClient(env.supabase.url, env.supabase.anonKey, {
  auth: {
    storageKey: 'lazora-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
});

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