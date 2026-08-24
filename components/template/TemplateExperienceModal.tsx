import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, ChevronDown, Download, Eye, Film, Image as ImageIcon, Images, Loader2, Minus, RotateCcw, Sparkles, Upload, Video, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { RealTemplateDetail } from '../../utils/templateDetailApi';
import type { JsonPrimitive } from '../../workflows/types';
import type {
  QuickUseBlockDefinition,
  QuickUsePresentationCandidate,
  QuickUsePresentationDefinition,
} from '../../workflows/quickUseTypes';
import type {
  QuickUseExecutionProgress,
  QuickUseStepOutcome,
} from '../../utils/quickUseExecutor';
import { DialogueEditor } from './DialogueEditor';
import { QuickUseNumberControl } from './QuickUseNumberControl';
import { estimateQuickUseCreditsDetailed } from '../../utils/quickUseCredits';

export type QuickUseInputValue = JsonPrimitive | File | null;
export type QuickUseInputValues = Record<string, QuickUseInputValue>;
type AdminDemoAssetType = 'image' | 'image_group' | 'video';

// Module-level File references let an admin close and reopen the same Template
// without losing the simulated result. The cache is scoped by Template: a demo
// video chosen for one Template must never arm another Template's simulation.
// It is intentionally in-memory only and clears on a full page reload.
const cachedAdminDemos = new Map<string, { assetType: AdminDemoAssetType; files: File[] }>();
type AdminDemoStage = 'upload' | 'running' | 'result' | 'cancelled';

const downloadGeneratedResult = async (
  result: { type: 'image' | 'video'; url: string },
): Promise<void> => {
  const extension = result.type === 'video' ? 'mp4' : 'png';
  try {
    const response = await fetch(result.url);
    if (!response.ok) throw new Error('Download failed.');
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `lazora-template-result.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  } catch {
    window.open(result.url, '_blank', 'noopener,noreferrer');
  }
};

interface TemplateExperienceModalProps {
  isOpen: boolean;
  mode: 'view' | 'use';
  detail: RealTemplateDetail | null;
  loading: boolean;
  error: string | null;
  generationAvailable: boolean;
  execution?: QuickUseExecutionProgress | null;
  onClose: () => void;
  onUse: () => void;
  onGenerate?: (values: QuickUseInputValues, estimatedCredits: number) => void | Promise<void>;
  onMinimize?: () => void;
  onCancel?: () => void;
  onReset?: () => void;
  isAdmin?: boolean;
  initialValues?: QuickUseInputValues | null;
  showCreditEstimate?: boolean;
}

export function validateQuickUseInputValues(
  definition: QuickUsePresentationDefinition,
  values: QuickUseInputValues,
): string[] {
  return definition.blocks.flatMap((block) => {
    if (!block.required) return [];
    const value = values[block.candidateId];
    if (value instanceof File) return [];
    if (value === null || value === undefined || value === '') {
      return [`${block.title} is required.`];
    }
    return [];
  });
}

export const TemplateExperienceModal = ({
  detail,
  error,
  execution,
  generationAvailable,
  initialValues = null,
  isOpen,
  isAdmin = false,
  loading,
  mode,
  onClose,
  onCancel,
  onGenerate,
  onMinimize,
  onReset,
  onUse,
  showCreditEstimate = true,
}: TemplateExperienceModalProps) => {
  const [values, setValues] = useState<QuickUseInputValues>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [adminDemoOpen, setAdminDemoOpen] = useState(false);
  const [adminDemoAssetType, setAdminDemoAssetType] = useState<AdminDemoAssetType>('image');
  const [adminDemoFiles, setAdminDemoFiles] = useState<File[]>([]);
  const [adminDemoStage, setAdminDemoStage] = useState<AdminDemoStage>('upload');
  const [adminDemoStep, setAdminDemoStep] = useState(1);
  const [adminDemoMinimized, setAdminDemoMinimized] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const adminDemoTimersRef = useRef<number[]>([]);
  const adminDemoUrls = useMemo(
    () => adminDemoFiles.map((file) => URL.createObjectURL(file)),
    [adminDemoFiles],
  );

  const definition = detail?.quickUseDefinition || null;
  const candidateById = useMemo(
    () => new Map(definition?.candidates.map((candidate) => [candidate.id, candidate]) || []),
    [definition],
  );
  // Priced the way the run will actually be charged: steps whose inputs are
  // untouched serve the template's own shots and cost nothing.
  const creditEstimate = useMemo(
    () => estimateQuickUseCreditsDetailed({
      steps: detail?.quickUseCreditSteps || [],
      blocks: definition?.blocks || [],
      values,
      reuseEnabled: detail?.quickUseStepReuseEnabled !== false,
    }),
    [definition, detail?.quickUseCreditSteps, detail?.quickUseStepReuseEnabled, values],
  );
  const estimatedCredits = creditEstimate.total;

  useEffect(() => {
    if (!definition) {
      setValues({});
      return;
    }
    setValues(Object.fromEntries(definition.blocks.map((block) => {
      const hasRestoredValue = initialValues
        && Object.prototype.hasOwnProperty.call(initialValues, block.candidateId);
      return [
        block.candidateId,
        hasRestoredValue
          ? initialValues[block.candidateId]
          : block.defaultValue ?? (block.control === 'toggle' ? false : null),
      ];
    })));
    setValidationError(null);
  }, [definition, initialValues]);

  useEffect(() => () => {
    adminDemoUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [adminDemoUrls]);

  useEffect(() => {
    if (!detail?.id) return;
    const cached = cachedAdminDemos.get(detail.id);
    setAdminDemoAssetType(cached?.assetType || 'image');
    setAdminDemoFiles(cached?.files || []);
  }, [detail?.id]);

  useEffect(() => () => {
    adminDemoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const resetAdminDemo = (close = false) => {
    adminDemoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    adminDemoTimersRef.current = [];
    setAdminDemoStage('upload');
    setAdminDemoStep(1);
    setAdminDemoMinimized(false);
    if (close) setAdminDemoOpen(false);
  };

  const startAdminDemo = () => {
    if (!detail) return;
    const cached = cachedAdminDemos.get(detail.id);
    const demoAssetType = adminDemoFiles.length > 0
      ? adminDemoAssetType
      : cached?.assetType || adminDemoAssetType;
    const demoFiles = adminDemoFiles.length > 0 ? adminDemoFiles : cached?.files || [];
    if (demoFiles.length === 0) return;
    // Rehydrate synchronously before the timers begin. This is a final guard
    // against the real executor being reached during a close/reopen race.
    setAdminDemoAssetType(demoAssetType);
    setAdminDemoFiles(demoFiles);
    adminDemoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    adminDemoTimersRef.current = [];
    setAdminDemoOpen(true);
    setAdminDemoMinimized(false);
    setAdminDemoStage('running');
    setAdminDemoStep(1);
    const stepCount = Math.max(1, detail.steps.length);
    let elapsedMs = 0;
    for (let step = 2; step <= stepCount; step += 1) {
      const previousStep = detail.steps[step - 2];
      elapsedMs += previousStep && /video|motion|lip sync/i.test(previousStep.featureName) ? 15_000 : 10_000;
      adminDemoTimersRef.current.push(window.setTimeout(() => setAdminDemoStep(step), elapsedMs));
    }
    const finalStep = detail.steps[stepCount - 1];
    elapsedMs += finalStep && /video|motion|lip sync/i.test(finalStep.featureName) ? 15_000 : 10_000;
    adminDemoTimersRef.current.push(window.setTimeout(() => setAdminDemoStage('result'), elapsedMs));
  };

  const confirmCancellation = () => {
    setShowCancelConfirmation(false);
    if (adminDemoOpen && adminDemoStage === 'running') {
      adminDemoTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      adminDemoTimersRef.current = [];
      setAdminDemoStage('cancelled');
      return;
    }
    onCancel?.();
  };

  const handleGenerate = () => {
    if (!definition) return;
    const issues = validateQuickUseInputValues(definition, values);
    if (issues.length > 0) {
      setValidationError(issues[0]);
      return;
    }
    setValidationError(null);
    const hasCachedAdminDemo = Boolean(detail?.id && cachedAdminDemos.get(detail.id)?.files.length);
    if (isAdmin && (adminDemoFiles.length > 0 || hasCachedAdminDemo)) {
      startAdminDemo();
      return;
    }
    if (!onGenerate) return;
    void onGenerate(values, estimatedCredits);
  };

  const isAssembling = execution?.status === 'assembling';
  const isExecuting = execution?.status === 'preparing'
    || execution?.status === 'running'
    || isAssembling;
  const isBusy = isExecuting || (adminDemoOpen && adminDemoStage === 'running');
  const cachedAdminDemo = detail?.id ? cachedAdminDemos.get(detail.id) : undefined;
  const isAdminDemoArmed = isAdmin && (adminDemoFiles.length > 0 || Boolean(cachedAdminDemo?.files.length));

  const footer = detail && mode === 'use' && !adminDemoOpen && !loading && !error && !isExecuting && !execution
    ? (
          <div className="space-y-2">
            {!generationAvailable && !isAdminDemoArmed && (
              <p className="text-center text-xs text-slate-500">
                Automatic execution will be enabled in the executor integration step.
              </p>
            )}
            {creditEstimate.reusedStepIds.length > 0 && (
              <p className="text-center text-xs text-slate-500">
                {creditEstimate.generatedStepIds.length === 0
                  ? 'Nothing changed yet — this template delivers its own shots for free.'
                  : `${creditEstimate.reusedStepIds.length} unchanged ${creditEstimate.reusedStepIds.length === 1 ? 'shot is' : 'shots are'} reused for free.`}
              </p>
            )}
            <Button
              variant="gradient"
              className="w-full"
              disabled={(!generationAvailable && !isAdminDemoArmed) || !definition?.blocks.length || isExecuting}
              onClick={handleGenerate}
            >
              {!showCreditEstimate
                ? 'Generate'
                : estimatedCredits === 0
                  ? 'Free · Generate'
                  : `~${estimatedCredits} credits · Generate`}
            </Button>
          </div>
      )
    : null;

  const modalTitleText = mode === 'view'
    ? 'Template preview'
    : adminDemoOpen && adminDemoStage === 'running'
      ? 'Generating...'
      : adminDemoOpen && adminDemoStage === 'result'
        ? 'Completed'
        : isAssembling
          ? 'Joining your shots...'
          : isExecuting
      ? 'Generating...'
      : execution?.status === 'completed'
        ? 'Completed'
        : execution?.status === 'cancelled'
          ? 'Cancelled'
        : execution?.status === 'failed'
          ? 'Generation failed'
          : 'Quick Use';
  const modalTitle = mode === 'use' && isAdmin && !adminDemoOpen && !execution && !isBusy
    ? <button type="button" onClick={() => setAdminDemoOpen(true)} className="select-none text-left">{modalTitleText}</button>
    : modalTitleText;
  const busyHeaderActions = isBusy ? (
    <div className="flex items-center gap-1">
      {(onMinimize || (adminDemoOpen && adminDemoStage === 'running')) && <button type="button" onClick={adminDemoOpen && adminDemoStage === 'running' ? () => setAdminDemoMinimized(true) : onMinimize} className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Minimize generation"><Minus className="h-5 w-5" /></button>}
      {/* Assembly is a paid provider call that is already in flight: it cannot be cancelled without leaving the run half-finished. */}
      {!isAssembling && <button type="button" onClick={() => setShowCancelConfirmation(true)} className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-red-300" aria-label="Cancel generation"><X className="h-5 w-5" /></button>}
    </div>
  ) : undefined;

  const hasFinalVideo = Boolean(execution?.finalVideo?.url);
  const expectsFinalVideo = hasFinalVideo || isAssembling;

  return (
    <>
      <Modal
      isOpen={isOpen && !adminDemoMinimized}
      onClose={() => {
        resetAdminDemo(true);
        onClose();
      }}
      title={modalTitle}
      size={mode === 'view' ? 'xl' : 'md'}
      footer={footer}
      headerActions={busyHeaderActions}
      className={mode === 'view' ? 'max-w-5xl' : 'max-w-xl'}
      dismissible={!isBusy}
    >
      {loading ? (
        <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading published template...
        </div>
      ) : error && execution?.status !== 'failed' ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</div>
      ) : detail && adminDemoOpen && mode === 'use' ? (
        <AdminQuickUseDemo
          assetType={adminDemoAssetType}
          detail={detail}
          files={adminDemoFiles}
          stage={adminDemoStage}
          step={adminDemoStep}
          urls={adminDemoUrls}
          onAssetTypeChange={(assetType) => {
            setAdminDemoAssetType(assetType);
            setAdminDemoFiles([]);
            cachedAdminDemos.set(detail.id, { assetType, files: [] });
          }}
          onClose={() => {
            if (adminDemoStage === 'upload') setAdminDemoOpen(false);
            else resetAdminDemo(true);
          }}
          onFilesChange={(files) => {
            setAdminDemoFiles(files);
            cachedAdminDemos.set(detail.id, { assetType: adminDemoAssetType, files });
          }}
          onResultClose={() => {
            resetAdminDemo(true);
            onClose();
          }}
        />
      ) : detail && mode === 'view' ? (
        <div className="mx-auto max-w-4xl">
          <ResultMedia result={detail.finalResult} />
          <div className="px-1 pt-5">
            <h2 className="text-2xl font-bold text-slate-950 dark:text-white">{detail.name}</h2>
            {detail.description && <p className="mt-2 text-sm leading-6 text-slate-500">{detail.description}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-4">
              <Button variant="gradient" onClick={onUse} disabled={!definition?.blocks.length}>Use this template</Button>
            </div>
          </div>
        </div>
      ) : detail && execution?.status === 'completed' && execution.result ? (
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><Check className="h-6 w-6" /></div>
          <h2 className="text-2xl font-bold text-slate-950 dark:text-white">
            {hasFinalVideo ? 'Your video is ready' : `Your ${execution.result.type} is ready`}
          </h2>
          {hasFinalVideo && (
            <p className="mt-2 text-sm text-slate-500">
              {execution.finalVideo!.stepIds.length} shots joined in order
              {typeof execution.finalVideo!.durationSeconds === 'number'
                ? ` · ${Math.round(execution.finalVideo!.durationSeconds)}s`
                : ''}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-300">
            {detail.steps.map((step) => <span key={step.id} className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{step.featureName}</span>)}
            <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Done</span>
          </div>
          {execution.finalVideoError && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs leading-5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              This template joins its shots into one video, but that step did not finish:
              {' '}{execution.finalVideoError} Your individual shots are below and were not lost.
            </div>
          )}
          <div className="mt-6"><ExecutionResultMedia result={execution.result} poster={execution.finalVideo?.thumbnailUrl || undefined} /></div>
          <StepResultsStrip
            stepResults={execution.stepResults || []}
            finalVideoStepIds={execution.finalVideo?.stepIds || []}
            highlightFinal={hasFinalVideo}
          />
          <div className="mt-5 flex gap-3 border-t border-slate-100 pt-5 dark:border-white/5">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
            <Button variant="gradient" className="flex-1" onClick={() => void downloadGeneratedResult(execution.result!)}><Download className="mr-2 h-4 w-4" />Download</Button>
          </div>
        </div>
      ) : detail && isExecuting ? (
        <div className="mx-auto max-w-3xl">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-purple-600">Generating with {detail.name}</div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">
              {isAssembling ? 'Putting your video together' : 'Your workflow is running'}
            </h2>
          </div>
          <ExecutionPipeline detail={detail} execution={execution!} expectsFinalVideo={expectsFinalVideo} />
          <p className="mt-8 text-center text-base font-medium text-slate-600 animate-pulse dark:text-slate-300">
            {isAssembling
              ? 'Joining your shots into one video...'
              : execution?.status === 'preparing'
                ? 'Preparing your workflow...'
                : `Running ${execution?.stepTitle || 'the current step'}...`}
          </p>
        </div>
      ) : detail && execution?.status === 'cancelled' ? (
        <CancelledExecution detail={detail} execution={execution} onBack={onReset} />
      ) : detail && execution?.status === 'failed' ? (
        <div className="mx-auto max-w-3xl">
          <ExecutionPipeline detail={detail} execution={execution} expectsFinalVideo={expectsFinalVideo} />
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-500/20 dark:bg-red-500/10">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <div><div className="font-semibold text-red-800 dark:text-red-200">Generation stopped</div><p className="mt-1 text-sm leading-6 text-red-700 dark:text-red-300">{execution.error || error || 'The provider could not complete this step.'}</p></div>
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            {onReset && <Button variant="secondary" className="flex-1" onClick={onReset}>Edit inputs</Button>}
            <Button variant="gradient" className="flex-1" onClick={handleGenerate}>Retry</Button>
          </div>
        </div>
      ) : detail && definition ? (
        <div className="mx-auto max-w-2xl">
          {definition.subtitle && <p className="mb-6 text-sm text-slate-500">{definition.subtitle}</p>}
          <div className="space-y-3">
            {[...definition.blocks]
              .sort((left, right) => Number(right.primary) - Number(left.primary) || left.order - right.order)
              .map((block) => (
                <React.Fragment key={block.candidateId}>
                  <QuickUseInput
                    block={block}
                    candidate={candidateById.get(block.candidateId)}
                    exampleUrl={block.example?.kind === 'media' ? detail.quickUseExampleUrls[block.example.assetKey] : undefined}
                    value={values[block.candidateId]}
                    onChange={(value) => {
                      setValues((current) => ({ ...current, [block.candidateId]: value }));
                      setValidationError(null);
                    }}
                  />
                </React.Fragment>
              ))}
          </div>
          {validationError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{validationError}</div>}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          {detail?.quickUseUnavailableReason || 'This published workflow has no Quick Use definition.'}
        </div>
      )}
      </Modal>
      {showCancelConfirmation && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="cancel-generation-title">
          <div className="w-full max-w-md rounded-2xl border border-white/30 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <h2 id="cancel-generation-title" className="text-xl font-bold text-slate-950 dark:text-white">Cancel generation?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Steps that have already started will still use credits. Steps that have not started will not be charged and will not run.</p>
            <div className="mt-6 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setShowCancelConfirmation(false)}>Keep generating</Button>
              <Button variant="danger" className="flex-1" onClick={confirmCancellation}>Cancel generation</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {adminDemoMinimized && typeof document !== 'undefined' && createPortal(
        <button type="button" onClick={() => setAdminDemoMinimized(false)} className="fixed bottom-5 right-5 z-[90] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-white/50 bg-white/95 p-4 text-left shadow-2xl backdrop-blur-xl transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-slate-900/95">
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-sm font-bold text-slate-950 dark:text-white">{adminDemoStage === 'result' ? 'Your result is ready' : 'Generating...'}</div><div className="mt-1 text-xs text-slate-500">{adminDemoStage === 'result' ? 'View Result' : detail?.steps[Math.max(0, adminDemoStep - 1)]?.featureName || 'Preparing workflow'}</div></div>
            {adminDemoStage === 'result' ? <Check className="h-5 w-5 text-emerald-500" /> : <Loader2 className="h-5 w-5 animate-spin text-purple-500" />}
          </div>
        </button>,
        document.body,
      )}
    </>
  );
};

/**
 * Every step result stays visible next to the deliverable. Creators review
 * shot by shot, and a later Remix needs the individual clips, so the merged
 * video is presented as an addition rather than a replacement.
 */
const StepResultsStrip = ({
  finalVideoStepIds,
  highlightFinal,
  stepResults,
}: {
  finalVideoStepIds: string[];
  highlightFinal: boolean;
  stepResults: QuickUseStepOutcome[];
}) => {
  if (stepResults.length < 2) return null;
  const included = new Set(finalVideoStepIds);
  const reusedCount = stepResults.filter((step) => step.executionMode === 'reused_template_result').length;
  return (
    <div className="mt-6 border-t border-slate-100 pt-5 text-left dark:border-white/5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Step results</h3>
        {reusedCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <Sparkles className="h-3 w-3" />
            {reusedCount} reused from the template · no credits
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {[...stepResults].sort((left, right) => left.order - right.order).map((step) => (
          <a
            key={step.stepId}
            href={step.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`group relative h-20 w-20 overflow-hidden rounded-xl border ${
              highlightFinal && included.has(step.stepId)
                ? 'border-purple-400 ring-2 ring-purple-100 dark:ring-purple-500/15'
                : 'border-slate-200 dark:border-slate-700'
            }`}
            title={`${step.order}. ${step.stepTitle}`}
          >
            {step.type === 'video'
              ? <video src={step.url} className="h-full w-full bg-slate-950 object-cover" muted playsInline preload="metadata" />
              : <img src={step.url} alt={step.stepTitle} className="h-full w-full bg-slate-100 object-cover dark:bg-slate-950" />}
            <span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1.5 text-[10px] font-semibold text-white">{step.order}</span>
            {highlightFinal && included.has(step.stepId) && (
              <span className="absolute bottom-1 right-1 rounded bg-purple-600/90 p-0.5 text-white"><Film className="h-3 w-3" /></span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
};

const AdminQuickUseDemo = ({
  assetType,
  detail,
  files,
  onAssetTypeChange,
  onClose,
  onFilesChange,
  onResultClose,
  stage,
  step,
  urls,
}: {
  assetType: AdminDemoAssetType;
  detail: RealTemplateDetail;
  files: File[];
  onAssetTypeChange: (assetType: AdminDemoAssetType) => void;
  onClose: () => void;
  onFilesChange: (files: File[]) => void;
  onResultClose: () => void;
  stage: AdminDemoStage;
  step: number;
  urls: string[];
}) => {
  if (stage === 'running') {
    const progress: QuickUseExecutionProgress = {
      runId: 'admin-demo',
      status: 'running',
      currentStep: step,
      totalSteps: detail.steps.length,
      stepTitle: detail.steps[Math.max(0, step - 1)]?.featureName,
    };
    return (
      <div className="mx-auto max-w-3xl py-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-purple-600">Generating with {detail.name}</div>
        <h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">Your workflow is running</h2>
        <ExecutionPipeline detail={detail} execution={progress} />
        <p className="mt-8 text-center text-base font-medium text-slate-600 animate-pulse dark:text-slate-300">Running {progress.stepTitle || 'the current step'}...</p>
      </div>
    );
  }

  if (stage === 'cancelled') {
    const progress: QuickUseExecutionProgress = {
      runId: 'admin-demo',
      status: 'cancelled',
      currentStep: step,
      totalSteps: detail.steps.length,
    };
    return <CancelledExecution detail={detail} execution={progress} onBack={onClose} />;
  }

  if (stage === 'result') {
    const resultLabel = assetType === 'video' ? 'video' : assetType === 'image_group' ? 'results' : 'image';
    const downloadResults = () => {
      urls.forEach((url, index) => {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = files[index]?.name || `lazora-template-result-${index + 1}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      });
    };
    return (
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><Check className="h-6 w-6" /></div>
        <h2 className="text-2xl font-bold text-slate-950 dark:text-white">Your {resultLabel} {assetType === 'image_group' ? 'are' : 'is'} ready</h2>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-300">
          {detail.steps.map((workflowStep) => <span key={workflowStep.id} className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{workflowStep.featureName}</span>)}
          <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Done</span>
        </div>
        <div className={`mt-6 ${assetType === 'image_group' ? 'grid grid-cols-2 gap-3' : ''}`}>
          {urls.map((url, index) => assetType === 'video'
            ? <video key={url} src={url} className="max-h-[60vh] w-full rounded-2xl bg-black object-contain" controls autoPlay playsInline />
            : <img key={url} src={url} alt={`Generated result ${index + 1}`} className="max-h-[60vh] w-full rounded-2xl bg-slate-100 object-contain dark:bg-slate-950" />)}
        </div>
        <div className="mt-5 flex gap-3 border-t border-slate-100 pt-5 dark:border-white/5">
          <Button variant="secondary" className="flex-1" onClick={onResultClose}>Close</Button>
          <Button variant="gradient" className="flex-1" onClick={downloadResults}><Download className="mr-2 h-4 w-4" />Download</Button>
        </div>
      </div>
    );
  }

  const options: Array<{ type: AdminDemoAssetType; label: string; icon: typeof ImageIcon }> = [
    { type: 'image', label: 'Image', icon: ImageIcon },
    { type: 'image_group', label: 'Image group', icon: Images },
    { type: 'video', label: 'Video', icon: Video },
  ];
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 rounded-xl border border-dashed border-purple-200 bg-purple-50/50 p-4 text-sm text-purple-800 dark:border-purple-500/25 dark:bg-purple-500/5 dark:text-purple-200">
        Admin demo only. Choose the final result here, return to Quick Use, fill in the normal form, then press Generate. No generation API or credits will be used.
      </div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => <button key={option.type} type="button" onClick={() => onAssetTypeChange(option.type)} className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-xs font-semibold transition ${assetType === option.type ? 'border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-200' : 'border-slate-200 text-slate-500 hover:border-purple-300 dark:border-slate-700'}`}><option.icon className="h-5 w-5" />{option.label}</button>)}
      </div>
      <label className="mt-4 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 text-center transition hover:border-purple-400 dark:border-slate-700 dark:bg-slate-950">
        <Upload className="h-7 w-7 text-purple-500" />
        <span className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Upload {assetType === 'image_group' ? 'images' : assetType}</span>
        <span className="mt-1 text-xs text-slate-400">{files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} selected` : 'Click to choose from this device'}</span>
        <input type="file" className="hidden" accept={assetType === 'video' ? 'video/*' : 'image/*'} multiple={assetType === 'image_group'} onChange={(event) => { onFilesChange(Array.from(event.target.files || [])); event.target.value = ''; }} />
      </label>
      {urls.length > 0 && (
        <div className={`mt-4 ${assetType === 'image_group' ? 'grid grid-cols-3 gap-2' : ''}`}>
          {urls.map((url, index) => assetType === 'video'
            ? <video key={url} src={url} className="max-h-56 w-full rounded-xl bg-black object-contain" muted controls playsInline />
            : <img key={url} src={url} alt={`Selected demo ${index + 1}`} className="max-h-48 w-full rounded-xl bg-slate-100 object-contain dark:bg-slate-950" />)}
        </div>
      )}
      <div className="mt-5 flex gap-3">
        <Button variant="gradient" className="w-full" onClick={onClose}>{files.length > 0 ? 'Back to Quick Use' : 'Back'}</Button>
      </div>
    </div>
  );
};

const CancelledExecution = ({
  detail,
  execution,
  onBack,
}: {
  detail: RealTemplateDetail;
  execution: QuickUseExecutionProgress;
  onBack?: () => void;
}) => (
  <div className="mx-auto max-w-3xl">
    <ExecutionPipeline detail={detail} execution={execution} />
    <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/20 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div><div className="font-semibold text-amber-900 dark:text-amber-100">Generation cancelled</div><p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-200">The active step may still use credits. No later workflow steps will start.</p></div>
      </div>
    </div>
    {onBack && <Button variant="secondary" className="mt-5 w-full" onClick={onBack}>Back to inputs</Button>}
  </div>
);

const ExecutionPipeline = ({
  detail,
  execution,
  expectsFinalVideo = false,
}: {
  detail: RealTemplateDetail;
  execution: QuickUseExecutionProgress;
  expectsFinalVideo?: boolean;
}) => {
  const nodes = [
    ...detail.steps.map((step, index) => ({ id: step.id, label: step.featureName, stepNumber: index + 1 })),
    {
      id: 'done',
      label: expectsFinalVideo ? 'Final video' : 'Done',
      stepNumber: detail.steps.length + 1,
    },
  ];
  const stateForNode = (stepNumber: number): 'completed' | 'active' | 'failed' | 'cancelled' | 'pending' => {
    if (stepNumber === nodes.length) {
      if (execution.status === 'completed') return 'completed';
      if (execution.status === 'assembling') return 'active';
      return 'pending';
    }
    // Assembly only starts after every step finished, so all step nodes read
    // as completed while the merge runs.
    if (execution.status === 'completed' || execution.status === 'assembling') return 'completed';
    if (stepNumber < execution.currentStep) return 'completed';
    if (execution.status === 'failed' && stepNumber === Math.max(1, execution.currentStep)) return 'failed';
    if (execution.status === 'cancelled' && stepNumber === Math.max(1, execution.currentStep)) return 'cancelled';
    if ((execution.status === 'preparing' && stepNumber === 1) || (execution.status === 'running' && stepNumber === execution.currentStep)) return 'active';
    return 'pending';
  };

  return (
    <div className="mt-10 flex items-start overflow-x-auto px-1 pb-2">
      {nodes.map((node, index) => {
        const state = stateForNode(node.stepNumber);
        const previousState = index > 0 ? stateForNode(nodes[index - 1].stepNumber) : 'pending';
        return (
          <React.Fragment key={node.id}>
            {index > 0 && (
              <div className={`mt-6 h-0.5 min-w-8 flex-1 transition-colors duration-700 ${previousState === 'completed' ? 'bg-purple-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
            )}
            <div className="min-w-24 text-center sm:min-w-28">
              <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white transition-all duration-300 dark:bg-slate-900 ${
                state === 'completed'
                  ? 'border-purple-500 text-purple-600'
                  : state === 'active'
                    ? 'border-purple-500 text-purple-600 shadow-[0_0_18px_rgba(168,85,247,0.35)]'
                    : state === 'failed'
                      ? 'border-red-500 bg-red-50 text-red-600 dark:bg-red-500/10'
                      : state === 'cancelled'
                        ? 'border-amber-500 bg-amber-50 text-amber-600 dark:bg-amber-500/10'
                      : 'border-slate-300 text-slate-300 dark:border-slate-700 dark:text-slate-600'
              }`}>
                {state === 'completed' ? <Check className="h-5 w-5" /> : state === 'active' ? <Loader2 className="h-5 w-5 animate-spin" /> : state === 'failed' ? <AlertCircle className="h-5 w-5" /> : state === 'cancelled' ? <X className="h-5 w-5" /> : <span className="h-3.5 w-3.5 rounded-full bg-current" />}
              </div>
              <div className={`mt-3 text-xs font-semibold ${state === 'active' ? 'text-purple-600 dark:text-purple-300' : state === 'failed' ? 'text-red-500' : state === 'cancelled' ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>{node.label}</div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const QuickUseInput = ({
  block,
  candidate,
  exampleUrl,
  onChange,
  value,
}: {
  block: QuickUseBlockDefinition;
  candidate?: QuickUsePresentationCandidate;
  exampleUrl?: string;
  onChange: (value: QuickUseInputValue) => void;
  value: QuickUseInputValue;
}) => {
  const [showExample, setShowExample] = useState(false);
  const [exampleExpanded, setExampleExpanded] = useState(false);
  const defaultValue = block.defaultValue ?? (block.control === 'toggle' ? false : null);
  const isCustom = value instanceof File || value !== defaultValue;
  const content = (
    <div className="space-y-3">
      {block.subtitle && <div className="text-xs text-slate-500">{block.subtitle}</div>}
      <QuickUseControl block={block} candidate={candidate} value={value} onChange={onChange} />
      <div className="flex items-center justify-between gap-3">
        {block.example?.kind === 'media' && exampleUrl ? (
          <button type="button" onClick={() => setShowExample((visible) => !visible)} className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 dark:text-purple-300"><Eye className="h-3.5 w-3.5" />{showExample ? 'Hide example' : 'View example'}</button>
        ) : <span />}
        {isCustom && <button type="button" onClick={() => onChange(defaultValue)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-purple-600"><RotateCcw className="h-3.5 w-3.5" />Reset</button>}
      </div>
      {showExample && block.example?.kind === 'media' && exampleUrl && <ExampleMedia assetType={block.example.assetType} url={exampleUrl} onExpand={() => setExampleExpanded(true)} />}
    </div>
  );
  const lightbox = exampleExpanded && block.example?.kind === 'media' && exampleUrl && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Example preview">
          <button type="button" onClick={() => setExampleExpanded(false)} className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20" aria-label="Close example preview"><X className="h-6 w-6" /></button>
          <div className="flex max-h-[90vh] w-full max-w-6xl items-center justify-center"><ExpandedExampleMedia assetType={block.example.assetType} url={exampleUrl} /></div>
        </div>,
        document.body,
      )
    : null;
  if (block.primary) {
    return (
      <>
        <div className="rounded-2xl border border-purple-300 bg-purple-50/40 p-4 dark:border-purple-500/30 dark:bg-purple-500/5">
          <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{block.title}{block.required && <span className="ml-1 text-red-500">*</span>}</div>
          {content}
        </div>
        {lightbox}
      </>
    );
  }
  return (
    <>
      <details defaultOpen={block.openByDefault} className="group rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-200">
          <span className="px-4 py-3.5">{block.title}{block.required && <span className="ml-1 text-red-500">*</span>}</span>
          <span className="flex items-center gap-2 px-4 py-3.5"><span className={`text-xs font-normal ${isCustom ? 'text-purple-600 dark:text-purple-300' : 'text-slate-400'}`}>{isCustom ? 'Custom' : 'Default'}</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></span>
        </summary>
        <div className="border-t border-slate-100 p-4 dark:border-white/5">{content}</div>
      </details>
      {lightbox}
    </>
  );
};

const QuickUseControl = ({ block, candidate, onChange, value }: { block: QuickUseBlockDefinition; candidate?: QuickUsePresentationCandidate; onChange: (value: QuickUseInputValue) => void; value: QuickUseInputValue }) => {
  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-purple-500/10';
  const placeholder = block.placeholder || (block.example?.kind === 'text' ? block.example.value : undefined);
  const uploadedFile = value instanceof File ? value : null;
  const previewUrl = useMemo(() => uploadedFile ? URL.createObjectURL(uploadedFile) : null, [uploadedFile]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  if (block.control === 'image_upload' || block.control === 'video_upload' || block.control === 'audio_upload') {
    const assetType = candidate?.assetType || block.control.split('_')[0];
    return (
      <label
        className={`group/upload relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-white text-center hover:border-purple-400 dark:border-slate-700 dark:bg-slate-900 ${block.primary ? 'min-h-52' : 'min-h-28'}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); onChange(event.dataTransfer.files?.[0] || null); }}
      >
        {uploadedFile && previewUrl ? (
          <>
            {assetType === 'image' ? <img src={previewUrl} alt="Uploaded preview" className="absolute inset-0 h-full w-full object-contain bg-slate-100 dark:bg-slate-950" /> : null}
            {assetType === 'video' ? <video src={previewUrl} className="absolute inset-0 h-full w-full object-contain bg-slate-950" muted playsInline /> : null}
            {assetType === 'audio' ? <audio src={previewUrl} className="mx-5 w-[calc(100%-2.5rem)]" controls onClick={(event) => event.preventDefault()} /> : null}
            <div className={`absolute inset-0 flex items-center justify-center bg-slate-950/0 transition group-hover/upload:bg-slate-950/35 ${assetType === 'audio' ? 'pointer-events-none' : ''}`}>
              <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 opacity-0 shadow transition group-hover/upload:opacity-100">Replace {assetType}</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 truncate bg-slate-950/65 px-3 py-2 text-xs font-medium text-white">{uploadedFile.name}</div>
          </>
        ) : (
          <div className="flex flex-col items-center px-4 py-6">
            <Upload className="h-6 w-6 text-purple-500" />
            <span className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">Drag & drop or click to upload</span>
            <span className="mt-1 text-xs text-slate-400">Upload {assetType}</span>
          </div>
        )}
        <input type="file" className="hidden" accept={candidate?.acceptedMimeTypes?.join(',') || `${candidate?.assetType || 'image'}/*`} onChange={(event) => onChange(event.target.files?.[0] || null)} />
      </label>
    );
  }
  if (block.control === 'toggle') return <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700"><span>{block.placeholder || 'Enabled'}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-purple-600" /></label>;
  if (block.control === 'select') return <select className={inputClass} value={String(value ?? '')} onChange={(event) => { const option = candidate?.enumValues?.find((item) => String(item) === event.target.value); onChange(option ?? event.target.value); }}>{candidate?.enumValues?.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select>;
  if (block.control === 'number' && typeof candidate?.min === 'number' && typeof candidate.max === 'number') return <QuickUseNumberControl label={block.title || candidate.label} min={candidate.min} max={candidate.max} step={candidate.step} value={typeof value === 'number' ? value : null} onChange={onChange} />;
  if (block.control === 'number') return <input type="number" className={inputClass} value={typeof value === 'number' ? value : ''} step={candidate?.step} placeholder={placeholder} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} />;
  if (block.control === 'dialogue') return <DialogueEditor value={typeof value === 'string' ? value : ''} definition={candidate?.dialogue} placeholder={placeholder} onChange={onChange} />;
  if (block.control === 'textarea') return <textarea className={`${inputClass} min-h-24 resize-y`} maxLength={candidate?.maxLength} value={typeof value === 'string' ? value : ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
  return <input className={inputClass} maxLength={candidate?.maxLength} value={typeof value === 'string' ? value : ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
};

const ResultMedia = ({ result }: { result: RealTemplateDetail['finalResult'] }) => (
  <div className="flex min-h-80 max-h-[65vh] items-center justify-center overflow-hidden rounded-2xl bg-slate-950">
    {result.type === 'video' ? <video src={result.url} poster={result.thumbnail} className="max-h-[65vh] w-full object-contain" autoPlay muted controls playsInline /> : <img src={result.thumbnail || result.url} alt="Template result" className="max-h-[65vh] w-full object-contain" />}
  </div>
);

const ExampleMedia = ({ assetType, onExpand, url }: { assetType: 'image' | 'video' | 'audio'; onExpand: () => void; url: string }) => {
  if (assetType === 'video') return <div className="relative"><video src={url} className="max-h-72 w-full rounded-lg bg-slate-950 object-contain" controls playsInline /><button type="button" onClick={onExpand} className="absolute right-2 top-2 rounded-lg bg-slate-950/70 px-2.5 py-1.5 text-xs font-semibold text-white">Expand</button></div>;
  if (assetType === 'audio') return <audio src={url} className="w-full" controls />;
  return <button type="button" onClick={onExpand} className="block w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-950"><img src={url} alt="Input example" className="max-h-72 w-full object-contain" /></button>;
};

const ExpandedExampleMedia = ({ assetType, url }: { assetType: 'image' | 'video' | 'audio'; url: string }) => {
  if (assetType === 'video') return <video src={url} className="max-h-[85vh] w-full bg-black object-contain" controls autoPlay playsInline />;
  if (assetType === 'audio') return <audio src={url} className="w-full" controls autoPlay />;
  return <img src={url} alt="Example preview" className="max-h-[85vh] w-full object-contain" />;
};

const ExecutionResultMedia = ({ poster, result }: { poster?: string; result: { type: 'image' | 'video'; url: string } }) => (
  <div className="flex min-h-80 items-center justify-center overflow-hidden rounded-2xl bg-slate-950">
    {result.type === 'video'
      ? <video src={result.url} poster={poster} className="max-h-[65vh] w-full object-contain" controls playsInline />
      : <img src={result.url} alt="Generated result" className="max-h-[65vh] w-full object-contain" />}
  </div>
);
