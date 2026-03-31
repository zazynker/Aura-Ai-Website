import { 
  fetchUserGenerations, 
  saveGenerationToDb, 
  saveGenerationsToDb, 
  deleteGenerationFromDb,
  fetchUserFavorites,
  addFavoriteToDb,
  removeFavoriteFromDb
} from '../utils/api';
import { uploadBase64Images } from '../utils/uploadService';
import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { User, LocalStorageData, ToastMessage, Generation, ModifySession } from '../types';
import { getStorage, updateStorage } from '../utils/storage';
import { supabase } from '../utils/supabase';
import { Session } from '@supabase/supabase-js';

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
  favoriteTemplateIds: string[];
  theme: 'light' | 'dark';
  authLoading: boolean;
  // Generations loading state
  loadingGenerations: boolean;
  hasMoreGenerations: boolean;
  // Favorites loading state
  loadingFavorites: boolean;
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
  // Favorites Methods
  toggleFavorite: (templateId: string) => Promise<void>;
  isFavorite: (templateId: string) => boolean;
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
  
  // Favorites state (database-backed)
  const [favoriteTemplateIds, setFavoriteTemplateIds] = useState<string[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);

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

  // --- Load Favorites from Database ---
  
  const loadFavorites = useCallback(async () => {
    if (loadingFavorites) return;
    setLoadingFavorites(true);
    
    try {
      const { data: favorites, error } = await fetchUserFavorites();
      
      if (error) {
        console.error('Failed to load favorites:', error);
      } else {
        setFavoriteTemplateIds(favorites.map(f => f.templateId));
      }
    } catch (err) {
      console.error('Error loading favorites:', err);
    }
    
    setLoadingFavorites(false);
  }, [loadingFavorites]);

  // --- Supabase Auth ---

  const syncUserFromSession = async (session: Session) => {
    const supaUser = session.user;
    const newUser: User = {
      id: supaUser.id,
      email: supaUser.email || '',
      name: supaUser.user_metadata?.name || supaUser.email?.split('@')[0] || 'User',
      plan: 'Free',
      credits: 10,
      maxCredits: 10,
      avatarUrl: supaUser.user_metadata?.avatar_url ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${supaUser.email}`,
    };

    updateStorage((prev) => {
      // 保留已有的 credits/plan（如果用户之前登录过）
      const existingUser = prev.user;
      const mergedUser = existingUser && existingUser.id === newUser.id
        ? { ...newUser, credits: existingUser.credits, plan: existingUser.plan }
        : newUser;

      return { ...prev, user: mergedUser };
    });
    setData(getStorage());
    
    // Load user's data from database
    await Promise.all([
      loadGenerations(1, true),
      loadFavorites()
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
          setFavoriteTemplateIds([]);
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
    setFavoriteTemplateIds([]);
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

  // --- Favorites (Database-backed) ---
  
  const isFavorite = (templateId: string): boolean => {
    return favoriteTemplateIds.includes(templateId);
  };

  const toggleFavorite = async (templateId: string) => {
    if (!data.user) {
      addToast('info', 'Please login to save favorites');
      return;
    }

    const isCurrentlyFavorite = isFavorite(templateId);
    
    // Optimistic update
    if (isCurrentlyFavorite) {
      setFavoriteTemplateIds(prev => prev.filter(id => id !== templateId));
    } else {
      setFavoriteTemplateIds(prev => [templateId, ...prev]);
    }

    try {
      if (isCurrentlyFavorite) {
        const { error } = await removeFavoriteFromDb(templateId);
        if (error) {
          // Revert on error
          setFavoriteTemplateIds(prev => [templateId, ...prev]);
          addToast('error', 'Failed to remove from favorites');
        }
      } else {
        const { error } = await addFavoriteToDb(templateId);
        if (error) {
          // Revert on error
          setFavoriteTemplateIds(prev => prev.filter(id => id !== templateId));
          addToast('error', 'Failed to add to favorites');
        } else {
          addToast('success', 'Added to favorites');
        }
      }
    } catch (err) {
      console.error('Toggle favorite error:', err);
      // Revert on error
      if (isCurrentlyFavorite) {
        setFavoriteTemplateIds(prev => [templateId, ...prev]);
      } else {
        setFavoriteTemplateIds(prev => prev.filter(id => id !== templateId));
      }
    }
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
        favoriteTemplateIds,
        theme: data.theme,
        authLoading,
        loadingGenerations,
        hasMoreGenerations,
        loadingFavorites,
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
        toggleFavorite,
        isFavorite,
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