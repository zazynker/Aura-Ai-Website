import type { JsonObject, WorkflowCapabilityKey } from './workflows/types';

export type Plan = 'Free' | 'Pro';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  credits: number;
  maxCredits: number;
  avatar?: string;     
  avatarUrl?: string;
  isAdmin?: boolean;
  isWhitelisted?: boolean;
  welcomeGiftEligible?: boolean;
  welcomeGiftRedeemed?: boolean;
  welcomeGiftExpiresAt?: string | null;
  welcomeGiftReason?: string;
}

export interface Template {
  id: string;
  slug?: string;
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
  videoUrl?: string;
  isWorkflow?: boolean;
  authorName?: string;
  usesCount?: number;
}

// ============================================
// Creator Workflow Template Types (UI mock only)
// ============================================

export type WorkflowFeature =
  | 'Text to Image'
  | 'Replace Product'
  | 'Modify Image'
  | 'Image to Video'
  | 'Image to Image'
  | 'Motion Control'
  | 'Lip Sync'
  | 'Upscaler';

export type WorkflowMediaType = 'image' | 'video' | 'audio';

export interface WorkflowStep {
  id: string;
  stepNumber: number;
  name: string;
  feature: WorkflowFeature;
  targetRoute: '/modify' | '/video';
  reusableMaterials: boolean;
  prompt: string;
  settings: Record<string, string | number | boolean>;
  result: {
    type: 'image' | 'video';
    url: string;
  };
}

export type CreatorTemplateStatus = 'Draft' | 'In review' | 'Published' | 'Changes requested';

export interface CreatorTemplateSummary {
  id: string;
  name: string;
  coverUrl: string;
  coverType: 'image' | 'video';
  status: CreatorTemplateStatus;
  updatedAt: string;
  stepsCount: number;
  uses?: number;
  creditsEarned?: number;
  feedback?: string;
}

export interface AdminReviewStep {
  id: string;
  name: string;
  resultUrl: string;
  feature: WorkflowFeature;
  materials?: string;
  reusable: boolean;
  prompt: string;
  settings: string;
}

export interface PendingWorkflowTemplate {
  id: string;
  name: string;
  coverUrl: string;
  authorName: string;
  authorAvatar: string;
  submittedAt: string;
  stepsCount: number;
  description: string;
  status: 'In review';
  steps: AdminReviewStep[];
}

export interface ReviewedWorkflowTemplate {
  id: string;
  name: string;
  authorName: string;
  status: 'Published' | 'Changes requested';
  reviewedAt: string;
}

export interface CreatorRewardTemplateSummary {
  templateId: string;
  templateName: string;
  creditsEarned: number;
  userCount: number;
}

export interface CreatorRewardCelebration {
  claimedAt: string;
  notificationCount: number;
  userCount: number;
  templateCount: number;
  creditsEarned: number;
  primaryTemplateId: string | null;
  templates: CreatorRewardTemplateSummary[];
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
  mediaType?: 'image' | 'video';
  thumbnailUrl?: string;
  videoUrl?: string;
  videoDuration?: number;
  videoAspectRatio?: string;
  videoMode?: 'image_to_video' | 'motion_control' | 'lip_sync';
  capability?: WorkflowCapabilityKey;
  inputAssets?: GenerationInputAssetSnapshot[];
  generationParameters?: JsonObject;
  requestId?: string;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
}

export interface GenerationInputAssetSnapshot {
  key: string;
  assetType: 'image' | 'video' | 'audio';
  url: string;
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
  total_credits_used: number;  // 用户消耗的总积分
  generation_count: number;    // 用户生成的总次数
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
  thumb_url: string | null;
  image_url: string | null;
  usage_count: number;
  total_credits: number;
}

export interface UnusedTemplate {
  template_id: string;
  template_name: string | null;
  display_name: string | null;
  thumb_url: string | null;
  image_url: string | null;
  category: string;
  created_at: string;
  usage_count: number;
  total_credits: number;
}

// ============================================
// Video Types
// ============================================

export type VideoMode = 'image_to_video' | 'motion_control' | 'lip_sync';

export type VideoResolution = '720p' | '1080p';

export interface VideoGenerateRequest {
  mode: VideoMode;
  prompt: string;
  startImageUrl?: string;
  endImageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  duration?: number;
  resolution?: VideoResolution;
  characterOrientation?: 'video' | 'image';
  generationCount?: number;
}
