
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
  userId: string;
  templateId: string;
  templateName?: string;
  imageUrl: string;
  createdAt: number;
  creditsUsed: number;
  prompt: string;
  isOriginal?: boolean;
  isSessionOnly?: boolean;
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
