import type { Template } from '../types';
import type { QuickUseInputValues } from '../components/template/TemplateExperienceModal';

export interface QuickUseGuestDraft {
  template: Template;
  values: QuickUseInputValues;
  savedAt: number;
}

const DATABASE_NAME = 'lazora-guest-drafts';
const STORE_NAME = 'quick-use';
const DRAFT_KEY = 'pending';
const DATABASE_VERSION = 1;
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let memoryDraft: QuickUseGuestDraft | null = null;

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB is not available.'));
    return;
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open the Quick Use draft store.'));
});

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Quick Use draft storage failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Quick Use draft storage was aborted.'));
    });
  } finally {
    database.close();
  }
};

export const saveQuickUseGuestDraft = async (
  template: Template,
  values: QuickUseInputValues,
): Promise<void> => {
  const draft: QuickUseGuestDraft = { template, values, savedAt: Date.now() };
  memoryDraft = draft;
  try {
    await runTransaction('readwrite', (store) => store.put(draft, DRAFT_KEY));
  } catch (error) {
    console.warn('Could not persist the Quick Use draft across login.', error);
  }
};

export const loadQuickUseGuestDraft = async (): Promise<QuickUseGuestDraft | null> => {
  let draft = memoryDraft;
  try {
    draft = await runTransaction<QuickUseGuestDraft | undefined>('readonly', (store) => store.get(DRAFT_KEY)) || null;
  } catch (error) {
    console.warn('Could not read the saved Quick Use draft.', error);
  }

  if (!draft) return null;
  if (Date.now() - draft.savedAt <= MAX_DRAFT_AGE_MS) {
    memoryDraft = draft;
    return draft;
  }
  await clearQuickUseGuestDraft();
  return null;
};

export const clearQuickUseGuestDraft = async (): Promise<void> => {
  memoryDraft = null;
  try {
    await runTransaction('readwrite', (store) => store.delete(DRAFT_KEY));
  } catch (error) {
    console.warn('Could not clear the saved Quick Use draft.', error);
  }
};
