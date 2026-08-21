import { useEffect, useState } from 'react';
import type { Plan } from '../types';
import type {
  QuickUseBrowserValues,
  QuickUseExecutionProgress,
} from './quickUseExecutor';

/**
 * Owns the in-flight Quick Use run for the whole app.
 *
 * This lives in a module, not in a component, on purpose. The run used to be
 * held in Home's useState with its AbortController in a ref, so navigating to
 * any other page unmounted Home and took the progress with it: the user lost
 * the only window onto work they had already paid for, and — since the browser
 * is what advances server-side video assembly — the assembly stalled too.
 *
 * A module-level owner survives navigation. The dock reads from here, so the
 * run stays visible and keeps progressing from any page in the app.
 */

export interface ActiveQuickUseRun {
  templateId: string;
  templateRouteKey: string;
  templateName: string;
  coverUrl?: string;
  totalSteps: number;
  progress: QuickUseExecutionProgress;
  startedAt: number;
  /** Set when the run was recovered after a reload and cannot be resumed. */
  interrupted?: boolean;
}

export interface StartQuickUseRunOptions {
  templateId: string;
  templateRouteKey: string;
  templateName: string;
  coverUrl?: string;
  userId: string;
  userPlan: Plan;
  totalSteps: number;
  values: QuickUseBrowserValues;
}

const CHANGED_EVENT = 'quick-use-run-changed';
const STORAGE_KEY = 'lazora_quick_use_run';

let activeRun: ActiveQuickUseRun | null = null;
let controller: AbortController | null = null;
/** True while a full-size modal is already showing this run. */
let presented = false;

const isBusyStatus = (status: QuickUseExecutionProgress['status']): boolean =>
  status === 'preparing' || status === 'running' || status === 'assembling';

const notify = () => {
  // The running flag is global so any page can suppress conflicting UI, which
  // is exactly what it could not do while the run lived inside Home.
  if (activeRun && isBusyStatus(activeRun.progress.status)) {
    document.body.dataset.quickUseRunning = 'true';
  } else {
    delete document.body.dataset.quickUseRunning;
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
};

/**
 * A pointer, not a mirror. Enough to recognise the run after a reload and go
 * ask the server what happened to it — never enough to fake a result.
 */
const persistPointer = () => {
  try {
    if (!activeRun || activeRun.progress.runId === 'starting') {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      runId: activeRun.progress.runId,
      templateId: activeRun.templateId,
      templateRouteKey: activeRun.templateRouteKey,
      templateName: activeRun.templateName,
      coverUrl: activeRun.coverUrl,
      totalSteps: activeRun.totalSteps,
      startedAt: activeRun.startedAt,
      status: activeRun.progress.status,
    }));
  } catch {
    // Private-mode storage failures must never break a running generation.
  }
};

const setRun = (next: ActiveQuickUseRun | null) => {
  activeRun = next;
  persistPointer();
  notify();
};

export const getQuickUseRun = (): ActiveQuickUseRun | null => activeRun;

export const isQuickUseRunBusy = (): boolean =>
  Boolean(activeRun && isBusyStatus(activeRun.progress.status));

/**
 * Lets a page claim the run so the floating dock stays out of its way. The
 * dock reappears the moment that page stops presenting — including when it
 * unmounts because the user navigated somewhere else.
 */
export const setQuickUseRunPresented = (value: boolean): void => {
  if (presented === value) return;
  presented = value;
  notify();
};

export const isQuickUseRunPresented = (): boolean => presented;

export const cancelQuickUseRun = (): void => {
  controller?.abort();
};

export const dismissQuickUseRun = (): void => {
  if (activeRun && isBusyStatus(activeRun.progress.status)) return;
  controller = null;
  setRun(null);
};

/**
 * Starts a run and keeps driving it regardless of what the user does next.
 *
 * Resolves with the final progress, or rejects the way the executor does, so a
 * caller that is still mounted can react. A caller that has gone away changes
 * nothing: the run continues and the dock reports it.
 */
export async function startQuickUseRun(
  options: StartQuickUseRunOptions,
): Promise<QuickUseExecutionProgress> {
  if (isQuickUseRunBusy()) {
    throw new Error('A Template generation is already running.');
  }

  const abortController = new AbortController();
  controller = abortController;
  setRun({
    templateId: options.templateId,
    templateRouteKey: options.templateRouteKey,
    templateName: options.templateName,
    coverUrl: options.coverUrl,
    totalSteps: options.totalSteps,
    startedAt: Date.now(),
    progress: {
      runId: 'starting',
      status: 'preparing',
      currentStep: 0,
      totalSteps: options.totalSteps,
    },
  });

  try {
    const { executeQuickUseTemplate } = await import('./quickUseExecutor');
    return await executeQuickUseTemplate({
      templateId: options.templateId,
      templateName: options.templateName,
      userId: options.userId,
      userPlan: options.userPlan,
      values: options.values,
      signal: abortController.signal,
      onProgress: (progress) => {
        if (controller !== abortController) return;
        setRun(activeRun ? { ...activeRun, progress } : null);
      },
    });
  } catch (error) {
    if (controller === abortController && activeRun) {
      const cancelled = error instanceof Error && error.name === 'QuickUseCancelledError';
      setRun({
        ...activeRun,
        progress: {
          ...activeRun.progress,
          status: cancelled ? 'cancelled' : 'failed',
          error: cancelled
            ? undefined
            : error instanceof Error ? error.message : 'Template generation failed.',
        },
      });
    }
    throw error;
  } finally {
    if (controller === abortController) controller = null;
  }
}

/**
 * Picks a run back up after a full page reload.
 *
 * A reload kills the in-flight fetches, so the generation itself cannot be
 * resumed — but the server already recorded everything that finished. If the
 * run produced its joined video, it is shown. If every step finished but the
 * video was never assembled, assembly is resumed here, which is also what
 * rescues a run whose tab was closed mid-assembly. Anything else is reported
 * honestly as interrupted rather than left as a silent gap.
 */
export async function recoverQuickUseRun(): Promise<void> {
  if (activeRun) return;
  let pointer: {
    runId?: unknown;
    templateId?: unknown;
    templateRouteKey?: unknown;
    templateName?: unknown;
    coverUrl?: unknown;
    totalSteps?: unknown;
    startedAt?: unknown;
    status?: unknown;
  };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    pointer = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  const runId = typeof pointer.runId === 'string' ? pointer.runId : '';
  if (!runId) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  // A run the user already saw through to the end needs no rescue.
  if (pointer.status === 'completed' || pointer.status === 'cancelled') {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  const base = {
    templateId: typeof pointer.templateId === 'string' ? pointer.templateId : '',
    templateRouteKey: typeof pointer.templateRouteKey === 'string' ? pointer.templateRouteKey : '',
    templateName: typeof pointer.templateName === 'string' ? pointer.templateName : 'Template',
    coverUrl: typeof pointer.coverUrl === 'string' ? pointer.coverUrl : undefined,
    totalSteps: typeof pointer.totalSteps === 'number' ? pointer.totalSteps : 1,
    startedAt: typeof pointer.startedAt === 'number' ? pointer.startedAt : Date.now(),
  };

  try {
    const [{ fetchTemplateRun, fetchTemplateRunFinalVideo }, { finalizeWorkflowVideo }] =
      await Promise.all([import('./templateRunApi'), import('./workflowFinalizer')]);

    const stored = await fetchTemplateRunFinalVideo(runId).catch(() => null);
    if (stored?.finalVideoUrl) {
      setRun({
        ...base,
        progress: {
          runId,
          status: 'completed',
          currentStep: base.totalSteps,
          totalSteps: base.totalSteps,
          result: { type: 'video', url: stored.finalVideoUrl },
          finalVideo: {
            url: stored.finalVideoUrl,
            thumbnailUrl: stored.finalThumbnailUrl,
            durationSeconds: null,
            stepIds: stored.stepIds,
          },
        },
      });
      return;
    }

    const run = await fetchTemplateRun(runId).catch(() => null);
    const everyStepDone = Boolean(run?.steps.length)
      && run!.steps.every((step) => step.status === 'completed');

    if (everyStepDone) {
      setRun({
        ...base,
        progress: {
          runId,
          status: 'assembling',
          currentStep: base.totalSteps,
          totalSteps: base.totalSteps,
          stepTitle: 'Joining your shots',
        },
      });
      const assembled = await finalizeWorkflowVideo(runId);
      const lastStep = run!.steps[run!.steps.length - 1];
      const fallbackUrl = assembled.finalVideoUrl || null;
      setRun({
        ...base,
        progress: {
          runId,
          status: fallbackUrl ? 'completed' : 'failed',
          currentStep: base.totalSteps,
          totalSteps: base.totalSteps,
          result: fallbackUrl ? { type: 'video', url: fallbackUrl } : undefined,
          error: fallbackUrl
            ? undefined
            : 'This run finished, but its joined video could not be recovered.',
          finalVideo: fallbackUrl
            ? {
                url: fallbackUrl,
                thumbnailUrl: assembled.thumbnailUrl,
                durationSeconds: assembled.durationSeconds,
                stepIds: assembled.stepIds,
              }
            : undefined,
        },
      });
      void lastStep;
      return;
    }

    // The generation itself cannot be resumed: the requests died with the page.
    // Say so, and point at the shots that did finish.
    setRun({
      ...base,
      interrupted: true,
      progress: {
        runId,
        status: 'failed',
        currentStep: run?.currentStep ?? 0,
        totalSteps: base.totalSteps,
        error: 'This generation was interrupted when the page reloaded. Any shots that finished are in your Dashboard.',
      },
    });
  } catch (error) {
    console.error('Could not recover the previous Template run:', error);
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

export interface QuickUseRunView {
  run: ActiveQuickUseRun | null;
  presented: boolean;
}

export const useQuickUseRun = (): QuickUseRunView => {
  const [view, setView] = useState<QuickUseRunView>(() => ({ run: activeRun, presented }));

  useEffect(() => {
    const handleChange = () => setView({ run: activeRun, presented });
    handleChange();
    window.addEventListener(CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(CHANGED_EVENT, handleChange);
  }, []);

  return view;
};
