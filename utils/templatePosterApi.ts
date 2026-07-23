import { supabase } from './supabase';

type TemplatePosterResponse = {
  success?: boolean;
  thumbnailUrl?: string;
  error?: string;
};

const inFlight = new Map<string, Promise<string | null>>();

async function requestTemplateResultPoster(
  templateId: string,
  versionId: string,
): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  const response = await fetch('/api/template-result-thumbnail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ templateId, versionId }),
  });
  const payload = await response.json().catch(() => ({})) as TemplatePosterResponse;
  if (!response.ok || !payload.thumbnailUrl) {
    console.warn('[Template poster] Could not create poster.', payload.error || response.statusText);
    return null;
  }
  return payload.thumbnailUrl;
}

export function ensureTemplateResultPoster(
  templateId: string,
  versionId: string,
): Promise<string | null> {
  const key = `${templateId}:${versionId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = requestTemplateResultPoster(templateId, versionId)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}
