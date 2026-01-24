import { LocalStorageData, User, BrowsingState, Generation, Collection } from '../types';

const KEY = 'aura_app_data_v1';

const initialData: LocalStorageData = {
  user: null,
  browsing: { scrollY: 0, category: 'All', searchQuery: '', lastViewedTemplate: null },
  generations: [],
  collections: [
    { id: 'col_1', name: 'Favorites', imageIds: [] }
  ],
};

export const getStorage = (): LocalStorageData => {
  try {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : initialData;
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
