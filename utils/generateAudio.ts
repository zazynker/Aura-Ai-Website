import { supabase } from './supabase';

export interface GenerateAudioInput {
  text: string;
  voiceId?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  emotion?: string;
  languageBoost?: string;
  format?: 'mp3' | 'flac';
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
}

export interface GenerateAudioResult {
  audioUrl: string;
  durationMs: number;
  requestId: string;
  creditsUsed: number;
  newCredits: number;
}

export async function generateAudio(input: GenerateAudioInput): Promise<GenerateAudioResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required');

  const response = await fetch('/api/generate-audio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message || 'Audio generation failed');
  }

  if (Number.isFinite(payload.newCredits)) {
    window.dispatchEvent(new CustomEvent('credits-updated', {
      detail: { credits: Number(payload.newCredits) },
    }));
  }

  return {
    audioUrl: String(payload.audioUrl),
    durationMs: Number(payload.durationMs) || 0,
    requestId: String(payload.requestId),
    creditsUsed: Number(payload.creditsUsed) || 0,
    newCredits: Number(payload.newCredits) || 0,
  };
}
