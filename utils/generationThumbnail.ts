import type { Generation } from '../types';
import { supabase } from './supabase';

const REQUEST_TIMEOUT_MS = 55_000;
const inFlight = new Map<string, Promise<string | null>>();

type ThumbnailApiResponse = {
  success?: boolean;
  thumbnailUrl?: string | null;
  error?: string;
};

async function requestServerThumbnail(generation: Generation): Promise<string | null> {
  if (!generation.id || generation.id.startsWith('session_') || generation.thumbnailUrl) {
    return generation.thumbnailUrl || null;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('/api/generation-thumbnail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ generationId: generation.id }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as ThumbnailApiResponse;
    if (!response.ok || !payload.thumbnailUrl) {
      console.warn('[Thumbnail] Server thumbnail failed.', payload.error || response.statusText);
      return null;
    }
    return payload.thumbnailUrl;
  } catch (error) {
    console.warn('[Thumbnail] Server thumbnail request failed.', error);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export function ensureGenerationThumbnail(generation: Generation): Promise<string | null> {
  if (generation.thumbnailUrl) return Promise.resolve(generation.thumbnailUrl);
  const existing = inFlight.get(generation.id);
  if (existing) return existing;
  const task = requestServerThumbnail(generation).finally(() => inFlight.delete(generation.id));
  inFlight.set(generation.id, task);
  return task;
}
