import { supabase } from './supabase';

export interface WorkflowFinalVideoClip {
  stepId: string;
  order: number;
  executionMode: 'generated' | 'reused_template_result';
}

export type WorkflowFinalVideoPhase = 'padding' | 'merging' | 'mixing' | 'storing';

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
  status?: unknown;
  phase?: unknown;
  assembled?: boolean;
  cached?: boolean;
  finalVideoUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  stepIds?: unknown;
  clips?: unknown;
  error?: unknown;
}

/**
 * How long the browser keeps advancing the assembly before giving up. Well past
 * any realistic assembly; it exists so a wedged provider job cannot spin here
 * forever.
 */
const MAX_TOTAL_WAIT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;

/** Transient network blips must not abandon work that is already paid for. */
const MAX_CONSECUTIVE_NETWORK_ERRORS = 3;

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

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  function onAbort() {
    clearTimeout(timer);
    reject(new DOMException('Aborted', 'AbortError'));
  }
  if (signal?.aborted) {
    clearTimeout(timer);
    reject(new DOMException('Aborted', 'AbortError'));
    return;
  }
  signal?.addEventListener('abort', onAbort, { once: true });
});

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

async function requestAssemblyStep(
  runId: string,
  signal?: AbortSignal,
): Promise<FinalizeResponsePayload> {
  // The token is read per attempt rather than once: assembly can outlive a
  // token refresh, and a stale bearer would fail the whole run at the finish.
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
    signal,
  });

  const payload = await response.json().catch(() => ({})) as FinalizeResponsePayload;
  if (!response.ok || !payload.success) {
    throw new Error(readErrorMessage(payload.error, 'Could not assemble the final video.'));
  }
  return payload;
}

/**
 * Drives this run's clips through assembly and returns the finished deliverable.
 *
 * The browser deliberately sends only the run id: which clips belong to the
 * final cut is read server-side from the locked published Quick Use definition,
 * so a tampered client cannot change the deliverable.
 *
 * The server does the work in slices and checkpoints between them, answering
 * `pending` when its slice is up. This function simply keeps asking. That is
 * what keeps the feature off the platform's function-timeout limit: no single
 * request has to survive the whole chain of provider round trips, and each
 * `pending` reply means real progress was saved, never work repeated.
 *
 * Every call is idempotent — a run that already has a final video returns the
 * stored one without paying for a second merge.
 */
export async function finalizeWorkflowVideo(
  runId: string,
  options: { signal?: AbortSignal; onPhase?: (phase: WorkflowFinalVideoPhase) => void } = {},
): Promise<WorkflowFinalVideoResult> {
  const deadline = Date.now() + MAX_TOTAL_WAIT_MS;
  let networkErrors = 0;
  let lastPhase: WorkflowFinalVideoPhase | null = null;

  for (;;) {
    let payload: FinalizeResponsePayload;
    try {
      payload = await requestAssemblyStep(runId, options.signal);
      networkErrors = 0;
    } catch (error) {
      if (isAbort(error)) throw error;
      // A 500 carries a real reason from the server and is final. A failed
      // fetch has no payload and is worth retrying: the checkpoint is safe.
      const isNetworkError = error instanceof TypeError;
      networkErrors += 1;
      if (!isNetworkError || networkErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS || Date.now() > deadline) {
        throw error;
      }
      await sleep(POLL_INTERVAL_MS, options.signal);
      continue;
    }

    if (payload.status !== 'pending') {
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

    const phase = payload.phase === 'padding' || payload.phase === 'merging' || payload.phase === 'mixing' || payload.phase === 'storing'
      ? payload.phase
      : null;
    if (phase && phase !== lastPhase) {
      lastPhase = phase;
      options.onPhase?.(phase);
    }

    if (Date.now() > deadline) {
      throw new Error('The final video is taking longer than expected. It will be ready shortly.');
    }
    await sleep(POLL_INTERVAL_MS, options.signal);
  }
}
