export type Plan = 'Free' | 'Pro';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  credits: number;
  maxCredits: number;
  avatarUrl?: string;
  isAdmin?: boolean;
}

export interface Template {
  id: string;
  name: string;
  imageUrl: string;
  thumbUrl?: string;
  category: string;
  tags: string[];
  isPro: boolean;
  width?: number;
  height?: number;
  scene?: string;
  model?: string;
  mood?: string;
  holiday?: string;
}

export interface Generation {
  id: string;
  userId: string;
  templateId: string;
  templateName?: string;
  imageUrl: string;
  createdAt: number;
  creditsUsed: number;
  prompt: string;
  isOriginal?: boolean;
  isSessionOnly?: boolean;
  groupId?: string; // 同一批生成的图片共享同一个 groupId
}

export interface Collection {
  id: string;
  userId: string;
  name: string;
  imageIds: string[];
}

export interface ModifySession {
  hasSelectedImage: boolean;
  currentImage: string;
  originalUploadedImage: string;
  generatedResults: string[];
  showResults: boolean;
  currentImageSource?: { templateId: string; templateName: string };
}

export interface BrowsingState {
  scrollY: number;
  category: string;
  searchQuery: string;
  lastViewedTemplate: string | null;
  intendedDestination?: string | null;
  modifySession?: ModifySession | null;
}

export interface LocalStorageData {
  user: User | null;
  browsing: BrowsingState;
  generations: Generation[];
  collections: Collection[];
  theme: 'light' | 'dark';
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

// ============================================
// Admin Types
// ============================================

export interface AdminUser {
  id: string;
  email: string;
  credits: number;
  plan: Plan;
  max_credits: number;
  is_admin: boolean;
  created_at: string;
}

export interface AdminStats {
  total_users: number;
  pro_users: number;
  free_users: number;
  total_generations: number;
  generations_today: number;
  generations_this_week: number;
  total_credits_used: number;
}

export interface TemplateStats {
  template_id: string;
  template_name: string | null;
  usage_count: number;
  total_credits: number;
}