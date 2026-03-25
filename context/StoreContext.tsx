import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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

// Helper: Clean generation for storage (remove base64 images to prevent quota exceeded)
const cleanGenerationForStorage = (gen: Generation): Generation => {
  // If imageUrl is a base64 data URL, don't store it (it's too large)
  // We'll mark it as a session-only image
  if (isBase64DataUrl(gen.imageUrl)) {
    return {
      ...gen,
      imageUrl: '', // Don't store base64 in localStorage
      isSessionOnly: true, // Mark as session-only
    };
  }
  return gen;
};

interface StoreContextType {
  user: User | null;
  toasts: ToastMessage[];
  browsing: LocalStorageData['browsing'];
  generations: Generation[];
  collections: Collection[];
  theme: 'light' | 'dark';
  authLoading: boolean;
  toggleTheme: () => void;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  removeToast: (id: string) => void;
  saveBrowsingState: (updates: Partial<LocalStorageData['browsing']>) => void;
  saveModifySession: (session: ModifySession | null) => void;
  addGeneration: (gen: Generation) => void;
  addGenerations: (gens: Generation[]) => void;
  deleteGeneration: (id: string) => void;
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
  
  // Session-only generations (not persisted to localStorage)
  const [sessionGenerations, setSessionGenerations] = useState<Generation[]>([]);

  // --- Supabase Auth ---

  const syncUserFromSession = (session: Session) => {
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
          setSessionGenerations([]); // Clear session generations on logout
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
    setSessionGenerations([]); // Clear session generations
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

  // --- Generations ---

  const addGeneration = (gen: Generation) => {
    if (!data.user) return;
    const genWithUser = { ...gen, userId: data.user.id };

    // If it's a base64 image, only keep in session state (don't persist)
    if (isBase64DataUrl(gen.imageUrl)) {
      setSessionGenerations(prev => [genWithUser, ...prev]);
      // Still deduct credits
      updateStorage((prev) => ({
        ...prev,
        user: prev.user ? { ...prev.user, credits: prev.user.credits - gen.creditsUsed } : null
      }));
      setData(getStorage());
      return;
    }

    // For regular URLs, persist to localStorage
    updateStorage((prev) => ({
      ...prev,
      generations: [genWithUser, ...prev.generations],
      user: prev.user ? { ...prev.user, credits: prev.user.credits - gen.creditsUsed } : null
    }));
    setData(getStorage());
  };

  const addGenerations = (gens: Generation[]) => {
    if (!data.user) return;
    const gensWithUser = gens.map(g => ({ ...g, userId: data.user!.id }));

    // Separate base64 images (session-only) from regular URLs (persist)
    const base64Gens = gensWithUser.filter(g => isBase64DataUrl(g.imageUrl));
    const regularGens = gensWithUser.filter(g => !isBase64DataUrl(g.imageUrl));

    // Add base64 images to session state only
    if (base64Gens.length > 0) {
      setSessionGenerations(prev => [...base64Gens, ...prev]);
    }

    // Calculate total credits used
    const totalCredits = gens.reduce((acc, g) => acc + g.creditsUsed, 0);

    // Update storage with only regular URLs and deduct credits
    updateStorage((prev) => ({
      ...prev,
      generations: [...regularGens, ...prev.generations],
      user: prev.user ? { ...prev.user, credits: prev.user.credits - totalCredits } : null
    }));
    setData(getStorage());
  };

  const deleteGeneration = (id: string) => {
    // Try to delete from session generations first
    setSessionGenerations(prev => prev.filter(g => g.id !== id));
    
    // Also try to delete from persisted generations
    updateStorage((prev) => ({
      ...prev,
      generations: prev.generations.filter(g => g.id !== id)
    }));
    setData(getStorage());
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

  // Combine persisted generations with session-only generations
  // Filter to only show current user's data
  const userGenerations = data.user
    ? [...sessionGenerations.filter(g => g.userId === data.user!.id), ...data.generations.filter(g => g.userId === data.user!.id)]
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