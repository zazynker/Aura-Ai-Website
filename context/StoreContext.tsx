
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, LocalStorageData, ToastMessage, Generation, Collection, ModifySession } from '../types';
import { getStorage, updateStorage } from '../utils/storage';

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

interface StoreContextType {
  user: User | null;
  toasts: ToastMessage[];
  browsing: LocalStorageData['browsing'];
  generations: Generation[];
  collections: Collection[];
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  login: (email: string, name: string) => void;
  logout: () => void;
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

  useEffect(() => {
    // Sync state with local storage events if multiple tabs or external updates
    const handleStorage = () => setData(getStorage());
    window.addEventListener('storage-update', handleStorage);
    
    // Apply initial theme
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

  const addToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => removeToast(id), 3000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const login = (email: string, name: string) => {
    // Generate a stable ID based on email to ensure data persists for the same user across sessions
    const stableId = `user_${email.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    const newUser: User = {
      id: stableId,
      email,
      name,
      plan: 'Free',
      credits: 10,
      maxCredits: 10,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
    };

    updateStorage((prev) => {
        // Ensure this user has a "Favorites" collection
        const hasFavorites = prev.collections.some(c => c.userId === stableId && c.name === 'Favorites');
        let newCollections = prev.collections;

        if (!hasFavorites) {
            newCollections = [...prev.collections, {
                id: `col_${generateId()}`,
                userId: stableId,
                name: 'Favorites',
                imageIds: []
            }];
        }

        return { 
            ...prev, 
            user: newUser,
            collections: newCollections
        };
    });
    
    setData(getStorage());
    addToast('success', `Welcome back, ${name}!`);
  };

  const logout = () => {
    updateStorage((prev) => ({ 
        ...prev, 
        user: null,
        browsing: { 
            scrollY: 0, 
            category: 'All', 
            searchQuery: '', 
            lastViewedTemplate: null, 
            intendedDestination: null, 
            modifySession: null 
        }
    }));
    setData(getStorage());
    addToast('info', 'Logged out successfully');
  };

  const updateUser = (updates: Partial<User>) => {
    updateStorage((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, ...updates } : null,
    }));
    setData(getStorage());
  };

  const saveBrowsingState = (updates: Partial<LocalStorageData['browsing']>) => {
    updateStorage((prev) => ({
      ...prev,
      browsing: { ...prev.browsing, ...updates },
    }));
    setData(getStorage());
  };

  const saveModifySession = (session: ModifySession | null) => {
    updateStorage((prev) => ({
      ...prev,
      browsing: { ...prev.browsing, modifySession: session },
    }));
    setData(getStorage());
  };

  const addGeneration = (gen: Generation) => {
    if (!data.user) return;
    const genWithUser = { ...gen, userId: data.user.id };
    
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

    updateStorage((prev) => ({
      ...prev,
      generations: [...gensWithUser, ...prev.generations],
      user: prev.user ? { ...prev.user, credits: prev.user.credits - gens.reduce((acc, g) => acc + g.creditsUsed, 0) } : null
    }));
    setData(getStorage());
  };

  const deleteGeneration = (id: string) => {
    updateStorage((prev) => ({
      ...prev,
      generations: prev.generations.filter(g => g.id !== id)
    }));
    setData(getStorage());
  };

  // --- Collection Logic ---

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
     // Check if already exists
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

  // Filter data to only show what belongs to the current user
  const userGenerations = data.user 
    ? data.generations.filter(g => g.userId === data.user!.id)
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
        toggleTheme,
        login,
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