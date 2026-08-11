import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Download, Eye, Loader2, Minus, Play, RotateCcw, Upload } from 'lucide-react';
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

  const gallery = useMemo(() => {
    if (!detail) return [];
    const byUrl = new Map<string, RealTemplateDetail['finalResult']>();
    [detail.finalResult, ...detail.steps.flatMap((step) => step.results)].forEach((result) => {
      if (result.url && !byUrl.has(result.url)) byUrl.set(result.url, result);
    });
    return [...byUrl.values()];
  }, [detail]);

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

  const footer = detail && !loading && !error && !isExecuting && execution?.status !== 'completed'
    ? mode === 'view'
      ? (
          <div className="flex justify-end">
            <Button variant="gradient" onClick={onUse} disabled={!definition?.blocks.length}>
              Use this template
            </Button>
          </div>
        )
      : (
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'view' ? detail?.name || 'Template preview' : 'Quick Use'}
      size={mode === 'view' ? 'xl' : 'md'}
      footer={footer}
      className={mode === 'view' ? 'max-w-5xl' : 'max-w-xl'}
    >
      {loading ? (
        <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading published template...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</div>
      ) : detail && mode === 'view' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
          <ResultMedia result={detail.finalResult} className="min-h-80" />
          <div>
            <h2 className="text-xl font-bold text-slate-950 dark:text-white">{detail.name}</h2>
            {detail.description && <p className="mt-2 text-sm leading-6 text-slate-500">{detail.description}</p>}
            <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
              <span>{detail.creatorName || 'Lazora creator'}</span><span>·</span><span>{detail.usageCount} uses</span>
            </div>
            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Result gallery</h3>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {gallery.map((result) => <React.Fragment key={result.url}><ResultMedia result={result} compact /></React.Fragment>)}
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
          <div className="mt-10 flex items-center overflow-x-auto pb-2">
            {detail.steps.map((step, index) => {
              const completed = index + 1 < (execution?.currentStep || 0);
              const active = index + 1 === (execution?.currentStep || 0);
              return (
                <React.Fragment key={step.id}>
                  {index > 0 && <div className={`h-0.5 min-w-10 flex-1 ${completed || active ? 'bg-purple-500' : 'bg-slate-200 dark:bg-slate-700'}`} />}
                  <div className="min-w-32 text-center">
                    <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 ${completed ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-purple-500 bg-purple-50 text-purple-600 dark:bg-purple-500/10' : 'border-slate-200 text-slate-400 dark:border-slate-700'}`}>
                      {completed ? <Check className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : index + 1}
                    </div>
                    <div className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-200">{step.featureName}</div>
                  </div>
                </React.Fragment>
              );
            })}
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
          This published workflow has no Quick Use definition.
        </div>
      )}
    </Modal>
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
  if (block.control === 'image_upload' || block.control === 'video_upload' || block.control === 'audio_upload') {
    return (
      <label
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white px-4 text-center hover:border-purple-300 dark:border-slate-700 dark:bg-slate-900 ${block.primary ? 'min-h-52' : 'min-h-28'}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); onChange(event.dataTransfer.files?.[0] || null); }}
      >
        <Upload className="h-6 w-6 text-purple-500" /><span className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">{value instanceof File ? value.name : 'Drag & drop or click to upload'}</span>
        <span className="mt-1 text-xs text-slate-400">{value instanceof File ? 'Click to replace' : `Upload ${candidate?.assetType || block.control.split('_')[0]}`}</span>
        <input type="file" className="hidden" accept={candidate?.acceptedMimeTypes?.join(',') || `${candidate?.assetType || 'image'}/*`} onChange={(event) => onChange(event.target.files?.[0] || null)} />
      </label>
    );
  }
  if (block.control === 'toggle') return <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700"><span>{block.placeholder || 'Enabled'}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-purple-600" /></label>;
  if (block.control === 'select') return <select className={inputClass} value={String(value ?? '')} onChange={(event) => { const option = candidate?.enumValues?.find((item) => String(item) === event.target.value); onChange(option ?? event.target.value); }}>{candidate?.enumValues?.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select>;
  if (block.control === 'number') return <input type="number" className={inputClass} value={typeof value === 'number' ? value : ''} min={candidate?.min} max={candidate?.max} step={candidate?.step} placeholder={placeholder} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} />;
  if (block.control === 'dialogue') return <DialogueEditor value={typeof value === 'string' ? value : ''} definition={candidate?.dialogue} placeholder={placeholder} onChange={onChange} />;
  if (block.control === 'textarea') return <textarea className={`${inputClass} min-h-24 resize-y`} maxLength={candidate?.maxLength} value={typeof value === 'string' ? value : ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
  return <input className={inputClass} maxLength={candidate?.maxLength} value={typeof value === 'string' ? value : ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
};

const ResultMedia = ({ className = '', compact = false, result }: { className?: string; compact?: boolean; result: RealTemplateDetail['finalResult'] }) => (
  <div className={`relative overflow-hidden rounded-xl bg-slate-950 ${compact ? 'aspect-square' : 'flex min-h-72 items-center justify-center'} ${className}`}>
    {result.type === 'video' ? <video src={result.url} poster={result.thumbnail} className="h-full w-full object-contain" controls={!compact} muted={compact} playsInline /> : <img src={result.thumbnail || result.url} alt="Template result" className="h-full w-full object-contain" />}
    {compact && result.type === 'video' && <div className="absolute inset-0 flex items-center justify-center bg-black/20"><Play className="h-5 w-5 fill-white text-white" /></div>}
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
