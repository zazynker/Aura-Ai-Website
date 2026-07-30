export type VideoCardStatus = 'pending' | 'completed' | 'failed';
export type VideoMode = 'image_to_video' | 'motion_control' | 'lip_sync';

export interface VideoResult {
  id: string;
  type: string;
  model: string;
  resolution: string;
  prompt: string;
  duration: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | 'Auto';
  timestamp: string;
  bgColor: string;
  videoUrl?: string;
  sourceImage?: string;
  sourceVideo?: string;
  audioUrl?: string;
  generateAudio?: boolean;
  status?: VideoCardStatus;
  error?: string;
  requestId?: string;
  mode?: VideoMode;
  creditsUsed?: number;
  createdAt?: number;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
}

const VIDEO_RESULTS_CACHE_KEY = 'lazora-video-results-cache-v1';
const MAX_CACHED_VIDEO_RESULTS = 60;

const canUseLocalStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

function readAllCachedResults(): Record<string, VideoResult[]> {
  if (!canUseLocalStorage()) return {};
  const raw = window.localStorage.getItem(VIDEO_RESULTS_CACHE_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, VideoResult[]>;
  } catch {
    window.localStorage.removeItem(VIDEO_RESULTS_CACHE_KEY);
    return {};
  }
}

function writeAllCachedResults(value: Record<string, VideoResult[]>) {
  if (!canUseLocalStorage()) return;
  window.localStorage.setItem(VIDEO_RESULTS_CACHE_KEY, JSON.stringify(value));
}

export function getCachedVideoResults(userId?: string | null): VideoResult[] {
  if (!userId) return [];
  const all = readAllCachedResults();
  const list = Array.isArray(all[userId]) ? all[userId] : [];
  return list
    .filter((item) => item && item.id)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export function saveCachedVideoResults(userId: string | undefined | null, results: VideoResult[]) {
  if (!userId) return;
  const all = readAllCachedResults();
  all[userId] = dedupeVideoResults(results)
    .slice(0, MAX_CACHED_VIDEO_RESULTS)
    .map((item) => ({ ...item, createdAt: item.createdAt || Date.now() }));
  writeAllCachedResults(all);
}

export function upsertCachedVideoResult(userId: string | undefined | null, result: VideoResult) {
  if (!userId) return;
  const existing = getCachedVideoResults(userId);
  const next = upsertVideoResult(existing, { ...result, createdAt: result.createdAt || Date.now() });
  saveCachedVideoResults(userId, next);
}

export function updateCachedVideoResult(
  userId: string | undefined | null,
  id: string,
  updates: Partial<VideoResult>
): VideoResult | null {
  if (!userId) return null;
  const existing = getCachedVideoResults(userId);
  let updated: VideoResult | null = null;
  const next = existing.map((item) => {
    if (item.id !== id) return item;
    updated = { ...item, ...updates, createdAt: item.createdAt || Date.now() };
    return updated;
  });
  if (updated) saveCachedVideoResults(userId, next);
  return updated;
}

export function removeCachedVideoResult(userId: string | undefined | null, id: string) {
  if (!userId) return;
  const next = getCachedVideoResults(userId).filter((item) => item.id !== id);
  saveCachedVideoResults(userId, next);
}

export function upsertVideoResult(results: VideoResult[], result: VideoResult): VideoResult[] {
  const exists = results.some((item) => item.id === result.id);
  const next = exists
    ? results.map((item) => (item.id === result.id ? { ...item, ...result } : item))
    : [result, ...results];
  return dedupeVideoResults(next);
}

function getVideoResultKeys(item: VideoResult): string[] {
  const keys: string[] = [];
  if (item.videoUrl) keys.push(`video:${item.videoUrl}`);
  if (item.requestId) keys.push(`request:${item.requestId}`);
  if (item.id) keys.push(`id:${item.id}`);
  return keys;
}

export function dedupeVideoResults(results: VideoResult[]): VideoResult[] {
  const seen = new Set<string>();
  const output: VideoResult[] = [];

  for (const item of results) {
    const keys = getVideoResultKeys(item);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    output.push(item);
  }

  return output;
}

export const generateFakeVideo = async (imageUrl: string, durationSeconds: number): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 640;
      canvas.height = img.height || 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve('');
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: BlobPart[] = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(URL.createObjectURL(blob));
      };
      
      recorder.start();
      
      const drawInterval = setInterval(() => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }, 1000 / 30);
      
      setTimeout(() => {
        clearInterval(drawInterval);
        recorder.stop();
      }, Math.max(1000, durationSeconds * 1000));
    };
    img.onerror = () => resolve('');
    img.src = imageUrl;
  });
};
