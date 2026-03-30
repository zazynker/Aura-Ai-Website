import { 
  fetchUserGenerations, 
  saveGenerationToDb, 
  saveGenerationsToDb, 
  deleteGenerationFromDb 
} from '../utils/api';
import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { User, LocalStorageData, ToastMessage, Generation, Collection, ModifySession } from '../types';
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
  collections: Collection[];
  theme: 'light' | 'dark';
  authLoading: boolean;
  // Generations loading state
  loadingGenerations: boolean;
  hasMoreGenerations: boolean;
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
  // Collection Methods
  createCollection: (name: string) => void;
  deleteCollection: (id: string) => void;
  addToCollection: (collectionId: string, itemId: string) => void;
  removeFromCollection: (collectionId: string, itemId: string) => void;
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

      // 确保有 Favorites 集合
      const hasFavorites = prev.collections.some(
        c => c.userId === mergedUser.id && c.name === 'Favorites'
      );
      let newCollections = prev.collections;
      if (!hasFavorites) {
        newCollections = [...prev.collections, {
          id: `col_${generateId()}`,
          userId: mergedUser.id,
          name: 'Favorites',
          imageIds: []
        }];
      }

      return { ...prev, user: mergedUser, collections: newCollections };
    });
    setData(getStorage());
    
    // Load user's generations from database
    await loadGenerations(1, true);
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
    console.log('=== addGeneration called ===');
    console.log('Input gen:', gen);
    
    if (!data.user) {
      console.log('No user, returning');
      return;
    }
    const genWithUser = { ...gen, userId: data.user.id };

    // If it's a base64 image, only keep in session state (can't save to DB)
    if (isBase64DataUrl(gen.imageUrl)) {
      console.log('Base64 image detected, saving to session only');
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

    console.log('Regular URL, saving to database...');
    // Save to database
    const { data: savedGen, error } = await saveGenerationToDb(genWithUser);
    
    if (error) {
      console.error('Failed to save generation:', error);
      addToast('error', 'Failed to save to history');
      return;
    }

    if (savedGen) {
      console.log('Saved successfully:', savedGen);
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
    
    const gensWithUser = gens.map(g => ({ ...g, userId: data.user!.id }));
    console.log('Gens with user:', gensWithUser);

    // Separate base64 images (session-only) from regular URLs (save to DB)
    const base64Gens = gensWithUser.filter(g => isBase64DataUrl(g.imageUrl));
    const regularGens = gensWithUser.filter(g => !isBase64DataUrl(g.imageUrl));
    
    console.log('Base64 gens (session only):', base64Gens.length);
    console.log('Regular gens (to save to DB):', regularGens.length);
    if (regularGens.length > 0) {
      console.log('Regular gens URLs:', regularGens.map(g => g.imageUrl.substring(0, 100)));
    }

    // Add base64 images to session state only
    if (base64Gens.length > 0) {
      const sessionGens: Generation[] = base64Gens.map(g => ({
        ...g,
        id: `session_${generateId()}`,
        createdAt: Date.now(),
      }));
      setSessionGenerations(prev => [...sessionGens, ...prev]);
    }

    // Save regular URLs to database
    if (regularGens.length > 0) {
      console.log('Calling saveGenerationsToDb...');
      const { data: savedGens, error } = await saveGenerationsToDb(regularGens);
      
      if (error) {
        console.error('Failed to save generations:', error);
        addToast('error', 'Failed to save to history');
      } else if (savedGens.length > 0) {
        console.log('Saved successfully, adding to state:', savedGens);
        setDbGenerations(prev => [...savedGens, ...prev]);
      }
    } else {
      console.log('No regular gens to save to DB');
    }

    // Calculate total credits used and deduct
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

  // --- Collections ---

  const createCollection = (name: string) => {
    if (!data.user) return;

    const newCol: Collection = {
      id: `col_${generateId()}`,
      userId: data.user.id,
      name,
      imageIds: []
    };
    updateStorage((prev) => ({
      ...prev,
      collections: [...prev.collections, newCol]
    }));
    setData(getStorage());
    addToast('success', `Collection "${name}" created`);
  };

  const deleteCollection = (id: string) => {
    updateStorage((prev) => ({
      ...prev,
      collections: prev.collections.filter(c => c.id !== id)
    }));
    setData(getStorage());
    addToast('info', 'Collection deleted');
  };

  const addToCollection = (collectionId: string, itemId: string) => {
    const current = getStorage();
    const collection = current.collections.find(c => c.id === collectionId);
    if (collection && collection.imageIds.includes(itemId)) {
      addToast('info', 'Already in collection');
      return;
    }

    updateStorage((prev) => ({
      ...prev,
      collections: prev.collections.map(c => c.id === collectionId ? { ...c, imageIds: [itemId, ...c.imageIds] } : c)
    }));
    setData(getStorage());
    addToast('success', 'Added to collection');
  };

  const removeFromCollection = (collectionId: string, itemId: string) => {
    updateStorage((prev) => ({
      ...prev,
      collections: prev.collections.map(c => c.id === collectionId ? { ...c, imageIds: c.imageIds.filter(id => id !== itemId) } : c)
    }));
    setData(getStorage());
    addToast('info', 'Removed from collection');
  };

  // Combine database generations with session-only generations
  const userGenerations = data.user
    ? [...sessionGenerations, ...dbGenerations]
    : [];

  const userCollections = data.user
    ? data.collections.filter(c => c.userId === data.user!.id)
    : [];

  return (
    <StoreContext.Provider
      value={{
        user: data.user,
        toasts,
        browsing: data.browsing,
        generations: userGenerations,
        collections: userCollections,
        theme: data.theme,
        authLoading,
        loadingGenerations,
        hasMoreGenerations,
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