import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Loader2, Maximize2, Workflow } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { RealTemplateDetail } from '../../utils/templateDetailApi';
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
 *
 * It renders exactly two things: a collapsed pill, and — when expanded — the
 * ordinary TemplateExperienceModal. It deliberately owns no progress or result
 * UI of its own. An earlier version did, and the result was two different
 * panels for the same run depending on which page you happened to be on.
 */

const TemplateExperienceModal = React.lazy(() => import('../template/TemplateExperienceModal').then((module) => ({
  default: module.TemplateExperienceModal,
})));

const BUSY_STATUSES = ['preparing', 'running', 'assembling'] as const;

const isBusy = (status: string): boolean =>
  (BUSY_STATUSES as readonly string[]).includes(status);

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
  const [detail, setDetail] = useState<RealTemplateDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const settledRunIdRef = useRef<string | null>(null);
  const recoveredRef = useRef(false);
  const loadedRouteKeyRef = useRef<string | null>(null);

  // A reload kills the in-flight generation but not the record of it. Ask the
  // server what happened before deciding the user has nothing to come back to.
  useEffect(() => {
    if (!user || recoveredRef.current) return;
    recoveredRef.current = true;
    void recoverQuickUseRun();
  }, [user]);

  const status = run?.progress.status;
  const runId = run?.progress.runId;
  const routeKey = run?.templateRouteKey;

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

  // The modal needs the published template to render anything at all. The dock
  // never had it — which is why it grew its own panels instead. Fetching it
  // here is what lets the whole app share one panel.
  useEffect(() => {
    if (!expanded || !routeKey || loadedRouteKeyRef.current === routeKey) return;
    loadedRouteKeyRef.current = routeKey;
    setDetail(null);
    setDetailError(null);
    let cancelled = false;
    void import('../../utils/templateDetailApi')
      .then(({ fetchPublicTemplateDetail }) => fetchPublicTemplateDetail(routeKey))
      .then((loaded) => {
        if (!cancelled) setDetail(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        loadedRouteKeyRef.current = null;
        setDetailError(error instanceof Error ? error.message : 'Could not load this template.');
      });
    return () => { cancelled = true; };
  }, [expanded, routeKey]);

  // Opening the result view is the whole point of the completed state; do it
  // for the user rather than making them find the button.
  useEffect(() => {
    if (status === 'completed' && !presented) setExpanded(true);
  }, [status, presented]);

  const collapse = useCallback(() => setExpanded(false), []);

  // Minimising keeps the pill. Closing a run that has nothing left to report
  // puts it away for good.
  const handleClose = useCallback(() => {
    setExpanded(false);
    if (!status || !isBusy(status)) dismissQuickUseRun();
  }, [status]);

  // Retry and "Edit inputs" send the user back to the template.
  //
  // The dock cannot replay a failed run in place: it never held the inputs, and
  // uploaded files cannot be recreated from a finished run anyway. Wiring these
  // to a no-op would leave a button that looks live and does nothing, so they
  // go where the inputs actually are.
  const restartFromTemplate = useCallback(() => {
    setExpanded(false);
    dismissQuickUseRun();
    if (routeKey) navigate(`/templates/${routeKey}`);
  }, [navigate, routeKey]);

  if (!run || presented) return null;

  const { progress } = run;
  const busy = isBusy(progress.status);
  const poster = progress.finalVideo?.thumbnailUrl || run.coverUrl;

  const headline = progress.status === 'completed'
    ? 'Your result is ready'
    : progress.status === 'failed'
      ? run.interrupted ? 'Generation interrupted' : 'Generation needs attention'
      : progress.status === 'cancelled'
        ? 'Generation cancelled'
        : progress.stepTitle || 'Preparing your template';

  if (expanded) {
    return (
      <React.Suspense fallback={null}>
        <TemplateExperienceModal
          isOpen
          mode="use"
          detail={detail}
          loading={!detail && !detailError}
          error={detailError}
          generationAvailable
          isAdmin={Boolean(user?.isAdmin)}
          execution={progress}
          onClose={handleClose}
          onUse={collapse}
          onMinimize={collapse}
          onCancel={cancelQuickUseRun}
          onGenerate={restartFromTemplate}
          onReset={restartFromTemplate}
        />
      </React.Suspense>
    );
  }

  return (
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
  );
};
