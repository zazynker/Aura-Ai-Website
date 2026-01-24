import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, LocalStorageData, ToastMessage, Generation, Collection } from '../types';
import { getStorage, updateStorage } from '../utils/storage';

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

interface StoreContextType {
  user: User | null;
  toasts: ToastMessage[];
  browsing: LocalStorageData['browsing'];
  generations: Generation[];
  collections: Collection[];
  login: (email: string, name: string) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  removeToast: (id: string) => void;
  saveBrowsingState: (updates: Partial<LocalStorageData['browsing']>) => void;
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
    return () => window.removeEventListener('storage-update', handleStorage);
  }, []);

  const addToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => removeToast(id), 3000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const login = (email: string, name: string) => {
    const newUser: User = {
      id: generateId(),
      email,
      name,
      plan: 'Free',
      credits: 10,
      maxCredits: 10,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
    };
    updateStorage((prev) => ({ ...prev, user: newUser }));
    setData(getStorage());
    addToast('success', `Welcome back, ${name}!`);
  };

  const logout = () => {
    updateStorage((prev) => ({ ...prev, user: null }));
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

  const addGeneration = (gen: Generation) => {
    updateStorage((prev) => ({
      ...prev,
      generations: [gen, ...prev.generations],
      user: prev.user ? { ...prev.user, credits: prev.user.credits - gen.creditsUsed } : null
    }));
    setData(getStorage());
  };

  const addGenerations = (gens: Generation[]) => {
    updateStorage((prev) => ({
      ...prev,
      generations: [...gens, ...prev.generations],
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
    const newCol: Collection = {
      id: `col_${generateId()}`,
      name,
      imageIds: [] // In this context, storing Template IDs
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

  return (
    <StoreContext.Provider
      value={{
        user: data.user,
        toasts,
        browsing: data.browsing,
        generations: data.generations,
        collections: data.collections,
        login,
        logout,
        updateUser,
        addToast,
        removeToast,
        saveBrowsingState,
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