import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  GripVertical,
  Image as ImageIcon,
  Layout,
  MessageSquare,
  Monitor,
  Music,
  Play,
  Save,
  Send,
  ToggleRight,
  Trash2,
  Type,
  Upload,
  Video,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { DialogueEditor } from '../components/template/DialogueEditor';
import { useStore } from '../context/StoreContext';
import {
  loadTemplateDraft,
  saveTemplateDraft,
  submitTemplateForReview,
  type LoadTemplateDraftResult,
  type TemplateDraftIdentity,
} from '../utils/templateDraftApi';
import { validateTemplateMaterialFile } from '../utils/templateStorage';
import { convertAndValidateBuilderWorkflow } from '../workflows/builderAdapter';
import {
  createQuickUseExampleAssetKey,
  deriveQuickUseCandidates,
} from '../workflows/quickUseCandidates';
import { createEmptyQuickUseDefinition } from '../workflows/quickUseAuthoring';
import {
  addQuickUseBlock,
  reorderQuickUseBlock,
  removeQuickUseBlock,
  updateQuickUseBlock,
} from '../workflows/quickUseBuilderModel';
import type {
  JsonPrimitive,
  WorkflowDefinition,
} from '../workflows/types';
import type {
  QuickUseBlockDefinition,
  QuickUseCandidate,
  QuickUseCandidateId,
  QuickUseDefinition,
  QuickUseExampleDefinition,
} from '../workflows/quickUseTypes';
import { validateQuickUseDefinition } from '../workflows/quickUseValidators';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'submitting' | 'submitted';

const candidateKindLabel: Record<QuickUseCandidate['kind'], string> = {
  material: 'Workflow inputs',
  prompt_variable: 'Prompt variables',
  setting: 'Settings',
};

const inputClassName = 'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-purple-500/15';

const isMediaControl = (control: QuickUseBlockDefinition['control']): boolean =>
  control === 'image_upload' || control === 'video_upload' || control === 'audio_upload';

const mediaAccept = (assetType: 'image' | 'video' | 'audio'): string => `${assetType}/*`;

const candidateSummary = (candidate: QuickUseCandidate): string => {
  if (candidate.kind === 'material') return `${candidate.assetType} upload`;
  if (candidate.kind === 'prompt_variable') return `${candidate.inputKind} · ${candidate.defaultValue}`;
  return `${candidate.parameterType} · Default ${candidate.defaultValue === undefined ? 'None' : String(candidate.defaultValue)}`;
};

const candidateIcon = (candidate: QuickUseCandidate): React.ReactNode => {
  if (candidate.kind === 'material') {
    if (candidate.assetType === 'video') return <Video className="h-4 w-4" />;
    if (candidate.assetType === 'audio') return <Music className="h-4 w-4" />;
    return <ImageIcon className="h-4 w-4" />;
  }
  if (candidate.kind === 'prompt_variable') {
    return candidate.inputKind === 'dialogue'
      ? <MessageSquare className="h-4 w-4" />
      : <Type className="h-4 w-4" />;
  }
  if (candidate.parameterType === 'boolean') return <ToggleRight className="h-4 w-4" />;
  if (/duration/i.test(candidate.label)) return <Clock className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
};

const exampleKindValue = (block: QuickUseBlockDefinition): 'none' | 'text' | 'image' | 'video' | 'audio' => {
  if (!block.example) return 'none';
  return block.example.kind === 'text' ? 'text' : block.example.assetType;
};

export const QuickUseBuilder = () => {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { addToast, authLoading, user } = useStore();
  const [draft, setDraft] = useState<LoadTemplateDraftResult | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [definition, setDefinition] = useState<QuickUseDefinition | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<QuickUseCandidateId | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);
  const [exampleFiles, setExampleFiles] = useState<Record<string, File>>({});
  const [examplePreviewUrls, setExamplePreviewUrls] = useState<Record<string, string>>({});
  const [draggedCandidateId, setDraggedCandidateId] = useState<QuickUseCandidateId | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<QuickUseCandidateId | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<QuickUseCandidateId | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!templateId) {
      setError('Template id is missing.');
      return;
    }
    if (!user?.isAdmin) {
      setError('Administrator access is required for Quick Use Builder.');
      return;
    }
    let cancelled = false;
    setError(null);
    void loadTemplateDraft(templateId, user.id)
      .then((loaded) => {
        if (cancelled) return;
        const conversion = convertAndValidateBuilderWorkflow(loaded.steps);
        if (!conversion.validation.valid) {
          throw new Error(conversion.validation.issues[0]?.message || 'The workflow draft is invalid.');
        }
        const nextDefinition = loaded.quickUseDefinition || createEmptyQuickUseDefinition(
          loaded.title,
          loaded.description,
        );
        setDraft(loaded);
        setWorkflow(conversion.workflow);
        setDefinition(nextDefinition);
        setSelectedCandidateId(nextDefinition.blocks[0]?.candidateId || null);
        setExamplePreviewUrls(loaded.quickUseExampleUrls);
        setSaveState('idle');
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load this template draft.');
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, templateId, user]);

  const derivation = useMemo(
    () => workflow && definition
      ? deriveQuickUseCandidates(workflow, definition)
      : { valid: false, candidates: [], issues: [] },
    [workflow, definition],
  );
  const candidateById = useMemo(
    () => new Map(derivation.candidates.map((candidate) => [candidate.id, candidate])),
    [derivation.candidates],
  );
  const exposedIds = useMemo(
    () => new Set(definition?.blocks.map((block) => block.candidateId) || []),
    [definition?.blocks],
  );
  const selectedBlock = definition?.blocks.find(
    (block) => block.candidateId === selectedCandidateId,
  ) || null;
  const selectedCandidate = selectedCandidateId
    ? candidateById.get(selectedCandidateId) || null
    : null;

  const mutateDefinition = (next: QuickUseDefinition) => {
    setDefinition(next);
    setSaveState('idle');
    setError(null);
  };

  const handleAddCandidate = (candidate: QuickUseCandidate) => {
    if (!definition) return;
    mutateDefinition(addQuickUseBlock(definition, candidate));
    setSelectedCandidateId(candidate.id);
  };

  const handleCandidateDragStart = (
    event: React.DragEvent<HTMLElement>,
    candidate: QuickUseCandidate,
  ) => {
    setDraggedCandidateId(candidate.id);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-lazora-quick-use-candidate', candidate.id);
  };

  const handleCanvasDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const candidateId = (event.dataTransfer.getData('application/x-lazora-quick-use-candidate') || draggedCandidateId) as QuickUseCandidateId;
    const candidate = candidateById.get(candidateId);
    if (candidate && !exposedIds.has(candidate.id)) handleAddCandidate(candidate);
    setDraggedCandidateId(null);
  };

  const handleBlockDrop = (
    event: React.DragEvent<HTMLElement>,
    targetCandidateId: QuickUseCandidateId,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!definition || !draggedBlockId) return;
    mutateDefinition(reorderQuickUseBlock(definition, draggedBlockId, targetCandidateId));
    setDraggedBlockId(null);
    setDragOverBlockId(null);
  };

  const handleRemoveBlock = (candidateId: QuickUseCandidateId) => {
    if (!definition) return;
    const next = removeQuickUseBlock(definition, candidateId);
    mutateDefinition(next);
    setSelectedCandidateId(next.blocks[0]?.candidateId || null);
  };

  const handleUpdateBlock = (updates: Partial<QuickUseBlockDefinition>) => {
    if (!definition || !selectedBlock) return;
    mutateDefinition(updateQuickUseBlock(definition, selectedBlock.candidateId, updates));
  };

  const handleExampleKind = (kind: 'none' | 'text' | 'image' | 'video' | 'audio') => {
    if (!selectedBlock || !selectedCandidate) return;
    if (kind === 'none') {
      handleUpdateBlock({ example: undefined });
      return;
    }
    const example: QuickUseExampleDefinition = kind === 'text'
      ? { kind: 'text', value: selectedBlock.placeholder || '' }
      : {
          kind: 'media',
          assetType: kind,
          assetKey: createQuickUseExampleAssetKey(selectedBlock.candidateId),
        };
    handleUpdateBlock({ example });
  };

  const handleExampleFile = (file?: File) => {
    if (!file || !selectedBlock?.example || selectedBlock.example.kind !== 'media') return;
    try {
      validateTemplateMaterialFile(file, selectedBlock.example.assetType, 'Quick Use example');
    } catch (validationError) {
      addToast('error', validationError instanceof Error ? validationError.message : 'This example file is not supported.');
      return;
    }
    const assetKey = selectedBlock.example.assetKey;
    const currentUrl = examplePreviewUrls[assetKey];
    if (currentUrl?.startsWith('blob:')) URL.revokeObjectURL(currentUrl);
    setExampleFiles((current) => ({ ...current, [assetKey]: file }));
    setExamplePreviewUrls((current) => ({ ...current, [assetKey]: URL.createObjectURL(file) }));
    setSaveState('idle');
  };

  const validateCurrentDefinition = (): boolean => {
    if (!workflow || !definition) return false;
    const validation = validateQuickUseDefinition(workflow, definition);
    if (validation.valid) return true;
    const message = validation.issues[0]?.message || 'The Quick Use definition is invalid.';
    setError(message);
    addToast('error', message);
    return false;
  };

  const handleSaveDraft = async (showToast = true): Promise<TemplateDraftIdentity | null> => {
    if (!draft || !workflow || !definition || !user) return null;
    if (!validateCurrentDefinition()) return null;
    setSaveState('saving');
    setError(null);
    try {
      const saved = await saveTemplateDraft({
        identity: draft.identity,
        userId: user.id,
        title: draft.title,
        description: draft.description,
        workflow,
        steps: draft.steps,
        finalResultUrl: draft.finalResultUrl,
        finalResultType: draft.finalResultType,
        isFinalResultManual: draft.isFinalResultManual,
        finalResultFile: null,
        persistedFinalResult: draft.finalResult,
        persistedFinalResultPoster: draft.finalResultPoster,
        coverFile: null,
        coverVideoStartSeconds: 0,
        persistedCover: draft.cover,
        resultFiles: {},
        persistedResults: draft.results,
        persistedResultPosters: draft.resultPosters,
        materialFiles: {},
        persistedMaterials: draft.materials,
        quickUseDefinition: definition,
        quickUseExampleFiles: exampleFiles,
        persistedQuickUseExamples: draft.quickUseExamples,
      });
      const steps = draft.steps.map((step) => ({
        ...step,
        materials: step.materials.map((material) => ({
          ...material,
          templateAssetId: saved.materialAssetIds[material.id] || material.templateAssetId,
        })),
      }));
      setDraft({
        ...draft,
        identity: saved.identity,
        steps,
        cover: saved.cover,
        finalResult: saved.finalResult,
        finalResultPoster: saved.finalResultPoster,
        results: saved.results,
        resultPosters: saved.resultPosters,
        materials: saved.materials,
        quickUseDefinition: saved.quickUseDefinition,
        quickUseExamples: saved.quickUseExamples,
      });
      setDefinition(saved.quickUseDefinition || definition);
      setExampleFiles({});
      setSaveState('saved');
      if (showToast) addToast('success', 'Quick Use draft saved.');
      return saved.identity;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save Quick Use draft.';
      setError(message);
      setSaveState('failed');
      addToast('error', message);
      return null;
    }
  };

  const handleSubmit = async () => {
    if (!definition?.blocks.length) {
      addToast('error', 'Add at least one Quick Use block before submitting.');
      return;
    }
    const identity = await handleSaveDraft(false);
    if (!identity) return;
    setSaveState('submitting');
    try {
      await submitTemplateForReview(identity);
      setSaveState('submitted');
      addToast('success', 'Template submitted through the existing review workflow.');
      navigate('/admin');
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Could not submit this template.';
      setError(message);
      setSaveState('failed');
      addToast('error', message);
    }
  };

  const handleTest = () => {
    if (!definition?.blocks.length) {
      addToast('error', 'Add at least one block before testing the layout.');
      return;
    }
    if (!validateCurrentDefinition()) return;
    setShowTest(true);
  };

  if (authLoading || (!draft && !error)) {
    return <div className="min-h-screen bg-slate-50 pt-32 text-center text-sm text-slate-500 dark:bg-slate-900">Loading Quick Use Builder...</div>;
  }

  if (!draft || !definition || !workflow) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 pt-32 dark:bg-slate-900">
        <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center dark:border-red-500/20 dark:bg-slate-950">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Quick Use Builder unavailable</h1>
          <p className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>
          <Button className="mt-6" variant="outline" onClick={() => navigate('/admin')}>Back to Admin</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 pt-16 dark:bg-slate-950">
      <header className="sticky top-16 z-40 border-b border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => navigate(`/templates/create?templateId=${draft.identity.templateId}`)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5" aria-label="Back to Workflow Builder"><ArrowLeft className="h-5 w-5" /></button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900 dark:text-white">Quick Use Builder</h1>
              <p className="truncate text-xs text-slate-500">{draft.title || 'Untitled template'} · Version {draft.identity.versionNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-slate-500 sm:inline">{saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Save failed' : 'Draft'}</span>
            <Button variant="outline" size="sm" onClick={handleTest}><Play className="mr-1.5 h-4 w-4" />Test</Button>
            <Button variant="outline" size="sm" isLoading={saveState === 'saving'} onClick={() => void handleSaveDraft()}><Save className="mr-1.5 h-4 w-4" />Save draft</Button>
            <Button variant="gradient" size="sm" isLoading={saveState === 'submitting'} onClick={() => void handleSubmit()}><Send className="mr-1.5 h-4 w-4" />Submit for review</Button>
          </div>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</div>
      )}

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 lg:h-[calc(100vh-8rem)] lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="overflow-y-auto border-b border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900 lg:border-b-0 lg:border-r">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Block library</h2>
          <p className="mt-1 text-xs text-slate-400">Drag workflow candidates into the Quick Use canvas.</p>
          <div className="mt-5 space-y-5">
            {(['material', 'prompt_variable', 'setting'] as const).map((kind) => {
              const candidates = derivation.candidates.filter((candidate) => candidate.kind === kind);
              return (
                <section key={kind}>
                  <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{candidateKindLabel[kind]}</h3>
                  <div className="space-y-2">
                    {candidates.length > 0 ? candidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        draggable={!exposedIds.has(candidate.id)}
                        disabled={exposedIds.has(candidate.id)}
                        onDragStart={(event) => handleCandidateDragStart(event, candidate)}
                        onDragEnd={() => setDraggedCandidateId(null)}
                        onClick={() => handleAddCandidate(candidate)}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-purple-400 hover:text-purple-700 disabled:cursor-default disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-purple-500/50"
                      >
                        <span className="text-slate-500">{candidateIcon(candidate)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{candidate.label}</span>
                          <span className="block truncate text-[11px] text-slate-500">{candidate.stepTitle} · {candidateSummary(candidate)}</span>
                        </span>
                        {exposedIds.has(candidate.id) ? <Check className="h-4 w-4 text-emerald-500" /> : <GripVertical className="h-4 w-4 text-slate-300" />}
                      </button>
                    )) : <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-700">None configured</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </aside>

        <main
          className="min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8"
          onClick={() => setSelectedCandidateId(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleCanvasDrop}
        >
          <div className="mx-auto max-w-md" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-[620px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
              <div className="flex-1 overflow-y-auto p-5 sm:p-6">
              <div className="mb-5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-600">End-user preview</div>
                <h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{definition.title || 'Use this template'}</h2>
                {definition.subtitle && <p className="mt-2 text-sm text-slate-500">{definition.subtitle}</p>}
              </div>
              {definition.blocks.length > 0 ? (
                <div className="space-y-3">
                  {[...definition.blocks]
                    .sort((left, right) => Number(right.primary) - Number(left.primary) || left.order - right.order)
                    .map((block) => {
                    const candidate = candidateById.get(block.candidateId);
                    const selected = block.candidateId === selectedCandidateId;
                    const expanded = block.primary || block.openByDefault;
                    return (
                      <div
                        key={block.candidateId}
                        draggable={!block.primary}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          setDraggedBlockId(block.candidateId);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => { setDraggedBlockId(null); setDragOverBlockId(null); }}
                        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); if (!block.primary) setDragOverBlockId(block.candidateId); }}
                        onDrop={(event) => handleBlockDrop(event, block.candidateId)}
                        onClick={() => setSelectedCandidateId(block.candidateId)}
                        className={`cursor-pointer rounded-2xl border p-4 transition ${selected ? 'border-purple-400 bg-purple-50/50 ring-2 ring-purple-100 dark:border-purple-500/60 dark:bg-purple-500/5 dark:ring-purple-500/10' : 'border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/20'} ${draggedBlockId === block.candidateId ? 'opacity-50' : ''} ${dragOverBlockId === block.candidateId ? 'border-t-2 border-t-purple-500' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div><div className="text-sm font-semibold text-slate-900 dark:text-white">{block.title}{block.required && <span className="ml-1 text-red-500">*</span>}</div>{block.subtitle && <div className="mt-1 text-xs text-slate-500">{block.subtitle}</div>}</div>
                          <div className="flex items-center gap-1">
                            {block.primary && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-500/15 dark:text-purple-200">Primary</span>}
                            {!expanded && <><span className="text-[10px] text-slate-400">Default</span><ChevronDown className="h-4 w-4 text-slate-400" /></>}
                            {!block.primary && <GripVertical className="h-4 w-4 cursor-grab text-slate-300" />}
                          </div>
                        </div>
                        {expanded && <div className="mt-3">{renderControl(block, candidate)}</div>}
                        {expanded && block.example?.kind === 'media' && examplePreviewUrls[block.example.assetKey] && renderExampleMedia(block.example, examplePreviewUrls[block.example.assetKey])}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[440px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 px-6 text-center text-slate-400 dark:border-slate-700"><Layout className="h-8 w-8" /><p className="mt-3 text-sm font-medium">Build your Quick Use form</p><p className="mt-1 text-xs">Drag blocks here from the library</p></div>
              )}
              </div>
              {definition.blocks.length > 0 && (
                <div className="border-t border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-slate-900">
                  <Button variant="gradient" className="pointer-events-none w-full rounded-2xl py-6 text-base">Generate</Button>
                </div>
              )}
            </div>
          </div>
        </main>

        <aside className="overflow-y-auto border-t border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900 lg:border-l lg:border-t-0">
          {selectedBlock && selectedCandidate ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-white/10"><div><h2 className="font-semibold text-slate-900 dark:text-white">Block settings</h2><p className="mt-1 text-[11px] text-slate-500">{selectedCandidate.kind} · {selectedCandidate.stepTitle}</p></div><button type="button" onClick={() => handleRemoveBlock(selectedBlock.candidateId)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button></div>
              <SettingField label="Title"><input className={inputClassName} maxLength={120} value={selectedBlock.title} onChange={(event) => handleUpdateBlock({ title: event.target.value })} /></SettingField>
              <SettingField label="Subtitle / helper text"><textarea className={`${inputClassName} min-h-16 resize-y`} maxLength={300} value={selectedBlock.subtitle || ''} onChange={(event) => handleUpdateBlock({ subtitle: event.target.value || undefined })} /></SettingField>
              {!isMediaControl(selectedBlock.control) && <SettingField label="Placeholder"><input className={inputClassName} maxLength={200} value={selectedBlock.placeholder || ''} onChange={(event) => handleUpdateBlock({ placeholder: event.target.value || undefined })} /></SettingField>}
              {!isMediaControl(selectedBlock.control) && <DefaultValueEditor block={selectedBlock} candidate={selectedCandidate} onChange={(value) => handleUpdateBlock({ defaultValue: value })} />}
              <ToggleSetting label="Primary input" checked={selectedBlock.primary} onChange={(checked) => handleUpdateBlock({ primary: checked, openByDefault: checked ? true : selectedBlock.openByDefault })} />
              <ToggleSetting label="Required" checked={selectedBlock.required} disabled={selectedCandidate.required} onChange={(checked) => handleUpdateBlock({ required: checked })} />
              {!selectedBlock.primary && <ToggleSetting label="Open by default" checked={selectedBlock.openByDefault} onChange={(checked) => handleUpdateBlock({ openByDefault: checked })} />}
              <SettingField label="Example"><select className={inputClassName} value={exampleKindValue(selectedBlock)} onChange={(event) => handleExampleKind(event.target.value as 'none' | 'text' | 'image' | 'video' | 'audio')}><option value="none">None</option><option value="text">Text / placeholder</option><option value="image">Image</option><option value="video">Video</option><option value="audio">Audio</option></select></SettingField>
              {selectedBlock.example?.kind === 'text' && <SettingField label="Placeholder example"><textarea className={`${inputClassName} min-h-20 resize-y`} value={selectedBlock.example.value} placeholder="Enter example text..." onChange={(event) => handleUpdateBlock({ placeholder: event.target.value || undefined, example: { kind: 'text', value: event.target.value } })} /></SettingField>}
              {selectedBlock.example?.kind === 'media' && (
                <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 px-3 py-4 text-xs font-medium text-slate-500 hover:border-purple-300 dark:border-slate-700"><Upload className="h-4 w-4" />Upload {selectedBlock.example.assetType} example<input type="file" className="hidden" accept={mediaAccept(selectedBlock.example.assetType)} onChange={(event) => handleExampleFile(event.target.files?.[0])} /></label>
                  {examplePreviewUrls[selectedBlock.example.assetKey] && renderExampleMedia(selectedBlock.example, examplePreviewUrls[selectedBlock.example.assetKey])}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="border-b border-slate-200 pb-4 dark:border-white/10"><h2 className="font-semibold text-slate-900 dark:text-white">Template settings</h2><p className="mt-1 text-xs text-slate-400">Configure the end-user Quick Use panel.</p></div>
              <SettingField label="Quick Use title"><input className={inputClassName} value={definition.title} maxLength={120} onChange={(event) => mutateDefinition({ ...definition, title: event.target.value })} /></SettingField>
              <SettingField label="Subtitle"><textarea className={`${inputClassName} min-h-24 resize-y`} value={definition.subtitle || ''} maxLength={300} onChange={(event) => mutateDefinition({ ...definition, subtitle: event.target.value || undefined })} /></SettingField>
              <div className="rounded-xl border border-purple-100 bg-purple-50 p-3 text-xs leading-5 text-purple-800 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-200">Only blocks placed on the center canvas are exposed to Template users. Unused candidates keep their Workflow defaults.</div>
            </div>
          )}
        </aside>
      </div>

      <Modal isOpen={showTest} onClose={() => setShowTest(false)} title="Quick Use layout test" className="max-w-2xl">
        <div className="space-y-4"><p className="text-sm text-green-700 dark:text-green-300">Domain validation passed. This test previews inputs only and does not run generation.</p>{definition.blocks.map((block) => <div key={block.candidateId} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="text-sm font-semibold text-slate-900 dark:text-white">{block.title}</div><div className="mt-3">{renderControl(block, candidateById.get(block.candidateId))}</div></div>)}</div>
      </Modal>
    </div>
  );
};

const SettingField = ({ children, label }: { children: React.ReactNode; label: string }) => <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">{label}{children}</label>;

const ToggleSetting = ({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) => <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-purple-600" /></label>;

const DefaultValueEditor = ({ block, candidate, onChange }: { block: QuickUseBlockDefinition; candidate: QuickUseCandidate; onChange: (value: JsonPrimitive | undefined) => void }) => {
  if (candidate.kind === 'material') return null;
  if (candidate.kind === 'setting' && candidate.parameterType === 'boolean') return <ToggleSetting label="Default value" checked={Boolean(block.defaultValue)} onChange={onChange} />;
  if (candidate.kind === 'setting' && candidate.parameterType === 'enum') return <SettingField label="Default value"><select className={inputClassName} value={String(block.defaultValue ?? '')} onChange={(event) => onChange((candidate.enumValues || []).find((value) => String(value) === event.target.value))}>{(candidate.enumValues || []).map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select></SettingField>;
  if (candidate.kind === 'setting' && candidate.parameterType === 'number') return <SettingField label="Default value"><input type="number" className={inputClassName} min={candidate.min} max={candidate.max} step={candidate.step} value={typeof block.defaultValue === 'number' ? block.defaultValue : ''} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} /></SettingField>;
  if (block.control === 'dialogue' && candidate.kind === 'prompt_variable' && candidate.dialogue) return <SettingField label="Dialogue structure"><div className="mt-1.5"><DialogueEditor value={typeof block.defaultValue === 'string' ? block.defaultValue : ''} definition={candidate.dialogue} readOnly compact /><p className="mt-2 text-[11px] font-normal leading-4 text-slate-400">Character structure and default lines are configured in Workflow Builder.</p></div></SettingField>;
  if (block.control === 'dialogue') return <SettingField label="Default dialogue"><div className="mt-1.5"><DialogueEditor value={typeof block.defaultValue === 'string' ? block.defaultValue : ''} onChange={onChange} compact /></div></SettingField>;
  return <SettingField label="Default value"><textarea className={`${inputClassName} min-h-16 resize-y`} value={typeof block.defaultValue === 'string' ? block.defaultValue : ''} onChange={(event) => onChange(event.target.value)} /></SettingField>;
};

function renderControl(block: QuickUseBlockDefinition, candidate?: QuickUseCandidate): React.ReactNode {
  if (block.control === 'image_upload' || block.control === 'video_upload' || block.control === 'audio_upload') return <div className="flex min-h-24 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 text-xs text-slate-400 dark:border-slate-700">{block.control === 'image_upload' ? <ImageIcon className="mr-2 h-5 w-5" /> : block.control === 'video_upload' ? <Video className="mr-2 h-5 w-5" /> : <Music className="mr-2 h-5 w-5" />}Upload {block.control.split('_')[0]}</div>;
  if (block.control === 'toggle') return <label className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950"><span>{block.placeholder || 'Enabled'}</span><input type="checkbox" defaultChecked={Boolean(block.defaultValue)} className="h-4 w-4 accent-purple-600" /></label>;
  if (block.control === 'select' && candidate?.kind === 'setting') return <select className={inputClassName} defaultValue={String(block.defaultValue ?? '')}>{(candidate.enumValues || []).map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>;
  if (block.control === 'number') return <input type="number" className={inputClassName} defaultValue={typeof block.defaultValue === 'number' ? block.defaultValue : undefined} placeholder={block.placeholder} />;
  if (block.control === 'dialogue') return <DialogueEditor value={typeof block.defaultValue === 'string' ? block.defaultValue : ''} definition={candidate?.kind === 'prompt_variable' ? candidate.dialogue : undefined} placeholder={block.placeholder} readOnly compact />;
  if (block.control === 'textarea') return <textarea className={`${inputClassName} min-h-20 resize-y`} defaultValue={typeof block.defaultValue === 'string' ? block.defaultValue : ''} placeholder={block.placeholder} />;
  return <input className={inputClassName} defaultValue={typeof block.defaultValue === 'string' ? block.defaultValue : ''} placeholder={block.placeholder} />;
}

function renderExampleMedia(example: Extract<QuickUseExampleDefinition, { kind: 'media' }>, url: string): React.ReactNode {
  if (example.assetType === 'video') return <video src={url} className="mt-3 max-h-40 w-full rounded-lg object-cover" controls />;
  if (example.assetType === 'audio') return <audio src={url} className="mt-3 w-full" controls />;
  return <img src={url} alt="Example" className="mt-3 max-h-40 w-full rounded-lg object-cover" />;
}
