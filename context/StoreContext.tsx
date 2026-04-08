import { 
  fetchUserGenerations, 
  saveGenerationToDb, 
  saveGenerationsToDb, 
  deleteGenerationFromDb,
  fetchUserCollections,
  createCollectionInDb,
  deleteCollectionFromDb,
  addItemToCollectionInDb,
  removeItemFromCollectionInDb
} from '../utils/api';
import { uploadBase64Images } from '../utils/uploadService';
import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { User, LocalStorageData, ToastMessage, Generation, Collection, ModifySession } from '../types';
import { getStorage, updateStorage } from '../utils/storage';
import { supabase } from '../utils/supabase';
import { Session } from '@supabase/supabase-js';

// Credit consumption rules based on output resolution
export const CREDIT_COSTS = {
  '512': 15,   // 512px = 15 credits/image
  '1K': 22,    // 1024px = 22 credits/image
  '2K': 34,    // 2048px = 34 credits/image
  '4K': 50,    // 4096px = 50 credits/image
} as const;

export type Resolution = keyof typeof CREDIT_COSTS;

// Calculate total credits needed for a generation
export const calculateCredits = (resolution: Resolution, imageCount: number): number => {
  return CREDIT_COSTS[resolution] * imageCount;
};

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper: Check if a string is a base64 data URL (these are too large for localStorage)
const isBase64DataUrl = (str: string): boolean => {
  return str?.startsWith('data:image/') && str.includes('base64');
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
    const newUser: User = {
      id: supaUser.id,
      email: supaUser.email || '',
      name: supaUser.user_metadata?.name || supaUser.email?.split('@')[0] || 'User',
      plan: 'Free',
      credits: 120,
      maxCredits: 120,
      avatarUrl: supaUser.user_metadata?.avatar_url ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${supaUser.email}`,
    };

    updateStorage((prev) => {
      // 保留已有的 credits/plan/maxCredits（如果用户之前登录过）
      const existingUser = prev.user;
      const mergedUser = existingUser && existingUser.id === newUser.id
        ? { ...newUser, credits: existingUser.credits, plan: existingUser.plan, maxCredits: existingUser.maxCredits }
        : newUser;

      return { ...prev, user: mergedUser };
    });
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
    setTimeout(() => removeToast(id), 3000);
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
      
      // Deduct credits locally
      updateStorage((prev) => ({
        ...prev,
        user: prev.user ? { ...prev.user, credits: prev.user.credits - gen.creditsUsed } : null
      }));
      setData(getStorage());
      return;
    }

    // Save to database
    const { data: savedGen, error } = await saveGenerationToDb(genWithUser);
    
    if (error) {
      console.error('Failed to save generation:', error);
      addToast('error', 'Failed to save to history');
      return;
    }

    if (savedGen) {
      // Add to local state immediately (at the beginning)
      setDbGenerations(prev => [savedGen, ...prev]);
      
      // Deduct credits locally
      updateStorage((prev) => ({
        ...prev,
        user: prev.user ? { ...prev.user, credits: prev.user.credits - gen.creditsUsed } : null
      }));
      setData(getStorage());
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
      const { data: savedGens, error } = await saveGenerationsToDb(allGensToSave);
      
      if (error) {
        console.error('Failed to save generations:', error);
        addToast('error', 'Failed to save to history');
      } else if (savedGens.length > 0) {
        console.log('Saved to DB successfully:', savedGens.length);
        setDbGenerations(prev => [...savedGens, ...prev]);
      }
    }

    // 扣除积分
    const totalCredits = gens.reduce((acc, g) => acc + g.creditsUsed, 0);
    updateStorage((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, credits: prev.user.credits - totalCredits } : null
    }));
    setData(getStorage());
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