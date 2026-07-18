import type { Generation } from '../types';
import { supabase } from './supabase';

const BUCKET = 'generations';
const MAX_EDGE = 480;
const WEBP_QUALITY = 0.65;
const LOAD_TIMEOUT_MS = 15_000;
const inFlight = new Map<string, Promise<string | null>>();

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Thumbnail source timed out.')), LOAD_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function canvasForSize(width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('The browser could not create a thumbnail.')),
      'image/webp',
      WEBP_QUALITY,
    );
  });
}

async function thumbnailFromImage(url: string): Promise<Blob> {
  const image = await withTimeout(new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = 'anonymous';
    element.decoding = 'async';
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Image thumbnail source could not be loaded.'));
    element.src = url;
  }));
  const canvas = canvasForSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToWebp(canvas);
}

async function thumbnailFromVideo(url: string): Promise<Blob> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new Error('Video thumbnail source could not be loaded.'));
      };
      video.onerror = fail;
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (duration > 0.05) {
          video.currentTime = Math.min(0.25, Math.max(0.05, duration / 20));
        }
      };
      video.onseeked = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      video.onloadeddata = () => {
        if (video.currentTime > 0 || !Number.isFinite(video.duration) || video.duration <= 0.05) {
          if (settled) return;
          settled = true;
          resolve();
        }
      };
      video.src = url;
      video.load();
    }));
    const canvas = canvasForSize(video.videoWidth || 480, video.videoHeight || 270);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasToWebp(canvas);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

async function createThumbnailBlob(generation: Generation): Promise<Blob | null> {
  const candidates: Array<{ type: 'image' | 'video'; url: string }> = [];
  if (generation.imageUrl && generation.imageUrl !== generation.videoUrl) {
    candidates.push({ type: 'image', url: generation.imageUrl });
  }
  for (const asset of generation.inputAssets || []) {
    if (asset.url && asset.assetType === 'image') {
      candidates.push({ type: 'image', url: asset.url });
    }
  }
  for (const asset of generation.inputAssets || []) {
    if (asset.url && asset.assetType === 'video') {
      candidates.push({ type: 'video', url: asset.url });
    }
  }
  if (generation.mediaType === 'video' && generation.videoUrl) {
    candidates.push({ type: 'video', url: generation.videoUrl });
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    try {
      return candidate.type === 'video'
        ? await thumbnailFromVideo(candidate.url)
        : await thumbnailFromImage(candidate.url);
    } catch (error) {
      console.warn('[Thumbnail] Candidate failed, trying the next source.', error);
    }
  }
  return null;
}

async function createAndPersist(generation: Generation): Promise<string | null> {
  if (!generation.id || generation.id.startsWith('session_') || generation.thumbnailUrl) {
    return generation.thumbnailUrl || null;
  }
  const blob = await createThumbnailBlob(generation);
  if (!blob) return null;

  const path = `${generation.userId}/thumbnails/${generation.id}.webp`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: true,
    });
  if (uploadError) {
    console.warn('[Thumbnail] Upload failed.', uploadError);
    return null;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const thumbnailUrl = `${data.publicUrl}?v=${Date.now()}`;
  const { error: updateError } = await supabase
    .from('generations')
    .update({ thumbnail_url: thumbnailUrl })
    .eq('id', generation.id)
    .eq('user_id', generation.userId);
  if (updateError) {
    console.warn('[Thumbnail] Database update failed. Run the M5-5.2 SQL migration.', updateError);
    return null;
  }
  return thumbnailUrl;
}

export function ensureGenerationThumbnail(generation: Generation): Promise<string | null> {
  if (generation.thumbnailUrl) return Promise.resolve(generation.thumbnailUrl);
  const existing = inFlight.get(generation.id);
  if (existing) return existing;
  const task = createAndPersist(generation).finally(() => inFlight.delete(generation.id));
  inFlight.set(generation.id, task);
  return task;
}
