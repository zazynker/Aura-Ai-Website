
import { LocalStorageData, User, BrowsingState, Generation, Collection } from '../types';

const KEY = 'lazora_app_data_v1';

const initialData: LocalStorageData = {
  user: null,
  browsing: { scrollY: 0, category: 'All', searchQuery: '', lastViewedTemplate: null, intendedDestination: null, modifySession: null },
  generations: [],
  collections: [], // Empty initially, created per user on login
  theme: 'light', // Default to light
};

export const getStorage = (): LocalStorageData => {
  try {
    const data = localStorage.getItem(KEY);
    return data ? { ...initialData, ...JSON.parse(data) } : initialData; // Merge to ensure new fields like theme exist
  } catch (e) {
    return initialData;
  }
};

export const setStorage = (data: LocalStorageData) => {
  localStorage.setItem(KEY, JSON.stringify(data));
};

export const updateStorage = (updater: (prev: LocalStorageData) => LocalStorageData) => {
  const current = getStorage();
  const next = updater(current);
  setStorage(next);
  // Dispatch event for cross-component updates if needed
  window.dispatchEvent(new Event('storage-update'));
};