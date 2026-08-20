import { supabase } from './supabase';

export interface WorkflowFinalVideoClip {
  stepId: string;
  order: number;
  executionMode: 'generated' | 'reused_template_result';
}

export interface WorkflowFinalVideoResult {
  /** false when the locked version does not ask for a merged deliverable. */
  assembled: boolean;
  /** true when a previous call already produced this run's final video. */
  cached: boolean;
  finalVideoUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  stepIds: string[];
  clips: WorkflowFinalVideoClip[];
}

interface FinalizeResponsePayload {
  success?: boolean;
  assembled?: boolean;
  cached?: boolean;
  finalVideoUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  stepIds?: unknown;
  clips?: unknown;
  error?: unknown;
}

const readErrorMessage = (value: unknown, fallback: string): string => {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'details']) {
      const nested = record[key];
      if (typeof nested === 'string' && nested.trim()) return nested;
    }
  }
  return fallback;
};

const readClips = (value: unknown): WorkflowFinalVideoClip[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WorkflowFinalVideoClip[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.stepId !== 'string') return [];
    return [{
      stepId: record.stepId,
      order: typeof record.order === 'number' ? record.order : 0,
      executionMode: record.executionMode === 'reused_template_result'
        ? 'reused_template_result'
        : 'generated',
    }];
  });
};

/**
 * Asks the server to join this run's included clips into one deliverable.
 *
 * The browser deliberately sends only the run id: which clips belong to the
 * final cut is read server-side from the locked published Quick Use
 * definition, so a tampered client cannot change the deliverable.
 *
 * The call is idempotent — a run that already has a final video returns the
 * stored one without paying for a second merge.
 */
export async function finalizeWorkflowVideo(
  runId: string,
  options: { signal?: AbortSignal } = {},
): Promise<WorkflowFinalVideoResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new Error('Your session expired before the final video could be assembled.');
  }

  const response = await fetch('/api/finalize-workflow-video', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ runId }),
    signal: options.signal,
  });

  const payload = await response.json().catch(() => ({})) as FinalizeResponsePayload;
  if (!response.ok || !payload.success) {
    throw new Error(readErrorMessage(payload.error, 'Could not assemble the final video.'));
  }

  return {
    assembled: payload.assembled !== false && Boolean(payload.finalVideoUrl),
    cached: Boolean(payload.cached),
    finalVideoUrl: payload.finalVideoUrl || null,
    thumbnailUrl: payload.thumbnailUrl || null,
    durationSeconds: typeof payload.durationSeconds === 'number' ? payload.durationSeconds : null,
    stepIds: Array.isArray(payload.stepIds)
      ? payload.stepIds.filter((id): id is string => typeof id === 'string')
      : [],
    clips: readClips(payload.clips),
  };
}
