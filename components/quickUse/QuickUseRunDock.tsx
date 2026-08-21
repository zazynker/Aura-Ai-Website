import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  Maximize2,
  Workflow,
  X,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { Button } from '../ui/Button';
import {
  cancelQuickUseRun,
  dismissQuickUseRun,
  recoverQuickUseRun,
  useQuickUseRun,
} from '../../utils/quickUseRunManager';

/**
 * The app-wide window onto a Quick Use run.
 *
 * Mounted next to the router rather than inside a page, so leaving the page a
 * run was started from no longer hides it. The dock stands down while a page is
 * presenting the run in full — and takes over the moment that page goes away.
 */

const BUSY_STATUSES = ['preparing', 'running', 'assembling'] as const;

const isBusy = (status: string): boolean =>
  (BUSY_STATUSES as readonly string[]).includes(status);

async function downloadResult(url: string, fileName: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('unreachable');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // A blocked cross-origin read should still get the user to their file.
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

const StepDots: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <div className="mt-2 flex items-center gap-1.5">
    {Array.from({ length: total }, (_, index) => {
      const stepNumber = index + 1;
      const done = stepNumber < current;
      const active = stepNumber === Math.max(1, current);
      return (
        <React.Fragment key={stepNumber}>
          {index > 0 && (
            <span className={`h-0.5 w-4 ${done ? 'bg-purple-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
          )}
          <span
            className={`flex h-3.5 w-3.5 items-center justify-center rounded-full ${
              done
                ? 'bg-purple-500'
                : active
                  ? 'bg-purple-500 animate-pulse'
                  : 'bg-slate-200 dark:bg-slate-700'
            }`}
          >
            {done && <Check className="h-2.5 w-2.5 text-white" />}
          </span>
        </React.Fragment>
      );
    })}
  </div>
);

export const QuickUseRunDock: React.FC = () => {
  const { run, presented } = useQuickUseRun();
  const { addToast, updateUser, refreshGenerations, user } = useStore();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const settledRunIdRef = useRef<string | null>(null);
  const recoveredRef = useRef(false);

  // A reload kills the in-flight generation but not the record of it. Ask the
  // server what happened before deciding the user has nothing to come back to.
  useEffect(() => {
    if (!user || recoveredRef.current) return;
    recoveredRef.current = true;
    void recoverQuickUseRun();
  }, [user]);

  const status = run?.progress.status;
  const runId = run?.progress.runId;

  // Credit and history refreshes belong here, not in the page that started the
  // run: the page is often gone by the time the run finishes.
  useEffect(() => {
    if (!run || !runId || !status) return;
    if (isBusy(status) || settledRunIdRef.current === runId) return;
    settledRunIdRef.current = runId;

    if (status === 'completed') {
      addToast('success', 'Your Template result is ready.');
      void refreshGenerations();
      void import('../../utils/api')
        .then(({ fetchUserCredits }) => fetchUserCredits())
        .then((result) => {
          if (result.data) updateUser({ credits: result.data.credits });
        })
        .catch(() => {});
    } else if (status === 'failed' && run.progress.error) {
      addToast('error', run.progress.error);
    }
  }, [addToast, refreshGenerations, run, runId, status, updateUser]);

  // Opening the result view is the whole point of the completed state; do it
  // for the user rather than making them find the button.
  useEffect(() => {
    if (status === 'completed' && !presented) setExpanded(true);
  }, [status, presented]);

  const handleClose = useCallback(() => {
    setExpanded(false);
    if (!status || !isBusy(status)) dismissQuickUseRun();
  }, [status]);

  if (!run || presented) return null;

  const { progress } = run;
  const busy = isBusy(progress.status);
  const finalUrl = progress.result?.url;
  const isVideo = progress.result?.type === 'video';
  const poster = progress.finalVideo?.thumbnailUrl || run.coverUrl;
  const reusedCount = (progress.stepResults || []).filter(
    (step) => step.executionMode === 'reused_template_result',
  ).length;

  const headline = progress.status === 'completed'
    ? 'Your result is ready'
    : progress.status === 'failed'
      ? run.interrupted ? 'Generation interrupted' : 'Generation needs attention'
      : progress.status === 'cancelled'
        ? 'Generation cancelled'
        : progress.stepTitle || 'Preparing your template';

  return (
    <>
      {!expanded && (
        <div className="fixed bottom-6 right-6 z-[70] w-[min(23rem,calc(100vw-2rem))] animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
              {poster
                ? <img src={poster} alt="" className="h-full w-full object-cover" />
                : <Workflow className="m-3 h-6 w-6 text-purple-500" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`flex items-center gap-1.5 text-sm font-bold ${
                progress.status === 'failed' ? 'text-red-600' : 'text-slate-900 dark:text-white'
              }`}>
                {progress.status === 'completed' && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                {progress.status === 'failed' && <AlertCircle className="h-4 w-4 shrink-0" />}
                {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-purple-500" />}
                <span className="truncate">{headline}</span>
              </div>
              <p className="truncate text-xs text-slate-500">{run.templateName}</p>
              {busy && progress.status !== 'assembling' && (
                <StepDots current={progress.currentStep} total={run.totalSteps} />
              )}
            </div>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="shrink-0 rounded-full border border-slate-200 p-2 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-purple-600 dark:border-white/10 dark:hover:bg-white/5"
              aria-label={progress.status === 'completed' ? 'View result' : 'Expand generation'}
            >
              {progress.status === 'completed'
                ? <span className="px-1 text-xs font-semibold text-purple-600 dark:text-purple-300">View</span>
                : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div
          className="fixed inset-0 z-[110] overflow-y-auto bg-black/80 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExpanded(false);
          }}
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl items-center px-4 py-10">
            <div className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
              <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-white/10">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">{headline}</h2>
                  <p className="truncate text-xs text-slate-500">{run.templateName}</p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="px-6 py-6">
                {busy && (
                  <div className="flex flex-col items-center py-10 text-center">
                    <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
                    <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {progress.stepTitle || 'Working on your template'}
                    </p>
                    {progress.status !== 'assembling' && (
                      <p className="mt-1 text-xs text-slate-500">
                        Step {Math.max(1, progress.currentStep)} of {run.totalSteps}
                      </p>
                    )}
                    <p className="mt-4 max-w-sm text-xs text-slate-400">
                      You can keep browsing — this keeps running and will tell you when it is done.
                    </p>
                    <Button variant="secondary" size="sm" className="mt-5" onClick={cancelQuickUseRun}>
                      Cancel generation
                    </Button>
                  </div>
                )}

                {!busy && progress.status === 'failed' && (
                  <div className="py-6 text-center">
                    <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
                    <p className="mx-auto mt-4 max-w-md text-sm text-slate-600 dark:text-slate-300">
                      {progress.error || 'This generation did not finish.'}
                    </p>
                    <div className="mt-6 flex justify-center gap-3">
                      <Button variant="secondary" onClick={() => { setExpanded(false); dismissQuickUseRun(); }}>
                        Dismiss
                      </Button>
                      <Button
                        variant="gradient"
                        onClick={() => {
                          setExpanded(false);
                          dismissQuickUseRun();
                          navigate('/dashboard');
                        }}
                      >
                        Open Dashboard
                      </Button>
                    </div>
                  </div>
                )}

                {!busy && progress.status === 'cancelled' && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      This generation was cancelled. Nothing further was charged.
                    </p>
                    <Button variant="secondary" className="mt-6" onClick={() => { setExpanded(false); dismissQuickUseRun(); }}>
                      Close
                    </Button>
                  </div>
                )}

                {progress.status === 'completed' && finalUrl && (
                  <div>
                    {progress.finalVideoError && (
                      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                        This template joins its shots into one video, but that step did not finish:
                        {' '}{progress.finalVideoError} Your individual shots are below and were not lost.
                      </div>
                    )}
                    <div className="overflow-hidden rounded-2xl bg-black">
                      {isVideo ? (
                        <video
                          src={finalUrl}
                          poster={poster}
                          controls
                          autoPlay
                          playsInline
                          className="mx-auto max-h-[55vh] w-full object-contain"
                        />
                      ) : (
                        <img src={finalUrl} alt="Template result" className="mx-auto max-h-[55vh] w-full object-contain" />
                      )}
                    </div>

                    {(progress.stepResults || []).length > 0 && (
                      <div className="mt-5">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Step results
                          </p>
                          {reusedCount > 0 && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                              {reusedCount} reused · no credits
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                          {(progress.stepResults || []).map((step, index) => (
                            <a
                              key={`${step.stepId}-${index}`}
                              href={step.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-slate-800"
                            >
                              {step.type === 'video' ? (
                                <video src={step.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                              ) : (
                                <img src={step.url} alt="" className="h-full w-full object-cover" />
                              )}
                              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">
                                {index + 1}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-6 flex flex-wrap justify-end gap-3">
                      <Button variant="secondary" onClick={() => { setExpanded(false); dismissQuickUseRun(); }}>
                        Close
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setExpanded(false);
                          dismissQuickUseRun();
                          navigate('/dashboard');
                        }}
                      >
                        Open Dashboard
                      </Button>
                      <Button
                        variant="gradient"
                        onClick={() => void downloadResult(
                          finalUrl,
                          `${run.templateName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'result'}.${isVideo ? 'mp4' : 'png'}`,
                        )}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
