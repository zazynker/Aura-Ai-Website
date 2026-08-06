// utils/fakeVideoQueue.ts
//
// Admin demo-only fake video queue.
// Populated from the hidden entry on the Video page ("Creation Mode" label, admin only).
// While the queue still has an unused item, generateVideo() returns that uploaded video
// instead of calling the real Fal/Kling API — no request, no credit deduction.
//
// Mirrors the image-side queue in pages/Modify.tsx (`lazora_fake_queue`).

export interface FakeVideoItem {
  id: string;
  url: string; // blob: URL created from a local upload
  name: string;
}

const QUEUE_KEY = 'lazora_fake_video_queue';
const INDEX_KEY = 'lazora_fake_video_queue_index';

/** Simulated generation time, matches the image-side fake delay. */
export const FAKE_VIDEO_DELAY_MS = 10000;

export const getFakeVideoQueue = (): FakeVideoItem[] => {
  try {
    const saved = sessionStorage.getItem(QUEUE_KEY);
    return saved ? (JSON.parse(saved) as FakeVideoItem[]) : [];
  } catch {
    return [];
  }
};

export const saveFakeVideoQueue = (items: FakeVideoItem[]) => {
  try {
    if (items.length) sessionStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    else sessionStorage.removeItem(QUEUE_KEY);
  } catch {
    /* sessionStorage unavailable — ignore */
  }
};

export const getFakeVideoIndex = (): number => {
  try {
    const saved = sessionStorage.getItem(INDEX_KEY);
    return saved ? parseInt(saved, 10) || 0 : 0;
  } catch {
    return 0;
  }
};

export const saveFakeVideoIndex = (index: number) => {
  try {
    sessionStorage.setItem(INDEX_KEY, String(index));
  } catch {
    /* ignore */
  }
};

/** Next unused item, without consuming it. */
export const peekNextFakeVideo = (): FakeVideoItem | null => {
  const queue = getFakeVideoQueue();
  const index = getFakeVideoIndex();
  return index < queue.length ? queue[index] : null;
};

/** Next unused item, and advance the pointer. Returns null when the queue is exhausted. */
export const takeNextFakeVideo = (): FakeVideoItem | null => {
  const item = peekNextFakeVideo();
  if (!item) return null;
  saveFakeVideoIndex(getFakeVideoIndex() + 1);
  return item;
};

export const resetFakeVideoQueue = () => saveFakeVideoIndex(0);

export const clearFakeVideoQueue = () => {
  saveFakeVideoQueue([]);
  saveFakeVideoIndex(0);
};
