export type Plan = 'Free' | 'Pro' | 'Enterprise';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  credits: number;
  maxCredits: number;
  avatarUrl?: string;
}

export interface Template {
  id: string;
  name: string;
  imageUrl: string;
  category: string;
  tags: string[];
  isPro: boolean;
  width: number;
  height: number;
}

export interface Generation {
  id: string;
  templateId: string;
  templateName?: string;
  imageUrl: string;
  createdAt: number;
  creditsUsed: number;
  prompt: string;
  isOriginal?: boolean;
}

export interface Collection {
  id: string;
  name: string;
  imageIds: string[];
}

export interface BrowsingState {
  scrollY: number;
  category: string;
  searchQuery: string;
  lastViewedTemplate: string | null;
}

export interface LocalStorageData {
  user: User | null;
  browsing: BrowsingState;
  generations: Generation[];
  collections: Collection[];
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}