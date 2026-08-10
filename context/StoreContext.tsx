import { 
  fetchUserGenerations, 
  saveGenerationToDb, 
  saveGenerationsToDb, 
  deleteGenerationFromDb,
  fetchUserCollections,
  createCollectionInDb,
  deleteCollectionFromDb,
  addItemToCollectionInDb,
  removeItemFromCollectionInDb,
  fetchUserCredits
} from '../utils/api';
import { uploadBase64Images } from '../utils/uploadService';
import { ensureGenerationThumbnail } from '../utils/generationThumbnail';
import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { User, LocalStorageData, ToastMessage, Generation, Collection, ModifySession } from '../types';
import { getStorage, updateStorage } from '../utils/storage';
import { supabase } from '../utils/supabase';
import { completeTemplateGeneration, failTemplateGeneration } from '../utils/templateRunGeneration';
import { fetchMyProfile } from '../utils/profileApi';
import { Session } from '@supabase/supabase-js';

export const USD_TO_CREDITS = 195;
export const EVOLINK_MJ_STANDARD_USD = 0.08;
export const EVOLINK_MJ_HD_USD = 0.12;
const IMAGE_OUTPUT_USD_PER_MILLION = 60;
const ESTIMATED_OVERHEAD_USD_PER_IMAGE = 0.005;

// Estimated token consumption per image (for pre-generation credit check)
// These are approximate values based on Gemini documentation
export const ESTIMATED_TOKENS_PER_IMAGE = {
  '512': 747,    // 512px
  '1K': 1120,    // 1024px  
  '2K': 1680,    // 2048px
  '4K': 2520,    // 4096px
} as const;

export type Resolution = keyof typeof ESTIMATED_TOKENS_PER_IMAGE;

// Estimate credits needed BEFORE generation (for UI display and pre-check)
// This uses fixed estimates since we don't know actual consumption yet
export const estimateCredits = (resolution: Resolution, imageCount: number): number => {
  const tokensPerImage = ESTIMATED_TOKENS_PER_IMAGE[resolution];
  const imageOutputCost = tokensPerImage * imageCount / 1_000_000 * IMAGE_OUTPUT_USD_PER_MILLION;
  return Math.ceil((imageOutputCost + ESTIMATED_OVERHEAD_USD_PER_IMAGE * imageCount) * USD_TO_CREDITS);
};

export type FalImageQuality = 'low' | 'medium' | 'high';
export type FalImageMode = 'text' | 'edit';

export type FalImageCreditEstimate = {
  mode: FalImageMode;
  resolution: Resolution;
  aspectRatio?: string;
  imageCount: number;
  quality?: FalImageQuality;
  inputImageCount?: number;
};

type FalCanonicalPrice = {
  width: number;
  height: number;
  low: number;
  medium: number;
  high: number;
};

// Published GPT Image 2 canonical prices on fal.ai. The edit prices include
// one input image. When Quick Replace sends a second image, the estimate adds
// the published edit-vs-text price difference for one more input image.
const FAL_GPT_IMAGE_2_PRICES: Record<FalImageMode, FalCanonicalPrice[]> = {
  text: [
    { width: 1024, height: 768, low: 0.005, medium: 0.037, high: 0.145 },
    { width: 1024, height: 1024, low: 0.006, medium: 0.053, high: 0.211 },
    { width: 1024, height: 1536, low: 0.005, medium: 0.042, high: 0.165 },
    { width: 1920, height: 1080, low: 0.005, medium: 0.040, high: 0.158 },
    { width: 2560, height: 1440, low: 0.007, medium: 0.056, high: 0.222 },
    { width: 3840, height: 2160, low: 0.012, medium: 0.101, high: 0.401 },
  ],
  edit: [
    { width: 1024, height: 768, low: 0.011, medium: 0.043, high: 0.151 },
    { width: 1024, height: 1024, low: 0.015, medium: 0.061, high: 0.219 },
    { width: 1024, height: 1536, low: 0.018, medium: 0.054, high: 0.178 },
    { width: 1920, height: 1080, low: 0.017, medium: 0.053, high: 0.158 },
    { width: 2560, height: 1440, low: 0.019, medium: 0.068, high: 0.234 },
    { width: 3840, height: 2160, low: 0.024, medium: 0.113, high: 0.413 },
  ],
};

const roundToMultipleOf16 = (value: number): number =>
  Math.max(16, Math.round(value / 16) * 16);

const falRequestedDimensions = (
  resolution: Resolution,
  aspectRatio = '1:1',
): { width: number; height: number } => {
  const longEdgeByResolution: Record<Resolution, number> = {
    '512': 512,
    '1K': 1024,
    '2K': 2048,
    '4K': 3840,
  };
  const ratioMatch = aspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  const ratio = ratioMatch
    ? Math.max(1 / 3, Math.min(3, Number(ratioMatch[1]) / Number(ratioMatch[2])))
    : 1;
  const longEdge = longEdgeByResolution[resolution];
  let width = ratio >= 1 ? longEdge : longEdge * ratio;
  let height = ratio >= 1 ? longEdge / ratio : longEdge;

  const maxPixels = 8_294_400;
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width *= scale;
    height *= scale;
  }

  return {
    width: roundToMultipleOf16(width),
    height: roundToMultipleOf16(height),
  };
};

const closestFalCanonicalPrice = (
  mode: FalImageMode,
  width: number,
  height: number,
): FalCanonicalPrice => {
  const area = Math.max(1, width * height);
  const ratio = Math.max(0.01, width / Math.max(1, height));
  return FAL_GPT_IMAGE_2_PRICES[mode].reduce((best, candidate) => {
    const candidateArea = candidate.width * candidate.height;
    const candidateRatio = candidate.width / candidate.height;
    const candidateScore =
      Math.abs(Math.log(area / candidateArea)) +
      0.35 * Math.abs(Math.log(ratio / candidateRatio));
    const bestArea = best.width * best.height;
    const bestRatio = best.width / best.height;
    const bestScore =
      Math.abs(Math.log(area / bestArea)) +
      0.35 * Math.abs(Math.log(ratio / bestRatio));
    return candidateScore < bestScore ? candidate : best;
  });
};

export const estimateFalImageCredits = ({
  mode,
  resolution,
  aspectRatio = '1:1',
  imageCount,
  quality = 'medium',
  inputImageCount = mode === 'edit' ? 1 : 0,
}: FalImageCreditEstimate): number => {
  const count = Math.max(1, Math.floor(imageCount));
  const dimensions = falRequestedDimensions(resolution, aspectRatio === 'auto' ? '1:1' : aspectRatio);
  const canonical = closestFalCanonicalPrice(mode, dimensions.width, dimensions.height);
  const textCanonical = closestFalCanonicalPrice('text', dimensions.width, dimensions.height);
  const extraInputImageCostUsd = mode === 'edit'
    ? Math.max(0.006, canonical[quality] - textCanonical[quality])
    : 0;
  const estimatedCostUsd = (
    canonical[quality] +
    Math.max(0, Math.floor(inputImageCount) - 1) * extraInputImageCostUsd
  ) * count;
  return Math.max(1, Math.ceil(estimatedCostUsd * USD_TO_CREDITS));
};

export type MjImageQuality = 'standard' | 'hd';

export const estimateMjImageCredits = (quality: MjImageQuality): number =>
  Math.max(
    1,
    Math.ceil(
      (quality === 'hd' ? EVOLINK_MJ_HD_USD : EVOLINK_MJ_STANDARD_USD) *
        USD_TO_CREDITS,
    ),
  );

// Calculate actual credits based on REAL token consumption from API
// This is the authoritative calculation used after generation completes
// Divisor of 60 yields ~65% profit margin
export const calculateCreditsFromTokens = (tokensUsed: number): number => {
  if (tokensUsed <= 0) return 0;
  return Math.ceil(tokensUsed / 1_000_000 * IMAGE_OUTPUT_USD_PER_MILLION * USD_TO_CREDITS);
};

export type VideoCreditEstimate = {
  mode: 'image_to_video' | 'motion_control' | 'lip_sync';
  duration: number;
  resolution?: '720p' | '1080p';
  generationCount?: number;
  lipSyncInput?: 'image' | 'video';
  generateAudio?: boolean;
};

export const estimateVideoCredits = ({ mode, duration, resolution = '720p', generationCount = 1, lipSyncInput = 'video', generateAudio = true }: VideoCreditEstimate): number => {
  const count = Math.max(1, Math.floor(generationCount));
  const seconds = Math.max(0, duration);
  let costUsd = 0;
  if (mode === 'image_to_video') {
    const pricePerSecond = resolution === '1080p'
      ? (generateAudio ? 0.168 : 0.112)
      : (generateAudio ? 0.126 : 0.084);
    costUsd = seconds * pricePerSecond;
  }
  else if (mode === 'motion_control') costUsd = seconds * (resolution === '1080p' ? 0.168 : 0.126);
  else if (lipSyncInput === 'image') costUsd = seconds * 0.0562;
  else costUsd = Math.ceil(seconds / 5) * 5 * 0.014;
  return Math.ceil(costUsd * count * USD_TO_CREDITS);
};

// Legacy export for backwards compatibility (uses estimation)
export const CREDIT_COSTS = {
  '512': estimateCredits('512', 1),
  '1K': estimateCredits('1K', 1),
  '2K': estimateCredits('2K', 1),
  '4K': estimateCredits('4K', 1),
} as const;

// Legacy function for backwards compatibility
export const calculateCredits = (resolution: Resolution, imageCount: number): number => {
  return estimateCredits(resolution, imageCount);
};

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper: Check if a string is a base64 data URL (these are too large for localStorage)
const isBase64DataUrl = (str: string): boolean => {
  return str?.startsWith('data:image/') && str.includes('base64');
};

const getTemplateGenerationContext = (gen: Partial<Generation>) => {
  if (!gen.templateRunId || !gen.templateStepId || !gen.templateCapability) return null;
  return {
    templateRunId: gen.templateRunId,
    templateStepId: gen.templateStepId,
    templateCapability: gen.templateCapability,
  };
};

const recordTemplatePersistenceFailure = async (
  gen: Partial<Generation>,
  error: unknown,
) => {
  const templateContext = getTemplateGenerationContext(gen);
  if (!templateContext) return;
  try {
    await failTemplateGeneration(templateContext, error);
  } catch (lifecycleError) {
    console.error('Unable to record workflow persistence failure:', lifecycleError);
  }
};

interface StoreContextType {
  user: User | null;
  toasts: ToastMessage[];
  browsing: LocalStorageData['browsing'];
  generations: Generation[];
  collections: Collection[];
  theme: 'light' | 'dark';
  authLoading: boolean;
  // Generations loading state
  loadingGenerations: boolean;
  hasMoreGenerations: boolean;
  // Collections loading state
  loadingCollections: boolean;
  toggleTheme: () => void;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  removeToast: (id: string) => void;
  saveBrowsingState: (updates: Partial<LocalStorageData['browsing']>) => void;
  saveModifySession: (session: ModifySession | null) => void;
  addGeneration: (gen: Omit<Generation, 'id' | 'createdAt'>) => Promise<void>;
  addGenerations: (gens: Omit<Generation, 'id' | 'createdAt'>[]) => Promise<void>;
  deleteGeneration: (id: string) => Promise<void>;
  loadMoreGenerations: () => Promise<void>;
  refreshGenerations: () => Promise<void>;
  // Collection Methods (数据库持久化)
  createCollection: (name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  addToCollection: (collectionId: string, itemId: string) => Promise<void>;
  removeFromCollection: (collectionId: string, itemId: string) => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [data, setData] = useState<LocalStorageData>(getStorage());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  
  // Database generations state
  const [dbGenerations, setDbGenerations] = useState<Generation[]>([]);
  const [generationsPage, setGenerationsPage] = useState(1);
  const [hasMoreGenerations, setHasMoreGenerations] = useState(true);
  const [loadingGenerations, setLoadingGenerations] = useState(false);
  
  // Session-only generations (base64 images not saved to DB)
  const [sessionGenerations, setSessionGenerations] = useState<Generation[]>([]);
  
  // Collections state (database-backed)
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);

  // --- Load Generations from Database ---
  
  const loadGenerations = useCallback(async (page: number = 1, reset: boolean = false) => {
    if (loadingGenerations) return;
    setLoadingGenerations(true);
    
    try {
      const { data: generations, hasMore, error } = await fetchUserGenerations(page, 20);
      
      if (error) {
        console.error('Failed to load generations:', error);
      } else {
        setDbGenerations(prev => reset ? generations : [...prev, ...generations]);
        setHasMoreGenerations(hasMore);
        setGenerationsPage(page);
      }
    } catch (err) {
      console.error('Error loading generations:', err);
    }
    
    setLoadingGenerations(false);
  }, [loadingGenerations]);

  const loadMoreGenerations = useCallback(async () => {
    if (!hasMoreGenerations || loadingGenerations) return;
    await loadGenerations(generationsPage + 1, false);
  }, [hasMoreGenerations, loadingGenerations, generationsPage, loadGenerations]);

  const refreshGenerations = useCallback(async () => {
    setGenerationsPage(1);
    setHasMoreGenerations(true);
    await loadGenerations(1, true);
  }, [loadGenerations]);

  // --- Load Collections from Database ---
  
  const loadCollections = useCallback(async () => {
    if (loadingCollections) return;
    setLoadingCollections(true);
    
    try {
      const { data: cols, error } = await fetchUserCollections();
      
      if (error) {
        console.error('Failed to load collections:', error);
      } else {
        // 如果没有 Favorites 收藏夹，创建一个默认的
        const hasFavorites = cols.some(c => c.name === 'Favorites');
        if (!hasFavorites && cols.length === 0) {
          // 创建默认的 Favorites 收藏夹
          const { data: newCol } = await createCollectionInDb('Favorites');
          if (newCol) {
            setCollections([newCol, ...cols]);
          } else {
            setCollections(cols);
          }
        } else {
          setCollections(cols);
        }
      }
    } catch (err) {
      console.error('Error loading collections:', err);
    }
    
    setLoadingCollections(false);
  }, [loadingCollections]);

  // --- Supabase Auth ---

  const syncUserFromSession = async (session: Session) => {
    const supaUser = session.user;
    
    // 先从数据库获取用户积分信息
    const [{ data: creditsData }, publicProfile] = await Promise.all([
      fetchUserCredits(),
      fetchMyProfile(),
    ]);
    
    // 验证 plan 是否为有效值
    const validPlans = ['Free', 'Pro'] as const;
    const dbPlan = creditsData?.plan;
    const plan = (dbPlan && validPlans.includes(dbPlan as any)) 
      ? (dbPlan as 'Free' | 'Pro') 
      : 'Free';
    
    const newUser: User = {
      id: supaUser.id,
      email: supaUser.email || '',
      name: publicProfile?.username || supaUser.user_metadata?.name || supaUser.email?.split('@')[0] || 'User',
      plan: plan,
      credits: creditsData?.credits ?? 120,
      maxCredits: creditsData?.maxCredits ?? 120,
      avatar: publicProfile?.avatarUrl || supaUser.user_metadata?.avatar_url ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${supaUser.email}`,
      avatarUrl: publicProfile?.avatarUrl || supaUser.user_metadata?.avatar_url || undefined,
      isAdmin: creditsData?.isAdmin ?? false,
      isWhitelisted: creditsData?.isWhitelisted ?? false,
      welcomeGiftEligible: creditsData?.welcomeGiftEligible ?? false,
      welcomeGiftRedeemed: creditsData?.welcomeGiftRedeemed ?? false,
      welcomeGiftExpiresAt: creditsData?.welcomeGiftExpiresAt ?? null,
      welcomeGiftReason: creditsData?.welcomeGiftReason ?? 'not_eligible',
    };

    console.log('=== User synced from database ===');
    console.log('Credits from DB:', creditsData?.credits);
    console.log('Plan from DB:', creditsData?.plan);
    console.log('Is Admin:', creditsData?.isAdmin);
    console.log('Is Whitelisted:', creditsData?.isWhitelisted);

    updateStorage((prev) => ({
      ...prev,
      user: newUser
    }));
    setData(getStorage());
    
    // Load user's data from database
    await Promise.all([
      loadGenerations(1, true),
      loadCollections()
    ]);
  };

  useEffect(() => {
    // 1. 获取初始 session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        syncUserFromSession(session);
      }
      setAuthLoading(false);
    });

    // 2. 监听 auth 状态变化
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          syncUserFromSession(session);
        } else {
          // 用户登出了
          updateStorage((prev) => ({
            ...prev,
            user: null,
            browsing: { ...prev.browsing, modifySession: null }
          }));
          setData(getStorage());
          setSessionGenerations([]);
          setDbGenerations([]);
          setCollections([]);
          setGenerationsPage(1);
          setHasMoreGenerations(true);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // --- Theme ---

  useEffect(() => {
    const handleStorage = () => setData(getStorage());
    window.addEventListener('storage-update', handleStorage);
    applyTheme(data.theme);
    return () => window.removeEventListener('storage-update', handleStorage);
  }, []);

  const applyTheme = (theme: 'light' | 'dark') => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  };

  const toggleTheme = () => {
    const newTheme = data.theme === 'dark' ? 'light' : 'dark';
    updateStorage((prev) => ({ ...prev, theme: newTheme }));
    setData(getStorage());
    applyTheme(newTheme);
  };

  // --- Toasts ---

  const addToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => removeToast(id), type === 'error' ? 10_000 : 3_000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // --- Auth Actions ---

  const logout = async () => {
    await supabase.auth.signOut();
    updateStorage((prev) => ({
      ...prev,
      user: null,
      browsing: { ...prev.browsing, modifySession: null }
    }));
    setData(getStorage());
    setSessionGenerations([]);
    setDbGenerations([]);
    setCollections([]);
    addToast('info', 'Logged out successfully');
  };

  const updateUser = (updates: Partial<User>) => {
    updateStorage((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, ...updates } : null,
    }));
    setData(getStorage());
  };

  // --- Browsing State ---

  const saveBrowsingState = (updates: Partial<LocalStorageData['browsing']>) => {
    updateStorage((prev) => ({
      ...prev,
      browsing: { ...prev.browsing, ...updates },
    }));
    setData(getStorage());
  };

  const saveModifySession = (session: ModifySession | null) => {
    // Clean session before saving - remove base64 images
    let cleanSession = session;
    if (session) {
      cleanSession = {
        ...session,
        currentImage: isBase64DataUrl(session.currentImage || '') ? '' : session.currentImage,
        originalUploadedImage: isBase64DataUrl(session.originalUploadedImage || '') ? '' : session.originalUploadedImage,
        generatedResults: session.generatedResults?.filter(img => !isBase64DataUrl(img)) || [],
      };
    }
    
    updateStorage((prev) => ({
      ...prev,
      browsing: { ...prev.browsing, modifySession: cleanSession },
    }));
    setData(getStorage());
  };

  // --- Generations (Database-backed) ---

  const addGeneration = async (gen: Omit<Generation, 'id' | 'createdAt'>) => {
    if (!data.user) return;
    const genWithUser = { ...gen, userId: data.user.id };

    // If it's a base64 image, only keep in session state (can't save to DB)
    if (isBase64DataUrl(gen.imageUrl)) {
      const sessionGen: Generation = {
        ...genWithUser,
        id: `session_${generateId()}`,
        createdAt: Date.now(),
      };
      setSessionGenerations(prev => [sessionGen, ...prev]);
      await recordTemplatePersistenceFailure(
        genWithUser,
        'Template result could not be persisted as a database generation.',
      );
      
      // 后端已扣分，刷新本地积分
      const { data: creditsData } = await fetchUserCredits();
      if (creditsData) {
        updateStorage((prev) => ({
          ...prev,
          user: prev.user ? { ...prev.user, credits: creditsData.credits } : null
        }));
        setData(getStorage());
      }
      return;
    }

    // Save to database
    const { data: savedGen, error } = await saveGenerationToDb(genWithUser, data.user?.plan || 'Free');
    
    if (error) {
      console.error('Failed to save generation:', error);
      await recordTemplatePersistenceFailure(genWithUser, error);
      addToast('error', 'Failed to save to history');
      return;
    }

    if (savedGen) {
      // Add to local state immediately (at the beginning)
      setDbGenerations(prev => [savedGen, ...prev]);
      void ensureGenerationThumbnail(savedGen).then((thumbnailUrl) => {
        if (!thumbnailUrl) return;
        setDbGenerations((prev) => prev.map((item) => (
          item.id === savedGen.id ? { ...item, thumbnailUrl } : item
        )));
      });

      const templateContext = getTemplateGenerationContext(genWithUser);
      if (templateContext) {
        try {
          await completeTemplateGeneration(templateContext, savedGen.id);
        } catch (lifecycleError) {
          console.error('Generation saved, but workflow step completion failed:', lifecycleError);
          addToast('error', 'Result saved, but workflow progress could not be updated. Please reopen the workflow.');
        }
      }
      
      // 后端已扣分，刷新本地积分
      const { data: creditsData } = await fetchUserCredits();
      if (creditsData) {
        updateStorage((prev) => ({
          ...prev,
          user: prev.user ? { ...prev.user, credits: creditsData.credits } : null
        }));
        setData(getStorage());
      }
    }
  };

  const addGenerations = async (gens: Omit<Generation, 'id' | 'createdAt'>[]) => {
    console.log('=== addGenerations called ===');
    console.log('Input gens:', gens);
    
    if (!data.user) {
      console.log('No user, returning');
      return;
    }
    
    const userId = data.user.id;
    
    // 分离 base64 图片和普通 URL
    const base64Gens = gens.filter(g => isBase64DataUrl(g.imageUrl));
    const regularGens = gens.filter(g => !isBase64DataUrl(g.imageUrl));
    
    console.log('Base64 images to upload:', base64Gens.length);
    console.log('Regular URLs:', regularGens.length);
    
    // 上传 base64 图片到 Storage
    let uploadedGens: Omit<Generation, 'id' | 'createdAt'>[] = [];
    if (base64Gens.length > 0) {
      const base64Images = base64Gens.map(g => g.imageUrl);
      const { urls, errors } = await uploadBase64Images(base64Images, userId);
      
      if (errors.length > 0) {
        console.error('Some uploads failed:', errors);
        addToast('error', `Failed to upload ${errors.length} image(s)`);
      }
      
      // 将上传成功的图片与原始数据匹配
      uploadedGens = base64Gens
        .map((gen, index) => {
          const url = urls[index];
          if (url) {
            return { ...gen, imageUrl: url, userId };
          }
          return null;
        })
        .filter((g): g is Omit<Generation, 'id' | 'createdAt'> => g !== null);
      
      console.log('Successfully uploaded and matched:', uploadedGens.length);
    }
    
    // 合并上传后的图片和普通 URL 图片
    const allGensToSave = [
      ...uploadedGens,
      ...regularGens.map(g => ({ ...g, userId }))
    ];
    
    console.log('Total gens to save to DB:', allGensToSave.length);
    
    // 保存到数据库
    if (allGensToSave.length > 0) {
      console.log('Calling saveGenerationsToDb...');
      const { data: savedGens, error, deletedOldCount } = await saveGenerationsToDb(allGensToSave, data.user?.plan || 'Free');
      if (deletedOldCount && deletedOldCount > 0) {
        console.log(`[GenerationLimit] Auto-deleted ${deletedOldCount} old records`);
      }
      if (error) {
        console.error('Failed to save generations:', error);
        const templateSource = allGensToSave.find((item) => getTemplateGenerationContext(item));
        if (templateSource) await recordTemplatePersistenceFailure(templateSource, error);
        addToast('error', 'Failed to save to history');
      } else if (savedGens.length > 0) {
        console.log('Saved to DB successfully:', savedGens.length);
        setDbGenerations(prev => [...savedGens, ...prev]);
        savedGens.forEach((saved) => {
          void ensureGenerationThumbnail(saved).then((thumbnailUrl) => {
            if (!thumbnailUrl) return;
            setDbGenerations((prev) => prev.map((item) => (
              item.id === saved.id ? { ...item, thumbnailUrl } : item
            )));
          });
        });


        const templateSource = allGensToSave.find((item) => getTemplateGenerationContext(item));
        const templateContext = templateSource
          ? getTemplateGenerationContext(templateSource)
          : null;
        if (templateContext) {
          try {
            await completeTemplateGeneration(templateContext, savedGens[0].id);
          } catch (lifecycleError) {
            console.error('Generations saved, but workflow step completion failed:', lifecycleError);
            addToast('error', 'Results saved, but workflow progress could not be updated. Please reopen the workflow.');
          }
        }
      }
    } else {
      const templateSource = gens.find((item) => getTemplateGenerationContext(item));
      if (templateSource) {
        await recordTemplatePersistenceFailure(
          templateSource,
          'Generated files could not be uploaded for history persistence.',
        );
      }
    }

    // 后端已经扣分了，这里只刷新本地积分状态
    const totalCredits = gens.reduce((acc, g) => acc + g.creditsUsed, 0);
    console.log(`Backend deducted ${totalCredits} credits. Syncing local state...`);
    
    // 从数据库获取最新积分
    const { data: creditsData } = await fetchUserCredits();
    if (creditsData) {
      updateStorage((prev) => ({
        ...prev,
        user: prev.user ? { 
          ...prev.user, 
          credits: creditsData.credits
        } : null
      }));
      setData(getStorage());
      console.log('Credits synced:', creditsData.credits);
    }
  };

  const deleteGeneration = async (id: string) => {
    // Check if it's a session-only generation
    if (id.startsWith('session_')) {
      setSessionGenerations(prev => prev.filter(g => g.id !== id));
      addToast('success', 'Image deleted');
      return;
    }

    // Delete from database
    const { success, error } = await deleteGenerationFromDb(id);
    
    if (error) {
      console.error('Failed to delete generation:', error);
      addToast('error', 'Failed to delete');
      return;
    }

    if (success) {
      setDbGenerations(prev => prev.filter(g => g.id !== id));
      addToast('success', 'Image deleted');
    }
  };

  // --- Collections (Database-backed) ---

  const createCollection = async (name: string) => {
    if (!data.user) {
      addToast('info', 'Please login to create collections');
      return;
    }

    const { data: newCol, error } = await createCollectionInDb(name);
    
    if (error) {
      console.error('Failed to create collection:', error);
      addToast('error', 'Failed to create collection');
      return;
    }

    if (newCol) {
      setCollections(prev => [...prev, newCol]);
      addToast('success', `Collection "${name}" created`);
    }
  };

  const deleteCollection = async (id: string) => {
    // 找到收藏夹
    const collection = collections.find(c => c.id === id);
    if (!collection) return;
    
    // 不允许删除 Favorites
    if (collection.name === 'Favorites') {
      addToast('info', 'Cannot delete the Favorites collection');
      return;
    }

    // Optimistic update
    setCollections(prev => prev.filter(c => c.id !== id));

    const { success, error } = await deleteCollectionFromDb(id);
    
    if (error || !success) {
      console.error('Failed to delete collection:', error);
      // Revert on error
      setCollections(prev => [...prev, collection]);
      addToast('error', 'Failed to delete collection');
      return;
    }

    addToast('info', 'Collection deleted');
  };

  const addToCollection = async (collectionId: string, itemId: string) => {
    if (!data.user) {
      addToast('info', 'Please login to save items');
      return;
    }

    // 检查是否已存在
    const collection = collections.find(c => c.id === collectionId);
    if (collection && collection.imageIds.includes(itemId)) {
      addToast('info', 'Already in collection');
      return;
    }

    // Optimistic update
    setCollections(prev => prev.map(c => 
      c.id === collectionId 
        ? { ...c, imageIds: [itemId, ...c.imageIds] } 
        : c
    ));

    const { success, error } = await addItemToCollectionInDb(collectionId, itemId);
    
    if (error || !success) {
      console.error('Failed to add to collection:', error);
      // Revert on error
      setCollections(prev => prev.map(c => 
        c.id === collectionId 
          ? { ...c, imageIds: c.imageIds.filter(id => id !== itemId) } 
          : c
      ));
      addToast('error', 'Failed to add to collection');
      return;
    }

    addToast('success', 'Added to collection');
  };

  const removeFromCollection = async (collectionId: string, itemId: string) => {
    // 找到原始状态用于回滚
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return;

    // Optimistic update
    setCollections(prev => prev.map(c => 
      c.id === collectionId 
        ? { ...c, imageIds: c.imageIds.filter(id => id !== itemId) } 
        : c
    ));

    const { success, error } = await removeItemFromCollectionInDb(collectionId, itemId);
    
    if (error || !success) {
      console.error('Failed to remove from collection:', error);
      // Revert on error
      setCollections(prev => prev.map(c => 
        c.id === collectionId 
          ? { ...c, imageIds: [...c.imageIds, itemId] } 
          : c
      ));
      addToast('error', 'Failed to remove from collection');
      return;
    }

    addToast('info', 'Removed from collection');
  };

  // Combine database generations with session-only generations
  const userGenerations = data.user
    ? [...sessionGenerations, ...dbGenerations]
    : [];

  return (
    <StoreContext.Provider
      value={{
        user: data.user,
        toasts,
        browsing: data.browsing,
        generations: userGenerations,
        collections,
        theme: data.theme,
        authLoading,
        loadingGenerations,
        hasMoreGenerations,
        loadingCollections,
        toggleTheme,
        logout,
        updateUser,
        addToast,
        removeToast,
        saveBrowsingState,
        saveModifySession,
        addGeneration,
        addGenerations,
        deleteGeneration,
        loadMoreGenerations,
        refreshGenerations,
        createCollection,
        deleteCollection,
        addToCollection,
        removeFromCollection,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
};
