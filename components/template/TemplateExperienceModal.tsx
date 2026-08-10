import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, Play, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { RealTemplateDetail } from '../../utils/templateDetailApi';
import type { JsonPrimitive } from '../../workflows/types';
import type {
  QuickUseBlockDefinition,
  QuickUsePresentationCandidate,
  QuickUsePresentationDefinition,
} from '../../workflows/quickUseTypes';

export type QuickUseInputValue = JsonPrimitive | File | null;
export type QuickUseInputValues = Record<string, QuickUseInputValue>;

interface TemplateExperienceModalProps {
  isOpen: boolean;
  mode: 'view' | 'use';
  detail: RealTemplateDetail | null;
  loading: boolean;
  error: string | null;
  generationAvailable: boolean;
  onClose: () => void;
  onUse: () => void;
  onGenerate?: (values: QuickUseInputValues) => void;
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
  generationAvailable,
  isOpen,
  loading,
  mode,
  onClose,
  onGenerate,
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
    onGenerate(values);
  };

  const footer = detail && !loading && !error
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
              disabled={!generationAvailable || !definition?.blocks.length}
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
      size="xl"
      footer={footer}
      className="max-w-5xl"
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
  const content = (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{block.title}{block.required && <span className="ml-1 text-red-500">*</span>}</div>
        {block.subtitle && <div className="mt-1 text-xs text-slate-500">{block.subtitle}</div>}
      </div>
      <QuickUseControl block={block} candidate={candidate} value={value} onChange={onChange} />
      {block.example?.kind === 'text' && block.example.value && <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-950">Example: {block.example.value}</div>}
      {block.example?.kind === 'media' && exampleUrl && <ExampleMedia assetType={block.example.assetType} url={exampleUrl} />}
    </div>
  );
  if (block.primary || block.openByDefault) {
    return <div className={`rounded-2xl border p-4 ${block.primary ? 'border-purple-300 bg-purple-50/40 dark:border-purple-500/30 dark:bg-purple-500/5' : 'border-slate-200 dark:border-slate-700'}`}>{content}</div>;
  }
  return (
    <details className="group rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-200">
        <span>{block.title} <span className="font-normal text-slate-400">· Default</span></span>
        <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
      </summary>
      <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">{content}</div>
    </details>
  );
};

const QuickUseControl = ({ block, candidate, onChange, value }: { block: QuickUseBlockDefinition; candidate?: QuickUsePresentationCandidate; onChange: (value: QuickUseInputValue) => void; value: QuickUseInputValue }) => {
  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-purple-500/10';
  if (block.control === 'image_upload' || block.control === 'video_upload' || block.control === 'audio_upload') {
    return (
      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white px-4 text-center hover:border-purple-300 dark:border-slate-700 dark:bg-slate-900">
        <Upload className="h-5 w-5 text-purple-500" /><span className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">{value instanceof File ? value.name : `Upload ${candidate?.assetType || block.control.split('_')[0]}`}</span>
        <input type="file" className="hidden" accept={candidate?.acceptedMimeTypes?.join(',') || `${candidate?.assetType || 'image'}/*`} onChange={(event) => onChange(event.target.files?.[0] || null)} />
      </label>
    );
  }
  if (block.control === 'toggle') return <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700"><span>{block.placeholder || 'Enabled'}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-purple-600" /></label>;
  if (block.control === 'select') return <select className={inputClass} value={String(value ?? '')} onChange={(event) => { const option = candidate?.enumValues?.find((item) => String(item) === event.target.value); onChange(option ?? event.target.value); }}>{candidate?.enumValues?.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select>;
  if (block.control === 'number') return <input type="number" className={inputClass} value={typeof value === 'number' ? value : ''} min={candidate?.min} max={candidate?.max} step={candidate?.step} placeholder={block.placeholder} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} />;
  if (block.control === 'textarea' || block.control === 'dialogue') return <textarea className={`${inputClass} min-h-24 resize-y`} maxLength={candidate?.maxLength} value={typeof value === 'string' ? value : ''} placeholder={block.placeholder} onChange={(event) => onChange(event.target.value)} />;
  return <input className={inputClass} maxLength={candidate?.maxLength} value={typeof value === 'string' ? value : ''} placeholder={block.placeholder} onChange={(event) => onChange(event.target.value)} />;
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
