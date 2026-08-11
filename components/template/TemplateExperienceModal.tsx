import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Download, Eye, Loader2, Minus, RotateCcw, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { RealTemplateDetail } from '../../utils/templateDetailApi';
import type { JsonPrimitive } from '../../workflows/types';
import type {
  QuickUseBlockDefinition,
  QuickUsePresentationCandidate,
  QuickUsePresentationDefinition,
} from '../../workflows/quickUseTypes';
import type { QuickUseExecutionProgress } from '../../utils/quickUseExecutor';
import { DialogueEditor } from './DialogueEditor';
import { QuickUseNumberControl } from './QuickUseNumberControl';

export type QuickUseInputValue = JsonPrimitive | File | null;
export type QuickUseInputValues = Record<string, QuickUseInputValue>;

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
  onGenerate?: (values: QuickUseInputValues) => void | Promise<void>;
  onMinimize?: () => void;
  onReset?: () => void;
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
  isOpen,
  loading,
  mode,
  onClose,
  onGenerate,
  onMinimize,
  onReset,
  onUse,
}: TemplateExperienceModalProps) => {
  const [values, setValues] = useState<QuickUseInputValues>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  const definition = detail?.quickUseDefinition || null;
  const candidateById = useMemo(
    () => new Map(definition?.candidates.map((candidate) => [candidate.id, candidate]) || []),
    [definition],
  );

  useEffect(() => {
    if (!definition) {
      setValues({});
      return;
    }
    setValues(Object.fromEntries(definition.blocks.map((block) => [
      block.candidateId,
      block.defaultValue ?? (block.control === 'toggle' ? false : null),
    ])));
    setValidationError(null);
  }, [definition]);

  const handleGenerate = () => {
    if (!definition || !onGenerate) return;
    const issues = validateQuickUseInputValues(definition, values);
    if (issues.length > 0) {
      setValidationError(issues[0]);
      return;
    }
    setValidationError(null);
    void onGenerate(values);
  };

  const isExecuting = execution?.status === 'preparing' || execution?.status === 'running';

  const footer = detail && mode === 'use' && !loading && !error && !isExecuting && !execution
    ? (
          <div className="space-y-2">
            {!generationAvailable && (
              <p className="text-center text-xs text-slate-500">
                Automatic execution will be enabled in the executor integration step.
              </p>
            )}
            <Button
              variant="gradient"
              className="w-full"
              disabled={!generationAvailable || !definition?.blocks.length || isExecuting}
              onClick={handleGenerate}
            >
              Generate
            </Button>
          </div>
      )
    : null;

  const modalTitle = mode === 'view'
    ? 'Template preview'
    : isExecuting
      ? 'Generating...'
      : execution?.status === 'completed'
        ? 'Completed'
        : execution?.status === 'failed'
          ? 'Generation failed'
          : 'Quick Use';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size={mode === 'view' ? 'xl' : 'md'}
      footer={footer}
      className={mode === 'view' ? 'max-w-5xl' : 'max-w-xl'}
      dismissible={!isExecuting}
    >
      {loading ? (
        <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading published template...
        </div>
      ) : error && execution?.status !== 'failed' ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</div>
      ) : detail && mode === 'view' ? (
        <div className="mx-auto max-w-4xl">
          <ResultMedia result={detail.finalResult} />
          <div className="px-1 pt-5">
            <h2 className="text-2xl font-bold text-slate-950 dark:text-white">{detail.name}</h2>
            {detail.description && <p className="mt-2 text-sm leading-6 text-slate-500">{detail.description}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs font-medium text-slate-500">{detail.usageCount} uses</div>
              <Button variant="gradient" onClick={onUse} disabled={!definition?.blocks.length}>Use this template</Button>
            </div>
          </div>
        </div>
      ) : detail && execution?.status === 'completed' && execution.result ? (
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><Check className="h-6 w-6" /></div>
          <h2 className="text-2xl font-bold text-slate-950 dark:text-white">Your {execution.result.type} is ready</h2>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-300">
            {detail.steps.map((step) => <span key={step.id} className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{step.featureName}</span>)}
            <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Done</span>
          </div>
          <div className="mt-6"><ExecutionResultMedia result={execution.result} /></div>
          <div className="mt-5 flex gap-3 border-t border-slate-100 pt-5 dark:border-white/5">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
            <Button variant="gradient" className="flex-1" onClick={() => void downloadGeneratedResult(execution.result!)}><Download className="mr-2 h-4 w-4" />Download</Button>
          </div>
        </div>
      ) : detail && isExecuting ? (
        <div className="mx-auto max-w-3xl">
          <div className="flex items-start justify-between gap-4">
            <div><div className="text-xs font-semibold uppercase tracking-wider text-purple-600">Generating with {detail.name}</div><h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">Your workflow is running</h2></div>
            {onMinimize && <Button variant="secondary" size="sm" onClick={onMinimize}><Minus className="mr-1 h-4 w-4" />Minimize</Button>}
          </div>
          <ExecutionPipeline detail={detail} execution={execution!} />
          <p className="mt-8 text-center text-base font-medium text-slate-600 animate-pulse dark:text-slate-300">
            {execution?.status === 'preparing' ? 'Preparing your workflow...' : `Running ${execution?.stepTitle || 'the current step'}...`}
          </p>
        </div>
      ) : detail && execution?.status === 'failed' ? (
        <div className="mx-auto max-w-3xl">
          <ExecutionPipeline detail={detail} execution={execution} />
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
          <div className="mb-6">
            <div className="text-xs font-semibold uppercase tracking-wider text-purple-600">{detail.name}</div>
            <h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{definition.title}</h2>
            {definition.subtitle && <p className="mt-2 text-sm text-slate-500">{definition.subtitle}</p>}
          </div>
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
  );
};

const ExecutionPipeline = ({
  detail,
  execution,
}: {
  detail: RealTemplateDetail;
  execution: QuickUseExecutionProgress;
}) => {
  const nodes = [
    ...detail.steps.map((step, index) => ({ id: step.id, label: step.featureName, stepNumber: index + 1 })),
    { id: 'done', label: 'Done', stepNumber: detail.steps.length + 1 },
  ];
  const stateForNode = (stepNumber: number): 'completed' | 'active' | 'failed' | 'pending' => {
    if (stepNumber === nodes.length) return execution.status === 'completed' ? 'completed' : 'pending';
    if (execution.status === 'completed' || stepNumber < execution.currentStep) return 'completed';
    if (execution.status === 'failed' && stepNumber === Math.max(1, execution.currentStep)) return 'failed';
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
                      : 'border-slate-300 text-slate-300 dark:border-slate-700 dark:text-slate-600'
              }`}>
                {state === 'completed' ? <Check className="h-5 w-5" /> : state === 'active' ? <Loader2 className="h-5 w-5 animate-spin" /> : state === 'failed' ? <AlertCircle className="h-5 w-5" /> : <span className="h-3.5 w-3.5 rounded-full bg-current" />}
              </div>
              <div className={`mt-3 text-xs font-semibold ${state === 'active' ? 'text-purple-600 dark:text-purple-300' : state === 'failed' ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>{node.label}</div>
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
      {showExample && block.example?.kind === 'media' && exampleUrl && <ExampleMedia assetType={block.example.assetType} url={exampleUrl} />}
    </div>
  );
  if (block.primary) {
    return (
      <div className="rounded-2xl border border-purple-300 bg-purple-50/40 p-4 dark:border-purple-500/30 dark:bg-purple-500/5">
        <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{block.title}{block.required && <span className="ml-1 text-red-500">*</span>}</div>
        {content}
      </div>
    );
  }
  return (
    <details defaultOpen={block.openByDefault} className="group rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-200">
        <span className="px-4 py-3.5">{block.title}{block.required && <span className="ml-1 text-red-500">*</span>}</span>
        <span className="flex items-center gap-2 px-4 py-3.5"><span className={`text-xs font-normal ${isCustom ? 'text-purple-600 dark:text-purple-300' : 'text-slate-400'}`}>{isCustom ? 'Custom' : 'Default'}</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></span>
      </summary>
      <div className="border-t border-slate-100 p-4 dark:border-white/5">{content}</div>
    </details>
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

const ExampleMedia = ({ assetType, url }: { assetType: 'image' | 'video' | 'audio'; url: string }) => {
  if (assetType === 'video') return <video src={url} className="max-h-48 w-full rounded-lg object-cover" controls playsInline />;
  if (assetType === 'audio') return <audio src={url} className="w-full" controls />;
  return <img src={url} alt="Input example" className="max-h-48 w-full rounded-lg object-cover" />;
};

const ExecutionResultMedia = ({ result }: { result: { type: 'image' | 'video'; url: string } }) => (
  <div className="flex min-h-80 items-center justify-center overflow-hidden rounded-2xl bg-slate-950">
    {result.type === 'video'
      ? <video src={result.url} className="max-h-[65vh] w-full object-contain" controls playsInline />
      : <img src={result.url} alt="Generated result" className="max-h-[65vh] w-full object-contain" />}
  </div>
);
