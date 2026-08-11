import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, Plus, Video, Image as ImageIcon, Music, History, GripVertical, Info, Download, Trash2, ArrowRight, RefreshCw, Upload, Maximize2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useStore } from '../context/StoreContext';
import type { Generation } from '../types';
import type { WorkflowCapabilityKey } from '../workflows/types';
import {
  BUILDER_FEATURE_TO_CAPABILITY,
  convertAndValidateBuilderWorkflow,
  type BuilderDraftStep as WorkflowStep,
  type BuilderFeatureType as FeatureType,
  type BuilderMaterial as Material,
} from '../workflows/builderAdapter';
import {
  loadTemplateDraft,
  saveTemplateDraft,
  submitTemplateForReview,
  type PersistedMaterialMap,
  type PersistedResultMap,
  type PersistedResultPosterMap,
  type TemplateDraftIdentity,
} from '../utils/templateDraftApi';
import {
  TEMPLATE_UPLOAD_LIMITS,
  validateTemplateCoverFile,
  validateTemplateMaterialFile,
  type UploadedTemplateCover,
  type UploadedTemplateObject,
} from '../utils/templateStorage';
import { getWorkflowCapability } from '../workflows/registry';
import {
  deriveQuickUseCandidates,
  createQuickUseCandidateId,
} from '../workflows/quickUseCandidates';
import {
  addQuickUsePromptVariable,
  createEmptyQuickUseDefinition,
  removeQuickUsePromptVariable,
  setQuickUseMaterialReplaceable,
} from '../workflows/quickUseAuthoring';
import type {
  QuickUseDefinition,
  QuickUsePromptInputKind,
  QuickUseSettingCandidate,
} from '../workflows/quickUseTypes';
import { ensureGenerationThumbnail } from '../utils/generationThumbnail';
import { AuthGateModal } from '../components/AuthGateModal';

type WorkflowGeneration = Generation;

interface PromptVariableSelection {
  stepId: string;
  start: number;
  end: number;
  text: string;
  key: string;
  label: string;
  inputKind: QuickUsePromptInputKind;
  required: boolean;
}

const stableTextHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const suggestPromptVariableKey = (
  text: string,
  stepId: string,
  start: number,
  existingKeys: Set<string>,
): string => {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const base = /^[a-z]/.test(slug)
    ? slug
    : `variable_${stableTextHash(text).slice(0, 8)}`;
  if (!existingKeys.has(base)) return base;
  return `${base.slice(0, 54)}_${stableTextHash(`${stepId}:${start}:${text}`).slice(0, 8)}`;
};

const CAPABILITY_TO_BUILDER_FEATURE = Object.fromEntries(
  Object.entries(BUILDER_FEATURE_TO_CAPABILITY).map(([feature, capability]) => [
    capability,
    feature,
  ]),
) as Partial<Record<WorkflowCapabilityKey, FeatureType>>;

const isPersistedGenerationId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

const VIDEO_FEATURES: FeatureType[] = [
  'Image to Video',
  'Motion Control',
  'Image Lip Sync',
  'Video Lip Sync',
];

const FEATURE_REQUIRED_MATERIAL_TYPES: Record<FeatureType, Material['type'][]> = {
  'Image Generation': [],
  'Replace Product': ['Image', 'Image'],
  'Modify Image': ['Image'],
  'Image to Video': ['Image'],
  'Motion Control': ['Image', 'Video'],
  'Image Lip Sync': ['Image', 'Audio'],
  'Video Lip Sync': ['Video', 'Audio'],
};

const isVideoFeature = (feature: FeatureType): boolean =>
  VIDEO_FEATURES.includes(feature);

const looksLikeVideoUrl = (url?: string | null): boolean =>
  Boolean(url && /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url));

const getImageToVideoDuration = (value?: string): number => {
  const parsed = Number.parseInt(value?.replace(/[^0-9]/g, '') || '3', 10);
  return Math.min(15, Math.max(3, Number.isFinite(parsed) ? parsed : 3));
};

const getGenerationDuration = (value: unknown, fallback?: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(15, Math.max(3, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parts = value.split(':').map((part) => Number.parseFloat(part));
    const parsed = parts.length > 1 && parts.every(Number.isFinite)
      ? parts.reduce((total, part) => total * 60 + part, 0)
      : Number.parseFloat(value.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed)) {
      return Math.min(15, Math.max(3, Math.round(parsed)));
    }
  }
  return Math.min(15, Math.max(3, Math.round(fallback || 3)));
};

const getGenerationResolution = (value: unknown): '720p' | '1080p' =>
  value === '1080p' ? '1080p' : '720p';

const IMAGE_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'] as const;
const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
const MJ_REFERENCE_ROLES = [
  { value: 'image', label: 'Image Reference', flag: '--iw' },
  { value: 'style', label: 'Style Reference', flag: '--sw' },
  { value: 'omni', label: 'Subject Reference', flag: '--ow' },
] as const;

const assignMjReferenceRoles = (materials: Material[]): Material[] => {
  const used = new Set(materials.map((material) => material.referenceRole).filter(Boolean));
  return materials.map((material) => {
    if (material.type !== 'Image' || material.referenceRole) return material;
    const role = MJ_REFERENCE_ROLES.find((item) => !used.has(item.value))?.value;
    if (role) used.add(role);
    return role ? { ...material, referenceRole: role } : material;
  });
};

const createDefaultImageParams = (): NonNullable<WorkflowStep['imageParams']> => ({
  model: 'gpt-image-2',
  ratio: '1:1',
  resolution: '1K',
  quality: 'standard',
  stylize: 100,
  chaos: 0,
  experimental: 0,
  raw: false,
  seed: '',
  referenceMode: 'image',
  imageWeight: 1,
  styleWeight: 100,
  omniWeight: 100,
});

const getGenerationImageRatio = (value: unknown): string =>
  typeof value === 'string' && IMAGE_RATIOS.includes(value as typeof IMAGE_RATIOS[number])
    ? value
    : '1:1';

const getGenerationImageResolution = (value: unknown): string =>
  typeof value === 'string' && IMAGE_RESOLUTIONS.includes(value as typeof IMAGE_RESOLUTIONS[number])
    ? value
    : '1K';

const getGenerationImageModel = (parameters: Generation['generationParameters']): 'gpt-image-2' | 'mj-v8.1' => {
  if (parameters?.model === 'mj-v8.1' || parameters?.provider === 'evolink-mj-v8.1') return 'mj-v8.1';
  return 'gpt-image-2';
};

const getGenerationNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const getMissingRequiredMaterialTypes = (
  step: WorkflowStep,
  stepIndex: number,
  allSteps: WorkflowStep[],
): Material['type'][] => {
  const capability = getWorkflowCapability(BUILDER_FEATURE_TO_CAPABILITY[step.feature]);
  const unusedMaterials = step.materials.filter((material) => Boolean(material.url));
  const usedMaterialIds = new Set<string>();
  let previousStepUsed = false;
  const missing: Material['type'][] = [];

  capability.inputs.filter((slot) => slot.required).forEach((slot) => {
    const material = unusedMaterials.find(
      (candidate) =>
        !usedMaterialIds.has(candidate.id) &&
        candidate.type.toLowerCase() === slot.assetType,
    );
    if (material) {
      usedMaterialIds.add(material.id);
      return;
    }

    const hasPreviousOutput = !previousStepUsed &&
      slot.allowedSources.includes('previous_step') &&
      allSteps.slice(0, stepIndex).reverse().some((previous) => {
        const previousCapability = getWorkflowCapability(
          BUILDER_FEATURE_TO_CAPABILITY[previous.feature],
        );
        return previousCapability.output.assetType === slot.assetType;
      });
    if (hasPreviousOutput) {
      previousStepUsed = true;
      return;
    }

    missing.push(
      slot.assetType === 'image'
        ? 'Image'
        : slot.assetType === 'video'
          ? 'Video'
          : 'Audio',
    );
  });

  return missing;
};

const ensureRequiredMaterialCards = (
  feature: FeatureType,
  materials: Material[],
): Material[] => {
  const next = [...materials];
  const reservedIds = new Set<string>();
  FEATURE_REQUIRED_MATERIAL_TYPES[feature].forEach((type, index) => {
    const existing = next.find(
      (material) => material.type === type && !reservedIds.has(material.id),
    );
    if (existing) {
      reservedIds.add(existing.id);
      return;
    }
    const id = `required-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
    reservedIds.add(id);
    next.push({ id, type, url: null, allowDownload: true });
  });
  return next;
};

const createInitialStep = (): WorkflowStep => ({
  id: 'step-1',
  feature: 'Image Generation',
  resultUrl: null,
  materials: [
    { id: 'mat-1', type: 'Image', url: null, allowDownload: true },
  ],
  prompt: '',
  imageParams: createDefaultImageParams(),
});

export const TemplateBuilder = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    addToast,
    generations,
    loadingGenerations,
    refreshGenerations,
    user,
  } = useStore();

  // Left column - Final Result
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [finalResultType, setFinalResultType] = useState<'image' | 'video' | null>(null);
  const [isFinalResultManual, setIsFinalResultManual] = useState(false);
  const [finalResultFile, setFinalResultFile] = useState<File | null>(null);
  const [persistedFinalResult, setPersistedFinalResult] = useState<UploadedTemplateObject | null>(null);
  const [persistedFinalResultPoster, setPersistedFinalResultPoster] = useState<UploadedTemplateObject | null>(null);
  const [showFinalResultPreview, setShowFinalResultPreview] = useState(false);
  
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  
  // Publish Modal States
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [publishCover, setPublishCover] = useState<string | null>(null);
  const [publishCoverFile, setPublishCoverFile] = useState<File | null>(null);
  const [publishCoverType, setPublishCoverType] = useState<'image' | 'video' | null>(null);
  const [coverAspectRatio, setCoverAspectRatio] = useState<number | null>(null);
  const [coverVideoDuration, setCoverVideoDuration] = useState<number>(0);
  const [coverVideoStartTime, setCoverVideoStartTime] = useState<number>(0);

  const [steps, setSteps] = useState<WorkflowStep[]>([createInitialStep()]);
  const [activeStepId, setActiveStepId] = useState<string>('step-1');
  const [showRewardsModal, setShowRewardsModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [isDraggingResult, setIsDraggingResult] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [draftIdentity, setDraftIdentity] = useState<TemplateDraftIdentity | null>(null);
  const [persistedCover, setPersistedCover] = useState<UploadedTemplateCover | null>(null);
  const [resultFiles, setResultFiles] = useState<Record<string, File>>({});
  const [persistedResults, setPersistedResults] = useState<PersistedResultMap>({});
  const [persistedResultPosters, setPersistedResultPosters] = useState<PersistedResultPosterMap>({});
  const [materialFiles, setMaterialFiles] = useState<Record<string, File>>({});
  const [persistedMaterials, setPersistedMaterials] = useState<PersistedMaterialMap>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [reviewState, setReviewState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');
  const [draftLoadState, setDraftLoadState] = useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  const [isAdminTemplateMode, setIsAdminTemplateMode] = useState(false);
  const [quickUseDefinition, setQuickUseDefinition] = useState<QuickUseDefinition | null>(null);
  const [promptVariableSelection, setPromptVariableSelection] = useState<PromptVariableSelection | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultFileInputRef = useRef<HTMLInputElement>(null);
  const resultDragDepthRef = useRef(0);
  const publishFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedDraftIdRef = useRef<string | null>(null);

  const requestedTemplateId = new URLSearchParams(location.search).get('templateId');

  useEffect(() => {
    if (!user || !requestedTemplateId || loadedDraftIdRef.current === requestedTemplateId) return;
    loadedDraftIdRef.current = requestedTemplateId;
    setDraftLoadState('loading');
    setBuilderError(null);
    void loadTemplateDraft(requestedTemplateId, user.id)
      .then((draft) => {
        setDraftIdentity(draft.identity);
        setTemplateTitle(draft.title);
        setTemplateDescription(draft.description);
        setSteps(draft.steps.map((step) => ({
          ...step,
          materials: ensureRequiredMaterialCards(step.feature, step.materials),
        })));
        setActiveStepId(draft.steps[0]?.id || 'step-1');
        setFinalResult(draft.finalResultUrl);
        setFinalResultType(draft.finalResultType);
        setIsFinalResultManual(draft.isFinalResultManual);
        setFinalResultFile(null);
        setPersistedFinalResult(draft.finalResult);
        setPersistedFinalResultPoster(draft.finalResultPoster);
        setShowFinalResultPreview(false);
        setPersistedCover(draft.cover);
        setPublishCover(draft.coverUrl);
        setPublishCoverType(draft.coverType);
        setCoverAspectRatio(
          draft.cover?.original.width && draft.cover?.original.height
            ? draft.cover.original.width / draft.cover.original.height
            : null,
        );
        setPublishCoverFile(null);
        setPersistedResults(draft.results);
        setPersistedResultPosters(draft.resultPosters);
        setResultFiles({});
        setPersistedMaterials(draft.materials);
        setMaterialFiles({});
        setQuickUseDefinition(draft.quickUseDefinition);
        setIsAdminTemplateMode(Boolean(user.isAdmin && draft.quickUseDefinition));
        setPromptVariableSelection(null);
        setSaveState('saved');
        setReviewState('idle');
        setDraftLoadState('loaded');
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Could not load this draft.';
        setBuilderError(message);
        setDraftLoadState('failed');
        addToast('error', message);
      });
  }, [requestedTemplateId, user, addToast]);

  const activeStep = steps.find(s => s.id === activeStepId) || steps[0];
  const workflowConversion = useMemo(
    () => convertAndValidateBuilderWorkflow(steps),
    [steps],
  );
  const adminDefinition = useMemo(
    () => quickUseDefinition || createEmptyQuickUseDefinition(templateTitle, templateDescription),
    [quickUseDefinition, templateTitle, templateDescription],
  );
  const quickUseCandidates = useMemo(
    () => deriveQuickUseCandidates(workflowConversion.workflow, adminDefinition),
    [workflowConversion.workflow, adminDefinition],
  );
  const settingCandidates = useMemo(
    () => quickUseCandidates.candidates.filter(
      (candidate): candidate is QuickUseSettingCandidate => candidate.kind === 'setting',
    ),
    [quickUseCandidates.candidates],
  );
  const activeWorkflowStep = workflowConversion.workflow.steps.find(
    (step) => step.id === activeStepId,
  );
  const activeCapability = activeWorkflowStep
    ? getWorkflowCapability(activeWorkflowStep.capability)
    : null;
  const replaceableInputOptions = activeWorkflowStep && activeCapability
    ? activeWorkflowStep.inputs.flatMap((input) => {
        const slot = activeCapability.inputs.find((candidate) => candidate.key === input.slot);
        if (!slot?.allowedSources.includes('user_upload') || input.source === 'previous_step') {
          return [];
        }
        return [{ input, slot }];
      })
    : [];
  const activePromptTemplate = adminDefinition.promptTemplates.find(
    (template) => template.stepId === activeStepId && template.parameterKey === 'prompt',
  );
  const activeResultGeneration = generations.find(
    (generation) => generation.id === activeStep.resultGenerationId,
  );
  const activeStepResultIsVideo = activeResultGeneration
    ? Boolean(
        activeResultGeneration.videoUrl &&
          activeResultGeneration.videoUrl === activeStep.resultUrl,
      )
    : activeStep.resultType === 'video' || (
        !activeStep.resultType && isVideoFeature(activeStep.feature)
      );
  const selectableGenerations = generations.filter(
    (generation) =>
      isPersistedGenerationId(generation.id) &&
      Boolean(generation.imageUrl || generation.videoUrl),
  );

  useEffect(() => {
    if (isFinalResultManual) return;
    const latestStep = steps[steps.length - 1];
    const latestResult = latestStep?.resultUrl || null;
    setFinalResult(latestResult);
    setFinalResultType(
      latestResult
        ? latestStep.resultType || (isVideoFeature(latestStep.feature) ? 'video' : 'image')
        : null,
    );
  }, [steps, isFinalResultManual]);

  useEffect(() => {
    const video = videoRef.current;
    if (!showPublishModal || publishCoverType !== 'video' || !video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : coverVideoDuration;
    if (!duration) return;
    const segmentStart = Math.min(coverVideoStartTime, Math.max(0, duration - 2));
    video.currentTime = segmentStart;
    void video.play().catch(() => undefined);
  }, [coverVideoDuration, coverVideoStartTime, publishCover, publishCoverType, showPublishModal]);

  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedStepId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedStepId || draggedStepId === targetId) return;

    const draggedIdx = steps.findIndex(s => s.id === draggedStepId);
    const targetIdx = steps.findIndex(s => s.id === targetId);
    
    if (draggedIdx === -1 || targetIdx === -1) return;

    const newSteps = [...steps];
    const [draggedStep] = newSteps.splice(draggedIdx, 1);
    newSteps.splice(targetIdx, 0, draggedStep);
    
    setSteps(newSteps);
    setSaveState('idle');
    setDraggedStepId(null);
  };

  const handleFinalResultUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        addToast('error', 'Please choose an image or video file.');
        return;
      }
      try {
        validateTemplateMaterialFile(
          file,
          file.type.startsWith('video/') ? 'video' : 'image',
          'Final result',
        );
      } catch (error) {
        addToast('error', error instanceof Error ? error.message : 'This final result file is not supported.');
        return;
      }
      if (isFinalResultManual && finalResult?.startsWith('blob:')) {
        URL.revokeObjectURL(finalResult);
      }
      const url = URL.createObjectURL(file);
      setFinalResult(url);
      setFinalResultType(file.type.startsWith('video/') ? 'video' : 'image');
      setIsFinalResultManual(true);
      setFinalResultFile(file);
      setPersistedFinalResult(null);
      setPersistedFinalResultPoster(null);
      setShowFinalResultPreview(false);
      setSaveState('idle');
    }
  };

  const handlePublishCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      try {
        validateTemplateCoverFile(file);
      } catch (error) {
        addToast('error', error instanceof Error ? error.message : 'This cover file is not supported.');
        return;
      }
      if (publishCover?.startsWith('blob:')) URL.revokeObjectURL(publishCover);
      const url = URL.createObjectURL(file);
      setPublishCover(url);
      setPublishCoverFile(file);
      setPersistedCover(null);
      setSaveState('idle');
      setPublishCoverType(file.type.startsWith('video/') ? 'video' : 'image');
      setCoverAspectRatio(null);
      setCoverVideoDuration(0);
      setCoverVideoStartTime(0);
    }
  };

  const addStep = () => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      feature: 'Image Generation',
      resultUrl: null,
      materials: [{ id: `mat-${Date.now()}`, type: 'Image', url: null, allowDownload: true }],
      prompt: '',
      imageParams: createDefaultImageParams(),
    };
    setSteps([...steps, newStep]);
    setActiveStepId(newStep.id);
    setSaveState('idle');
  };

  const updateActiveStep = (updates: Partial<WorkflowStep>) => {
    setBuilderError(null);
    setSaveState('idle');
    setSteps(steps.map(s => s.id === activeStepId ? { ...s, ...updates } : s));
  };

  const ensureAdminDefinition = (
    current: QuickUseDefinition | null,
  ): QuickUseDefinition => current || createEmptyQuickUseDefinition(
    templateTitle,
    templateDescription,
  );

  const handleAdminTemplateModeToggle = () => {
    if (!user?.isAdmin) return;
    setIsAdminTemplateMode((enabled) => {
      const next = !enabled;
      if (next) {
        setQuickUseDefinition((current) => ensureAdminDefinition(current));
      } else {
        setPromptVariableSelection(null);
      }
      return next;
    });
  };

  const handleReplaceableInputChange = (slot: string, replaceable: boolean) => {
    if (!activeWorkflowStep) return;
    setQuickUseDefinition((current) => setQuickUseMaterialReplaceable(
      ensureAdminDefinition(current),
      { kind: 'workflow_input', stepId: activeWorkflowStep.id, slot },
      replaceable,
    ));
    setSaveState('idle');
    setBuilderError(null);
  };

  const handlePromptSelection = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (!isAdminTemplateMode || !activeStep) return;
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (end <= start) {
      setPromptVariableSelection(null);
      return;
    }
    const text = activeStep.prompt.slice(start, end);
    if (!text.trim()) {
      setPromptVariableSelection(null);
      return;
    }
    const existingKeys = new Set<string>(
      (activePromptTemplate?.variables || []).map((variable) => variable.key),
    );
    setPromptVariableSelection({
      stepId: activeStep.id,
      start,
      end,
      text,
      key: suggestPromptVariableKey(text, activeStep.id, start, existingKeys),
      label: text.trim().length <= 48 ? text.trim() : 'Prompt variable',
      inputKind: text.trim().length > 160 ? 'textarea' : 'text',
      required: true,
    });
  };

  const handleMakePromptSelectionEditable = () => {
    if (!promptVariableSelection || promptVariableSelection.stepId !== activeStep.id) return;
    try {
      const next = addQuickUsePromptVariable(
        ensureAdminDefinition(quickUseDefinition),
        {
          stepId: activeStep.id,
          parameterKey: 'prompt',
          workflowPrompt: activeStep.prompt,
          selectionStart: promptVariableSelection.start,
          selectionEnd: promptVariableSelection.end,
          key: promptVariableSelection.key,
          label: promptVariableSelection.label,
          inputKind: promptVariableSelection.inputKind,
          required: promptVariableSelection.required,
        },
      );
      setQuickUseDefinition(next);
      setPromptVariableSelection(null);
      setSaveState('idle');
      setBuilderError(null);
      addToast('success', 'Prompt variable added.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create this prompt variable.';
      setBuilderError(message);
      addToast('error', message);
    }
  };

  const handleRemovePromptVariable = (variableKey: string) => {
    setQuickUseDefinition((current) => current
      ? removeQuickUsePromptVariable(current, activeStep.id, 'prompt', variableKey)
      : current);
    setPromptVariableSelection(null);
    setSaveState('idle');
  };

  const updateImageToVideoSettings = (
    updates: Partial<NonNullable<WorkflowStep['videoParams']>>,
  ) => {
    updateActiveStep({
      videoParams: {
        duration: activeStep.videoParams?.duration || '3s',
        resolution: activeStep.videoParams?.resolution || '720p',
        generateAudio: activeStep.videoParams?.generateAudio ?? true,
        ...updates,
      },
    });
  };

  const updateImageGenerationSettings = (
    updates: Partial<NonNullable<WorkflowStep['imageParams']>>,
  ) => {
    updateActiveStep({
      imageParams: {
        ...createDefaultImageParams(),
        ...activeStep.imageParams,
        ...updates,
      },
    });
  };

  const selectImageGenerationModel = (model: 'gpt-image-2' | 'mj-v8.1') => {
    updateActiveStep({
      imageParams: {
        ...createDefaultImageParams(),
        ...activeStep.imageParams,
        model,
      },
      materials: model === 'mj-v8.1'
        ? assignMjReferenceRoles(activeStep.materials)
        : activeStep.materials,
      inputBindings: undefined,
    });
  };

  const addMjReferenceMaterial = () => {
    const materials = assignMjReferenceRoles(activeStep.materials);
    const used = new Set(materials.map((material) => material.referenceRole).filter(Boolean));
    const role = MJ_REFERENCE_ROLES.find((item) => !used.has(item.value))?.value;
    if (!role) return;
    updateActiveStep({
      materials: [...materials, {
        id: `mat-${Date.now()}-${role}`,
        type: 'Image',
        url: null,
        allowDownload: true,
        referenceRole: role,
      }],
      inputBindings: undefined,
    });
  };

  const setMjReferenceRole = (materialId: string, referenceRole: 'image' | 'style' | 'omni') => {
    updateActiveStep({
      materials: activeStep.materials.map((material) => {
        if (material.id === materialId) return { ...material, type: 'Image', referenceRole };
        return material.referenceRole === referenceRole
          ? { ...material, referenceRole: undefined }
          : material;
      }),
      inputBindings: undefined,
    });
  };

  const addMaterial = () => {
    updateActiveStep({
      materials: [...activeStep.materials, { id: `mat-${Date.now()}`, type: 'Image', url: null, allowDownload: true }],
      inputBindings: undefined,
    });
  };

  const updateMaterial = (id: string, updates: Partial<Material>) => {
    updateActiveStep({
      materials: activeStep.materials.map(m => m.id === id ? { ...m, ...updates } : m),
      inputBindings: undefined,
    });
  };

  const removeMaterial = (id: string) => {
    setMaterialFiles((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPersistedMaterials((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    updateActiveStep({
      materials: activeStep.materials.filter(m => m.id !== id),
      inputBindings: undefined,
    });
  };

  const removeStep = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (steps.length === 1) return;
    const removedStep = steps.find((step) => step.id === id);
    if (removedStep?.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(removedStep.resultUrl);
    setResultFiles((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPersistedResults((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPersistedResultPosters((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    const newSteps = steps.filter(s => s.id !== id);
    setSteps(newSteps);
    setSaveState('idle');
    if (activeStepId === id) {
      setActiveStepId(newSteps[0].id);
    }
  };

  const handleMaterialUpload = (materialId: string, file?: File) => {
    if (!file) return;
    const material = activeStep.materials.find((item) => item.id === materialId);
    if (!material) return;
    try {
      validateTemplateMaterialFile(
        file,
        material.type.toLowerCase() as 'image' | 'video' | 'audio',
      );
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'This material file is not supported.');
      return;
    }
    setMaterialFiles((current) => ({ ...current, [materialId]: file }));
    setPersistedMaterials((current) => {
      const next = { ...current };
      delete next[materialId];
      return next;
    });
    setSaveState('idle');
    updateMaterial(materialId, { url: URL.createObjectURL(file) });
  };

  const applyStepResultFile = (file: File) => {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      addToast('error', 'Please choose an image or video file.');
      return;
    }
    const resultType = file.type.startsWith('video/') ? 'video' as const : 'image' as const;
    try {
      validateTemplateMaterialFile(file, resultType, 'Result image/video');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'This result file is not supported.');
      return;
    }

    if (activeStep.resultUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(activeStep.resultUrl);
    }
    const resultUrl = URL.createObjectURL(file);
    setResultFiles((current) => ({ ...current, [activeStep.id]: file }));
    setPersistedResults((current) => {
      const next = { ...current };
      delete next[activeStep.id];
      return next;
    });
    setPersistedResultPosters((current) => {
      const next = { ...current };
      delete next[activeStep.id];
      return next;
    });
    updateActiveStep({
      resultUrl,
      resultType,
      resultThumbnailUrl: undefined,
      resultGenerationId: undefined,
    });

    if (!isFinalResultManual && activeStep.id === steps[steps.length - 1]?.id) {
      setFinalResult(resultUrl);
      setFinalResultType(resultType);
    }
  };

  const handleStepResultUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) applyStepResultFile(file);
  };

  const handleResultDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resultDragDepthRef.current += 1;
    setIsDraggingResult(true);
  };

  const handleResultDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleResultDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resultDragDepthRef.current = Math.max(0, resultDragDepthRef.current - 1);
    if (resultDragDepthRef.current === 0) setIsDraggingResult(false);
  };

  const handleResultDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resultDragDepthRef.current = 0;
    setIsDraggingResult(false);
    const file = event.dataTransfer.files?.[0];
    if (file) applyStepResultFile(file);
  };

  const inferFeatureFromGeneration = (
    generation: WorkflowGeneration,
  ): FeatureType | null => {
    if (generation.capability) {
      return CAPABILITY_TO_BUILDER_FEATURE[generation.capability] ?? null;
    }
    if (generation.videoMode === 'image_to_video') return 'Image to Video';
    if (generation.videoMode === 'motion_control') return 'Motion Control';
    if (generation.videoMode === 'lip_sync') {
      const sourceAsset = generation.inputAssets?.find(
        (asset) => asset.assetType === 'image' || asset.assetType === 'video',
      );
      if (sourceAsset?.assetType === 'video') return 'Video Lip Sync';
      if (sourceAsset?.assetType === 'image') return 'Image Lip Sync';
      return looksLikeVideoUrl(generation.imageUrl)
        ? 'Video Lip Sync'
        : 'Image Lip Sync';
    }
    const inputKeys = new Set(
      generation.inputAssets?.map((asset) => asset.key) ?? [],
    );
    const hasReplaceInputs =
      inputKeys.has('scene_image') || inputKeys.has('product_image');
    const hasReplaceParameters =
      typeof generation.generationParameters?.extraBlend === 'boolean' ||
      typeof generation.generationParameters?.productSizePercent === 'number';
    if (hasReplaceInputs || hasReplaceParameters) return 'Replace Product';
    if (generation.templateId === 'text-to-image') return 'Image Generation';
    if (
      !generation.videoUrl &&
      generation.mediaType !== 'video' &&
      generation.templateId &&
      !['modify-session', 'default-welcome'].includes(generation.templateId)
    ) {
      // Rows created before generation snapshots existed still keep the real
      // gallery template id used by Replace Product.
      return 'Replace Product';
    }
    return null;
  };

  const handleHistorySelect = (generation: WorkflowGeneration) => {
    const resultUrl = generation.videoUrl || generation.imageUrl;
    if (!resultUrl) {
      addToast('error', 'This Dashboard result has no usable image or video.');
      return;
    }
    const feature = inferFeatureFromGeneration(generation);
    const snapshotMaterials = generation.inputAssets?.filter((asset) => asset.url).map((asset, index) => ({
      id: `history-${generation.id}-${index}`,
      type:
        asset.assetType === 'image'
          ? ('Image' as const)
          : asset.assetType === 'video'
            ? ('Video' as const)
            : ('Audio' as const),
      url: asset.url,
      allowDownload: true,
      sourceGenerationId: generation.id,
      referenceRole:
        asset.key === 'style_reference' ? 'style' as const
          : asset.key === 'omni_reference' ? 'omni' as const
            : asset.key === 'image_reference' || asset.key.startsWith('reference_images') ? 'image' as const
              : undefined,
    })) ?? [];
    const legacySourceUrl =
      generation.videoUrl &&
      generation.imageUrl &&
      generation.imageUrl !== generation.videoUrl
        ? generation.imageUrl
        : null;
    const legacyMaterials: Material[] =
      snapshotMaterials.length === 0 && legacySourceUrl && feature
        ? feature === 'Image to Video'
          ? [{
              id: `history-${generation.id}-legacy-image`,
              type: 'Image',
              url: legacySourceUrl,
              allowDownload: true,
              sourceGenerationId: generation.id,
            }]
          : feature === 'Video Lip Sync'
            ? [{
                id: `history-${generation.id}-legacy-video`,
                type: 'Video',
                url: legacySourceUrl,
                allowDownload: true,
                sourceGenerationId: generation.id,
              }]
            : feature === 'Motion Control' || feature === 'Image Lip Sync'
              ? [{
                  id: `history-${generation.id}-legacy-image`,
                  type: 'Image',
                  url: legacySourceUrl,
                  allowDownload: true,
                  sourceGenerationId: generation.id,
                }]
              : []
        : [];
    const restoredMaterials =
      snapshotMaterials.length > 0 ? snapshotMaterials : legacyMaterials;
    const parameterPrompt = generation.generationParameters?.prompt;
    const parameterDuration = generation.generationParameters?.duration;
    const parameterResolution = generation.generationParameters?.resolution;
    const parameterGenerateAudio = generation.generationParameters?.generateAudio;
    const parameterRatio = generation.generationParameters?.ratio;
    const imageModel = getGenerationImageModel(generation.generationParameters);

    const nextFeature: FeatureType = feature ?? (
      generation.videoUrl || generation.mediaType === 'video'
        ? 'Image to Video'
        : 'Image Generation'
    );
    const requiredMaterials = ensureRequiredMaterialCards(nextFeature, restoredMaterials);
    const nextMaterials = nextFeature === 'Image Generation' && imageModel === 'mj-v8.1'
      ? assignMjReferenceRoles(requiredMaterials)
      : requiredMaterials;
    const nextVideoParams = nextFeature === 'Image to Video'
      ? {
          duration: `${getGenerationDuration(parameterDuration, generation.videoDuration)}s`,
          resolution: getGenerationResolution(parameterResolution),
          generateAudio:
            typeof parameterGenerateAudio === 'boolean'
              ? parameterGenerateAudio
              : true,
        }
      : undefined;
    const nextImageParams = nextFeature === 'Image Generation'
      ? {
          ...createDefaultImageParams(),
          model: imageModel,
          ratio: getGenerationImageRatio(parameterRatio),
          resolution: getGenerationImageResolution(parameterResolution),
          quality: generation.generationParameters?.quality === 'hd' ? 'hd' as const : 'standard' as const,
          stylize: getGenerationNumber(generation.generationParameters?.stylize, 100),
          chaos: getGenerationNumber(generation.generationParameters?.chaos, 0),
          experimental: getGenerationNumber(generation.generationParameters?.experimental, 0),
          raw: generation.generationParameters?.raw === true,
          seed: generation.generationParameters?.seed === undefined
            ? ''
            : String(generation.generationParameters.seed),
          referenceMode:
            generation.generationParameters?.referenceMode === 'style'
            || generation.generationParameters?.referenceMode === 'omni'
              ? generation.generationParameters.referenceMode
              : 'image' as const,
          imageWeight: getGenerationNumber(generation.generationParameters?.imageWeight, 1),
          styleWeight: getGenerationNumber(generation.generationParameters?.styleWeight, 100),
          omniWeight: getGenerationNumber(generation.generationParameters?.omniWeight, 100),
        }
      : undefined;
    const nextStep: WorkflowStep = {
      ...activeStep,
      resultUrl,
      resultType: generation.videoUrl && resultUrl === generation.videoUrl ? 'video' : 'image',
      resultThumbnailUrl: generation.videoUrl && resultUrl === generation.videoUrl
        ? generation.thumbnailUrl || (
            generation.imageUrl && generation.imageUrl !== generation.videoUrl
              ? generation.imageUrl
              : undefined
          )
        : undefined,
      resultGenerationId: generation.id,
      feature: nextFeature,
      prompt:
        typeof parameterPrompt === 'string'
          ? parameterPrompt
          : generation.prompt ?? '',
      materials: nextMaterials,
      inputBindings: undefined,
      videoParams: nextVideoParams,
      imageParams: nextImageParams,
    };

    // A Dashboard result is one immutable generation snapshot. Remove every
    // local/persisted association from the previous selection so old uploads
    // can never leak into the newly selected feature, prompt, or settings.
    const replacedMaterialIds = new Set(activeStep.materials.map((material) => material.id));
    setMaterialFiles((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !replacedMaterialIds.has(id)),
    ));
    setPersistedMaterials((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !replacedMaterialIds.has(id)),
    ));
    setResultFiles((current) => {
      const next = { ...current };
      delete next[activeStep.id];
      return next;
    });
    setPersistedResults((current) => {
      const next = { ...current };
      delete next[activeStep.id];
      return next;
    });
    setPersistedResultPosters((current) => {
      const next = { ...current };
      delete next[activeStep.id];
      return next;
    });
    if (activeStep.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(activeStep.resultUrl);
    updateActiveStep(nextStep);
    if (nextStep.resultType === 'video' && !nextStep.resultThumbnailUrl) {
      void ensureGenerationThumbnail(generation).then((thumbnailUrl) => {
        if (!thumbnailUrl) return;
        setSteps((current) => current.map((step) => (
          step.id === activeStep.id && step.resultGenerationId === generation.id
            ? { ...step, resultThumbnailUrl: thumbnailUrl }
            : step
        )));
      });
    }

    if (!isFinalResultManual && activeStep.id === steps[steps.length - 1]?.id) {
      setFinalResult(resultUrl);
      setFinalResultType(
        generation.videoUrl && resultUrl === generation.videoUrl
          ? 'video'
          : 'image',
      );
    }

    const activeIndex = steps.findIndex((step) => step.id === activeStep.id);
    const nextSteps = steps.map((step) => step.id === activeStep.id ? nextStep : step);
    if (getMissingRequiredMaterialTypes(nextStep, activeIndex, nextSteps).length > 0) {
      addToast(
        'info',
        'This older result has no complete material snapshot. The available fields were restored; please add the missing material below.',
      );
    }
    setShowHistoryModal(false);
  };

  const openDashboardResults = () => {
    setShowHistoryModal(true);
    void refreshGenerations();
  };

  const clearActiveStepResult = () => {
    const removedResult = activeStep.resultUrl;
    if (removedResult?.startsWith('blob:')) URL.revokeObjectURL(removedResult);
    setResultFiles((current) => {
      const next = { ...current };
      delete next[activeStep.id];
      return next;
    });
    setPersistedResults((current) => {
      const next = { ...current };
      delete next[activeStep.id];
      return next;
    });
    setPersistedResultPosters((current) => {
      const next = { ...current };
      delete next[activeStep.id];
      return next;
    });
    updateActiveStep({
      resultUrl: null,
      resultType: undefined,
      resultThumbnailUrl: undefined,
      resultGenerationId: undefined,
    });
    if (!isFinalResultManual && activeStep.id === steps[steps.length - 1]?.id && finalResult === removedResult) {
      setFinalResult(null);
      setFinalResultType(null);
    }
  };

  const handleOpenPublish = () => {
    if (reviewState === 'submitted') return;
    if (!user) {
      setShowAuthGate(true);
      return;
    }
    setBuilderError(null);
    setShowPublishModal(true);
  };

  const handleContinueToQuickUse = async () => {
    const savedIdentity = await handleSaveDraft(false);
    if (!savedIdentity) return;
    navigate(`/admin/templates/${savedIdentity.templateId}/quick-use`);
  };

  const handleSaveDraft = async (
    showSuccessToast = true,
  ): Promise<TemplateDraftIdentity | null> => {
    if (!user) {
      setShowAuthGate(true);
      return null;
    }

    setSaveState('saving');
    setBuilderError(null);
    const stepsForSave = await Promise.all(steps.map(async (step) => {
      if (
        step.resultType !== 'video'
        || !step.resultGenerationId
        || step.resultThumbnailUrl
      ) {
        return step;
      }
      const generation = generations.find((item) => item.id === step.resultGenerationId);
      if (!generation) return step;
      const thumbnailUrl = await ensureGenerationThumbnail(generation);
      return thumbnailUrl ? { ...step, resultThumbnailUrl: thumbnailUrl } : step;
    }));
    if (stepsForSave.some((step, index) => step !== steps[index])) {
      setSteps(stepsForSave);
    }
    const { workflow, validation } = convertAndValidateBuilderWorkflow(stepsForSave);
    if (!validation.valid) {
      const message =
        validation.issues[0]?.message ||
        'Check the workflow settings before saving this draft.';
      setBuilderError(message);
      addToast('error', message);
      setSaveState('failed');
      return null;
    }

    try {
      const saved = await saveTemplateDraft({
        identity: draftIdentity,
        userId: user.id,
        title: templateTitle,
        description: templateDescription,
        workflow,
        steps: stepsForSave,
        finalResultUrl: finalResult,
        finalResultType,
        isFinalResultManual,
        finalResultFile,
        persistedFinalResult,
        persistedFinalResultPoster,
        coverFile: publishCoverFile,
        coverVideoStartSeconds: coverVideoStartTime,
        persistedCover,
        resultFiles,
        persistedResults,
        persistedResultPosters,
        materialFiles,
        persistedMaterials,
        quickUseDefinition,
      });
      setDraftIdentity(saved.identity);
      setPersistedCover(saved.cover);
      setPersistedFinalResult(saved.finalResult);
      setPersistedFinalResultPoster(saved.finalResultPoster);
      setPersistedResults(saved.results);
      setPersistedResultPosters(saved.resultPosters);
      setPersistedMaterials(saved.materials);
      setQuickUseDefinition(saved.quickUseDefinition);
      setSteps((currentSteps) =>
        currentSteps.map((step) => ({
          ...step,
          materials: step.materials.map((material) => ({
            ...material,
            templateAssetId:
              saved.materialAssetIds[material.id] || material.templateAssetId,
          })),
        })),
      );
      setPublishCoverFile(null);
      setFinalResultFile(null);
      setResultFiles({});
      setMaterialFiles({});
      setSaveState('saved');
      if (showSuccessToast) addToast('success', 'Draft saved to your account.');
      return saved.identity;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Draft save failed.';
      setBuilderError(message);
      setSaveState('failed');
      addToast('error', message);
      return null;
    }
  };

  const handleConfirmPublish = async () => {
    if (!publishCover || !publishCoverType) {
      setReviewState('failed');
      addToast('error', 'A template cover is required before submitting for review.');
      return;
    }
    setReviewState('submitting');
    const savedIdentity = await handleSaveDraft(false);
    if (!savedIdentity) {
      setReviewState('failed');
      return;
    }

    try {
      await submitTemplateForReview(savedIdentity);
      setReviewState('submitted');
      setShowPublishModal(false);
      setBuilderError(null);
      addToast('success', 'Template submitted. It is now under review.');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Review submission failed.';
      setReviewState('failed');
      setBuilderError(message);
      addToast('error', message);
    }
  };

  const handleBuildAnother = () => {
    if (publishCover?.startsWith('blob:')) URL.revokeObjectURL(publishCover);
    if (isFinalResultManual && finalResult?.startsWith('blob:')) URL.revokeObjectURL(finalResult);
    steps.forEach((step) => {
      if (step.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(step.resultUrl);
      step.materials.forEach((material) => {
        if (material.url?.startsWith('blob:')) URL.revokeObjectURL(material.url);
      });
    });

    setFinalResult(null);
    setFinalResultType(null);
    setIsFinalResultManual(false);
    setFinalResultFile(null);
    setPersistedFinalResult(null);
    setPersistedFinalResultPoster(null);
    setShowFinalResultPreview(false);
    setTemplateTitle('');
    setTemplateDescription('');
    setPublishCover(null);
    setPublishCoverFile(null);
    setPublishCoverType(null);
    setCoverAspectRatio(null);
    setCoverVideoDuration(0);
    setCoverVideoStartTime(0);
    setSteps([createInitialStep()]);
    setActiveStepId('step-1');
    setShowPublishModal(false);
    setShowHistoryModal(false);
    setPreviewMaterial(null);
    setBuilderError(null);
    setDraftIdentity(null);
    setPersistedCover(null);
    setResultFiles({});
    setPersistedResults({});
    setPersistedResultPosters({});
    setMaterialFiles({});
    setPersistedMaterials({});
    setQuickUseDefinition(null);
    setIsAdminTemplateMode(false);
    setPromptVariableSelection(null);
    setSaveState('idle');
    setReviewState('idle');
    setDraftLoadState('idle');
    loadedDraftIdRef.current = null;

    navigate('/templates/create');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen pt-16 bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 sticky top-16 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              Build a workflow template
              {isAdminTemplateMode && (
                <span className="ml-2 text-sm font-medium text-purple-600 dark:text-purple-400">
                  (Admin Mode)
                </span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {reviewState === 'submitted' && (
              <Button variant="outline" size="sm" onClick={handleBuildAnother}>
                <Plus className="h-4 w-4" />
                Build another template
              </Button>
            )}
            <span className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${
                reviewState === 'submitted'
                  ? 'bg-amber-500'
                  : saveState === 'saved'
                  ? 'bg-green-500'
                  : saveState === 'failed'
                    ? 'bg-red-500'
                    : 'bg-slate-300 dark:bg-slate-600'
              }`}></span>
              {reviewState === 'submitted'
                ? 'In review'
                : reviewState === 'submitting'
                  ? 'Submitting...'
                  : saveState === 'saving'
                ? 'Saving...'
                : saveState === 'saved'
                  ? 'Saved'
                  : saveState === 'failed'
                    ? 'Save failed'
                    : 'Unsaved'}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSaveDraft()}
              disabled={draftLoadState === 'loading' || saveState === 'saving' || reviewState === 'submitting' || reviewState === 'submitted'}
            >
              {saveState === 'saving' ? 'Saving...' : 'Save draft'}
            </Button>
            {isAdminTemplateMode ? (
              <Button
                variant="gradient"
                size="sm"
                onClick={() => void handleContinueToQuickUse()}
                disabled={draftLoadState === 'loading' || saveState === 'saving' || reviewState === 'submitting' || reviewState === 'submitted'}
              >
                Continue to Quick Use <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="gradient"
                size="sm"
                onClick={handleOpenPublish}
                disabled={draftLoadState === 'loading' || saveState === 'saving' || reviewState === 'submitting' || reviewState === 'submitted'}
              >
                {reviewState === 'submitted' ? 'Under review' : 'Submit for review'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {isAdminTemplateMode && (
        <div className="border-b border-purple-200 bg-purple-50 dark:border-purple-500/20 dark:bg-purple-500/10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-purple-950 dark:text-purple-100">
                Admin Template Mode
              </div>
              <div className="mt-0.5 text-xs text-purple-700 dark:text-purple-300">
                Define user-replaceable inputs and prompt variables here. Quick Use layout is configured separately.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-purple-800 dark:text-purple-200">
              <span className="rounded-full bg-white/80 px-3 py-1 dark:bg-slate-900/60">
                {adminDefinition.replaceableMaterials.length} materials
              </span>
              <span className="rounded-full bg-white/80 px-3 py-1 dark:bg-slate-900/60">
                {adminDefinition.promptTemplates.reduce((count, template) => count + template.variables.length, 0)} prompt variables
              </span>
              <span className="rounded-full bg-white/80 px-3 py-1 dark:bg-slate-900/60">
                {settingCandidates.length} registry settings
              </span>
              <button
                type="button"
                onClick={handleAdminTemplateModeToggle}
                className="ml-1 font-semibold text-purple-700 underline decoration-dotted underline-offset-2 hover:text-purple-900 dark:text-purple-300 dark:hover:text-purple-100"
              >
                Exit Admin Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewState === 'submitted' && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-sm font-medium text-amber-900 dark:text-amber-200">
            <span>Submitted for review. This saved version is now read-only.</span>
            <button
              type="button"
              onClick={handleBuildAnother}
              className="pointer-events-auto font-semibold underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-100"
            >
              Build another template
            </button>
          </div>
        </div>
      )}

      {draftLoadState === 'loading' && (
        <div className="border-b border-purple-200 bg-purple-50 dark:border-purple-500/20 dark:bg-purple-500/10">
          <div className="mx-auto max-w-7xl px-4 py-3 text-center text-sm font-medium text-purple-800 dark:text-purple-200">
            Loading your saved draft...
          </div>
        </div>
      )}

      {/* Rewards Banner */}
      <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-2 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <SparklesIcon className="w-4 h-4 text-amber-500" />
            <span>Receive free credits when other people successfully use your published templates.</span>
          </div>
          <button 
            onClick={() => setShowRewardsModal(true)}
            className="font-medium underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          >
            How rewards work
          </button>
        </div>
      </div>

      {builderError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <span>{builderError}</span>
            <button
              type="button"
              onClick={() => setBuilderError(null)}
              className="font-medium underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className={`flex-1 max-w-7xl mx-auto w-full px-4 py-8 grid grid-cols-1 md:grid-cols-12 gap-8 items-start ${
        reviewState === 'submitted' ? 'pointer-events-none opacity-75' : ''
      }`}>
        {/* Left Column - Outline */}
        <div className="md:col-span-4 lg:col-span-3 space-y-6 md:sticky top-44">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Workflow outline</h2>
            
            {/* Final Result Uploader */}
            <div className="mb-4">
              <input type="file" ref={fileInputRef} onChange={handleFinalResultUpload} accept="image/*,video/*" className="hidden" />
              {finalResult ? (
                <div className="aspect-[3/4] w-full bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden relative group border border-slate-200 dark:border-slate-700">
                  {finalResultType === 'video' ? (
                    <video 
                      src={finalResult} 
                      className="w-full h-full object-cover" 
                      autoPlay 
                      muted 
                      loop 
                    />
                  ) : (
                    <img src={finalResult} alt="Final Result" className="w-full h-full object-cover" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => setShowFinalResultPreview(true)}
                      className="flex min-w-24 flex-col items-center gap-2 rounded-xl border border-white/25 bg-black/30 px-4 py-3 text-white backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/80"
                    >
                      <Maximize2 className="h-5 w-5" />
                      <span className="text-xs font-semibold">
                        {finalResultType === 'video' ? 'Play' : 'Enlarge'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex min-w-24 flex-col items-center gap-2 rounded-xl border border-white/25 bg-black/30 px-4 py-3 text-white backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/80"
                    >
                      <RefreshCw className="h-5 w-5" />
                      <span className="text-xs font-semibold">Change</span>
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-[3/4] w-full bg-slate-50 dark:bg-slate-800/50 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:scale-110 transition-transform">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Final Result</p>
                    <p className="text-xs text-slate-500 dark:text-slate-500">Image or video</p>
                  </div>
                </button>
              )}
            </div>

            {/* Template Title & Description */}
            <div className="mb-6 space-y-2">
              <input
                type="text"
                placeholder="Template title..."
                value={templateTitle}
                onChange={(e) => {
                  setTemplateTitle(e.target.value);
                  setBuilderError(null);
                  setSaveState('idle');
                }}
                className="w-full bg-transparent text-lg font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 border border-transparent hover:border-slate-200 focus:border-purple-500 dark:hover:border-slate-700 dark:focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 rounded-lg px-3 py-2 transition-colors"
              />
              <textarea
                placeholder="Brief description..."
                value={templateDescription}
                onChange={(e) => {
                  setTemplateDescription(e.target.value);
                  setSaveState('idle');
                }}
                rows={2}
                className="w-full bg-transparent text-sm text-slate-600 dark:text-slate-400 placeholder:text-slate-400 dark:placeholder:text-slate-600 border border-transparent hover:border-slate-200 focus:border-purple-500 dark:hover:border-slate-700 dark:focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 rounded-lg px-3 py-2 transition-colors resize-none"
              />
            </div>

            {/* Steps List */}
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div 
                  key={step.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, step.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, step.id)}
                  onClick={() => setActiveStepId(step.id)}
                  className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${activeStepId === step.id ? 'bg-white dark:bg-slate-800 border-purple-500/30 dark:border-purple-500/30 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/50'} ${draggedStepId === step.id ? 'opacity-50' : 'opacity-100'}`}
                >
                  <div className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-600 dark:text-slate-300">
                    {index + 1}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className={`text-sm font-medium truncate ${activeStepId === step.id ? 'text-purple-600 dark:text-purple-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      {step.feature}
                    </p>
                  </div>
                  {steps.length > 1 && (
                    <button 
                      onClick={(e) => removeStep(step.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <Button 
              variant="outline" 
              className="w-full mt-4 flex items-center justify-center gap-2 border-dashed"
              onClick={addStep}
            >
              <Plus className="w-4 h-4" />
              Add next step
            </Button>
          </div>
        </div>

        {/* Center Column - Main Working Area */}
        <div className="md:col-span-8 lg:col-span-9 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 p-6 sm:p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-8 pb-4 border-b border-slate-100 dark:border-white/5">
          Step {steps.findIndex(s => s.id === activeStepId) + 1} Configuration
          </h2>

          <div className="space-y-12">
            
            {/* Section 1: Result */}
            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <button
                  type="button"
                  disabled={!user?.isAdmin || reviewState === 'submitted'}
                  onClick={handleAdminTemplateModeToggle}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                    isAdminTemplateMode
                      ? 'cursor-pointer bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.6)] ring-4 ring-purple-500/30 dark:ring-purple-400/30'
                      : user?.isAdmin && reviewState !== 'submitted'
                        ? 'cursor-pointer bg-purple-100 text-purple-600 ring-2 ring-purple-500/20 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-400 dark:hover:bg-purple-900/60'
                        : 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                  }`}
                  title={user?.isAdmin
                    ? isAdminTemplateMode
                      ? 'Exit Admin Template Mode'
                      : 'Activate Admin Template Mode'
                    : undefined}
                  aria-label={isAdminTemplateMode ? 'Exit Admin Template Mode' : 'Activate Admin Template Mode'}
                >
                  1
                </button>
                <span>
                  Result from This Step
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                    (Choose from Dashboard or upload a local image/video)
                  </span>
                </span>
              </h3>
              <input
                ref={resultFileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleStepResultUpload}
                className="hidden"
                aria-label="Upload a result image or video from this device"
              />
              <div
                onDragEnter={handleResultDragEnter}
                onDragOver={handleResultDragOver}
                onDragLeave={handleResultDragLeave}
                onDrop={handleResultDrop}
                className={`relative w-full max-w-sm aspect-video bg-slate-50 dark:bg-slate-800/50 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group ${
                  isDraggingResult
                    ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-100 dark:border-purple-400 dark:bg-purple-950/30 dark:ring-purple-900/40'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {activeStep.resultUrl ? (
                  activeStepResultIsVideo ? (
                    <video
                      src={activeStep.resultUrl}
                      className="w-full h-full object-cover rounded-xl"
                      controls
                      playsInline
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <img src={activeStep.resultUrl} alt="Result" className="w-full h-full object-cover rounded-xl" />
                  )
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Add a result image or video</p>
                    <p className="px-4 text-center text-xs text-slate-400">
                      Drag and drop a file here, use a saved generation, or choose one from this device.
                    </p>
                    <p className="px-4 text-center text-[11px] text-slate-400">
                      Images or videos up to {TEMPLATE_UPLOAD_LIMITS.materialBytes / (1024 * 1024)} MB.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 px-4">
                      <button
                        type="button"
                        onClick={openDashboardResults}
                        className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-purple-700"
                      >
                        <History className="h-3.5 w-3.5" />
                        Choose from Dashboard
                      </button>
                      <button
                        type="button"
                        onClick={() => resultFileInputRef.current?.click()}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:border-purple-300 hover:text-purple-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Upload from device
                      </button>
                    </div>
                  </>
                )}
                {activeStep.resultUrl && (
                  <div className="absolute right-2 top-2 z-10 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDashboardResults();
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-purple-600/90 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-purple-600"
                      aria-label="Replace this step result"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Dashboard
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        resultFileInputRef.current?.click();
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-black/75 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black"
                      aria-label="Upload a local replacement for this step result"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        clearActiveStepResult();
                      }}
                      className="rounded-lg bg-red-600/90 p-1.5 text-white backdrop-blur hover:bg-red-600"
                      aria-label="Remove this step result"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Section 2: Feature */}
            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 flex items-center justify-center text-sm">2</span>
                Feature I Used
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  'Image Generation',
                  'Replace Product',
                  'Modify Image',
                  'Image to Video',
                  'Motion Control',
                  'Image Lip Sync',
                  'Video Lip Sync',
                ] as FeatureType[]).map((feature) => (
                  <button
                    key={feature}
                    onClick={() => updateActiveStep({
                      feature,
                      materials: ensureRequiredMaterialCards(feature, activeStep.materials),
                      inputBindings: undefined,
                      videoParams: feature === 'Image to Video'
                        ? activeStep.feature === 'Image to Video' && activeStep.videoParams
                          ? activeStep.videoParams
                          : { duration: '3s', resolution: '720p', generateAudio: true }
                        : undefined,
                      imageParams: feature === 'Image Generation'
                        ? activeStep.feature === 'Image Generation' && activeStep.imageParams
                          ? activeStep.imageParams
                          : createDefaultImageParams()
                        : undefined,
                    })}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      activeStep.feature === feature 
                        ? 'border-pink-500 bg-pink-50 dark:bg-pink-500/10 ring-1 ring-pink-500' 
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="font-medium text-sm text-slate-900 dark:text-white">{feature}</div>
                  </button>
                ))}
              </div>
            </section>

            {/* Section 3: Materials */}
            <section>
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center text-sm">3</span>
                  Materials I Uploaded
                </h3>
                <Button variant="outline" size="sm" onClick={addMaterial}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Material
                </Button>
              </div>

              {isAdminTemplateMode && (
                <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50/70 p-4 dark:border-purple-500/20 dark:bg-purple-500/5">
                  <div className="mb-3">
                    <div className="text-sm font-semibold text-purple-950 dark:text-purple-100">User-replaceable workflow inputs</div>
                    <div className="mt-1 text-xs text-purple-700 dark:text-purple-300">
                      Inputs come from the active capability contract. Previous-step inputs cannot be exposed as uploads.
                    </div>
                  </div>
                  {replaceableInputOptions.length > 0 ? (
                    <div className="space-y-2">
                      {replaceableInputOptions.map(({ input, slot }) => {
                        const candidateId = createQuickUseCandidateId({
                          kind: 'workflow_input',
                          stepId: activeWorkflowStep!.id,
                          slot: input.slot,
                        });
                        const checked = adminDefinition.replaceableMaterials.some(
                          (definition) => createQuickUseCandidateId(definition.binding) === candidateId,
                        );
                        return (
                          <label
                            key={candidateId}
                            className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-purple-100 bg-white px-3 py-2.5 dark:border-purple-500/15 dark:bg-slate-900/70"
                          >
                            <span>
                              <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{slot.label}</span>
                              <span className="block text-[11px] text-slate-500">
                                {slot.assetType} · {input.source === 'template_asset' ? 'template default attached' : 'user upload input'}
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => handleReplaceableInputChange(input.slot, event.target.checked)}
                              className="h-4 w-4 cursor-pointer accent-purple-600"
                            />
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-purple-200 px-3 py-3 text-xs text-purple-700 dark:border-purple-500/20 dark:text-purple-300">
                      This step has no eligible upload input yet. Add the required material or choose a capability that accepts user uploads.
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {activeStep.materials.map((material, idx) => (
                  <div
                    key={material.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/30 flex flex-col sm:flex-row gap-6 relative group"
                  >
                    {activeStep.materials.length > 1 && (
                      <button 
                        onClick={() => removeMaterial(material.id)}
                        className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    
                    {/* Material Upload Area */}
                    <div className="w-full sm:w-48 aspect-square sm:aspect-auto sm:h-32 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-amber-500 transition-colors overflow-hidden relative">
                      <input
                        id={`material-upload-${material.id}`}
                        type="file"
                        className="hidden"
                        accept={
                          material.type === 'Image'
                            ? 'image/*'
                            : material.type === 'Video'
                              ? 'video/*'
                              : 'audio/*'
                        }
                        onChange={(event) =>
                          handleMaterialUpload(material.id, event.target.files?.[0])
                        }
                      />
                      {material.url ? (
                        <button
                          type="button"
                          onClick={() => setPreviewMaterial(material)}
                          className="group/preview relative flex h-full w-full items-center justify-center overflow-hidden"
                          aria-label={`Preview ${material.type.toLowerCase()} material`}
                        >
                          {material.type === 'Image' ? (
                            <img src={material.url} alt="Material" className="h-full w-full object-cover" />
                          ) : material.type === 'Video' ? (
                            <video
                              src={material.url}
                              className="pointer-events-none h-full w-full object-cover"
                              muted
                              preload="metadata"
                            />
                          ) : (
                            <div className="px-3 text-center">
                              <Music className="mx-auto mb-2 h-7 w-7 text-amber-500" />
                              <span className="text-xs text-slate-500">Audio selected</span>
                            </div>
                          )}
                          <span className="absolute inset-x-0 bottom-0 bg-black/65 py-1.5 text-center text-[10px] font-medium text-white transition-colors group-hover/preview:bg-black/80">
                            Click to preview
                          </span>
                        </button>
                      ) : (
                        <label
                          htmlFor={`material-upload-${material.id}`}
                          className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2"
                        >
                          <Plus className="w-6 h-6 text-slate-400" />
                          <span className="text-xs text-slate-500">Upload {material.type}</span>
                        </label>
                      )}
                      {material.url && (
                        <label
                          htmlFor={`material-upload-${material.id}`}
                          className="absolute right-2 top-2 z-10 cursor-pointer rounded-md bg-white/95 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm transition hover:bg-amber-50 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Replace
                        </label>
                      )}
                    </div>

                    <div className="flex-1 space-y-4">
                      {/* Type Selector */}
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Material Type</label>
                        <div className="flex bg-slate-200/50 dark:bg-slate-900/50 rounded-lg p-1 w-fit">
                          {(['Image', 'Video', 'Audio'] as const).map(type => (
                            <button
                              key={type}
                              onClick={() => updateMaterial(material.id, { type })}
                              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${material.type === type ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                              {type === 'Image' && <ImageIcon className="w-3 h-3" />}
                              {type === 'Video' && <Video className="w-3 h-3" />}
                              {type === 'Audio' && <Music className="w-3 h-3" />}
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      {activeStep.feature === 'Image Generation'
                        && (activeStep.imageParams?.model || 'gpt-image-2') === 'mj-v8.1'
                        && material.type === 'Image' && (
                          <div>
                            <label className="mb-2 block text-xs font-medium text-slate-500 dark:text-slate-400">Midjourney Reference</label>
                            <div className="flex flex-wrap gap-2">
                              {MJ_REFERENCE_ROLES.map((role) => (
                                <button
                                  key={role.value}
                                  type="button"
                                  onClick={() => setMjReferenceRole(material.id, role.value)}
                                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${material.referenceRole === role.value
                                    ? 'bg-green-50 text-green-700 ring-1 ring-green-400 dark:bg-green-500/15 dark:text-green-300'
                                    : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900'}`}
                                >
                                  {role.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Allow Download Toggle */}
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input 
                            type="checkbox" 
                            className="sr-only" 
                            checked={material.allowDownload}
                            onChange={(e) => updateMaterial(material.id, { allowDownload: e.target.checked })}
                          />
                          <div className={`block w-10 h-6 rounded-full transition-colors ${material.allowDownload ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                          <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${material.allowDownload ? 'translate-x-4' : 'translate-x-0'}`}></div>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Reusable</span>
                          <span className="text-xs text-slate-500">Allow others to reuse this material</span>
                        </div>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Section 4: Prompt & Settings */}
            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center text-sm">4</span>
                Prompt & Settings I Set
              </h3>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Prompt</label>
                  <textarea 
                    value={activeStep.prompt}
                    onChange={(e) => updateActiveStep({ prompt: e.target.value })}
                    onSelect={handlePromptSelection}
                    placeholder="Enter the prompt used for this step..."
                    className="w-full h-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  />
                  {isAdminTemplateMode && (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-purple-700 dark:text-purple-300">
                        Select text in the prompt to create a stable Prompt Variable. The workflow prompt itself remains unchanged.
                      </p>
                      {promptVariableSelection?.stepId === activeStep.id && (
                        <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 dark:border-purple-500/20 dark:bg-purple-500/5">
                          <div className="mb-3 text-xs text-purple-700 dark:text-purple-300">
                            Selected default: <span className="font-medium text-purple-950 dark:text-purple-100">{promptVariableSelection.text}</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              Variable key
                              <input
                                value={promptVariableSelection.key}
                                onChange={(event) => setPromptVariableSelection((current) => current
                                  ? { ...current, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }
                                  : current)}
                                className="mt-1.5 h-9 w-full rounded-lg border border-purple-200 bg-white px-3 font-mono text-xs text-slate-900 dark:border-purple-500/20 dark:bg-slate-900 dark:text-white"
                              />
                            </label>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              User-facing label
                              <input
                                value={promptVariableSelection.label}
                                onChange={(event) => setPromptVariableSelection((current) => current
                                  ? { ...current, label: event.target.value }
                                  : current)}
                                className="mt-1.5 h-9 w-full rounded-lg border border-purple-200 bg-white px-3 text-sm text-slate-900 dark:border-purple-500/20 dark:bg-slate-900 dark:text-white"
                              />
                            </label>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              Suggested control
                              <select
                                value={promptVariableSelection.inputKind}
                                onChange={(event) => setPromptVariableSelection((current) => current
                                  ? { ...current, inputKind: event.target.value as QuickUsePromptInputKind }
                                  : current)}
                                className="mt-1.5 h-9 w-full rounded-lg border border-purple-200 bg-white px-3 text-sm text-slate-900 dark:border-purple-500/20 dark:bg-slate-900 dark:text-white"
                              >
                                <option value="text">Text input</option>
                                <option value="textarea">Textarea</option>
                                <option value="dialogue">Dialogue</option>
                              </select>
                            </label>
                            <label className="flex items-end gap-2 pb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                              <input
                                type="checkbox"
                                checked={promptVariableSelection.required}
                                onChange={(event) => setPromptVariableSelection((current) => current
                                  ? { ...current, required: event.target.checked }
                                  : current)}
                                className="h-4 w-4 accent-purple-600"
                              />
                              Required input
                            </label>
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPromptVariableSelection(null)}>
                              Cancel
                            </Button>
                            <Button size="sm" onClick={handleMakePromptSelectionEditable}>
                              Make editable
                            </Button>
                          </div>
                        </div>
                      )}
                      {activePromptTemplate && activePromptTemplate.variables.length > 0 && (
                        <div className="space-y-2">
                          {activePromptTemplate.variables.map((variable) => (
                            <div
                              key={variable.key}
                              className="flex items-center justify-between gap-4 rounded-lg border border-purple-100 bg-purple-50/50 px-3 py-2.5 dark:border-purple-500/15 dark:bg-purple-500/5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{variable.label}</div>
                                <div className="truncate text-[11px] text-slate-500">
                                  {`{{quick_use.${variable.key}}}`} · Default: {variable.defaultValue}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemovePromptVariable(variable.key)}
                                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                                aria-label={`Remove ${variable.label}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {activeStep.feature === 'Image to Video' && (
                  <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/30">
                    <div>
                      <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                        Duration
                        <span className="font-normal text-green-700 dark:text-green-300">
                          {getImageToVideoDuration(activeStep.videoParams?.duration)}s
                        </span>
                      </label>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-slate-400">3s</span>
                        <input
                          type="range"
                          min="3"
                          max="15"
                          step="1"
                          value={getImageToVideoDuration(activeStep.videoParams?.duration)}
                          onChange={(event) => updateImageToVideoSettings({ duration: `${event.target.value}s` })}
                          style={{
                            background: `linear-gradient(to right, #22c55e 0%, #22c55e ${((getImageToVideoDuration(activeStep.videoParams?.duration) - 3) / 12) * 100}%, #cbd5e1 ${((getImageToVideoDuration(activeStep.videoParams?.duration) - 3) / 12) * 100}%, #cbd5e1 100%)`,
                          }}
                          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-green-500 [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-green-500"
                        />
                        <span className="text-xs font-medium text-slate-400">15s</span>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Resolution</label>
                        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800/60">
                          {['720p', '1080p'].map((resolution) => (
                            <button
                              key={resolution}
                              type="button"
                              onClick={() => updateImageToVideoSettings({ resolution })}
                              className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all ${
                                (activeStep.videoParams?.resolution || '720p') === resolution
                                  ? 'bg-green-50 text-green-700 shadow-sm ring-1 ring-green-400 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/70'
                                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                              }`}
                            >
                              {resolution}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${
                        (activeStep.videoParams?.generateAudio ?? true)
                          ? 'border-green-400 bg-green-50/80 dark:border-green-400/70 dark:bg-green-500/10'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60'
                      }`}>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Generate Audio</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">Include synchronized sound</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={activeStep.videoParams?.generateAudio ?? true}
                          onChange={(event) => updateImageToVideoSettings({ generateAudio: event.target.checked })}
                          className="h-4 w-4 cursor-pointer accent-green-500"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {activeStep.feature === 'Image Generation' && (
                  <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/30">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Model</label>
                      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800/60">
                        {([
                          { value: 'gpt-image-2', label: 'GPT Image 2' },
                          { value: 'mj-v8.1', label: 'Midjourney V8.1' },
                        ] as const).map((model) => (
                          <button
                            key={model.value}
                            type="button"
                            onClick={() => selectImageGenerationModel(model.value)}
                            className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                              (activeStep.imageParams?.model || 'gpt-image-2') === model.value
                                ? 'bg-green-50 text-green-700 shadow-sm ring-1 ring-green-400 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/70'
                                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                          >
                            {model.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Aspect ratio</label>
                        <div className="grid grid-cols-4 gap-2">
                          {IMAGE_RATIOS.map((ratio) => (
                            <button
                              key={ratio}
                              type="button"
                              onClick={() => updateImageGenerationSettings({ ratio })}
                              className={`rounded-lg px-2 py-2 text-xs font-medium transition-all ${
                                (activeStep.imageParams?.ratio || '1:1') === ratio
                                  ? 'bg-green-50 text-green-700 shadow-sm ring-1 ring-green-400 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/70'
                                  : 'border border-slate-200 bg-white text-slate-500 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-slate-200'
                              }`}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>

                      {(activeStep.imageParams?.model || 'gpt-image-2') === 'gpt-image-2' ? (
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Resolution</label>
                          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800/60">
                            {IMAGE_RESOLUTIONS.map((resolution) => (
                              <button
                                key={resolution}
                                type="button"
                                onClick={() => updateImageGenerationSettings({ resolution })}
                                className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all ${
                                  (activeStep.imageParams?.resolution || '1K') === resolution
                                    ? 'bg-green-50 text-green-700 shadow-sm ring-1 ring-green-400 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/70'
                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                                }`}
                              >
                                {resolution}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Quality</label>
                            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800/60">
                              {(['standard', 'hd'] as const).map((quality) => (
                                <button
                                  key={quality}
                                  type="button"
                                  onClick={() => updateImageGenerationSettings({ quality })}
                                  className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all ${
                                    (activeStep.imageParams?.quality || 'standard') === quality
                                      ? 'bg-green-50 text-green-700 shadow-sm ring-1 ring-green-400 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-400/70'
                                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                                  }`}
                                >
                                  {quality === 'hd' ? 'HD' : 'Standard'}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                            Variations: <span className="font-semibold text-slate-800 dark:text-slate-200">4 (locked)</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {(activeStep.imageParams?.model || 'gpt-image-2') === 'mj-v8.1' && (
                      <div className="space-y-5 rounded-xl border border-green-200 bg-green-50/50 p-4 dark:border-green-500/20 dark:bg-green-500/5">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Advanced Settings</h4>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">These Midjourney parameters are saved with the workflow and restored in Workdock.</p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          {([
                            { key: 'stylize', label: 'Stylize', hint: '--s', min: 0, max: 1000, fallback: 100 },
                            { key: 'chaos', label: 'Chaos', hint: '--chaos', min: 0, max: 100, fallback: 0 },
                            { key: 'experimental', label: 'Experimental', hint: '--exp', min: 0, max: 100, fallback: 0 },
                          ] as const).map((setting) => {
                            const value = activeStep.imageParams?.[setting.key] ?? setting.fallback;
                            return (
                              <label key={setting.key} className="space-y-2">
                                <span className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                                  <span>{setting.label} <span className="font-mono text-[10px] text-slate-400">{setting.hint}</span></span>
                                  <input
                                    type="number"
                                    min={setting.min}
                                    max={setting.max}
                                    value={value}
                                    onChange={(event) => updateImageGenerationSettings({ [setting.key]: Math.min(setting.max, Math.max(setting.min, Number(event.target.value) || 0)) })}
                                    className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-right text-xs dark:border-slate-700 dark:bg-slate-900"
                                  />
                                </span>
                                <input
                                  type="range"
                                  min={setting.min}
                                  max={setting.max}
                                  value={value}
                                  onChange={(event) => updateImageGenerationSettings({ [setting.key]: Number(event.target.value) })}
                                  className="w-full accent-green-500"
                                />
                              </label>
                            );
                          })}

                          <label className="space-y-2">
                            <span className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                              <span>Seed <span className="font-mono text-[10px] text-slate-400">--seed</span></span>
                              <span className="text-[10px] text-slate-400">Blank = random</span>
                            </span>
                            <input
                              type="number"
                              min="0"
                              max="4294967295"
                              value={activeStep.imageParams?.seed || ''}
                              onChange={(event) => updateImageGenerationSettings({ seed: event.target.value })}
                              placeholder="Random"
                              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                            />
                          </label>
                        </div>

                        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
                          <div>
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Raw Mode <span className="font-mono text-[10px] text-slate-400">--raw</span></p>
                            <p className="text-[11px] text-slate-500">Reduce automatic styling for closer prompt adherence.</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={activeStep.imageParams?.raw ?? false}
                            onChange={(event) => updateImageGenerationSettings({ raw: event.target.checked })}
                            className="h-4 w-4 cursor-pointer accent-green-500"
                          />
                        </label>

                        <div className="space-y-3 border-t border-green-200 pt-4 dark:border-green-500/20">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Reference Images</p>
                              <p className="text-[11px] text-slate-500">These are the same reusable images shown in Materials I Uploaded.</p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={addMjReferenceMaterial}
                              disabled={activeStep.materials.filter((material) => material.referenceRole).length >= 3}
                            >
                              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Reference
                            </Button>
                          </div>
                          <div className="space-y-3">
                            {MJ_REFERENCE_ROLES.map((role) => {
                              const material = activeStep.materials.find((item) => item.referenceRole === role.value);
                              if (!material) return null;
                              const key = role.value === 'image' ? 'imageWeight' : role.value === 'style' ? 'styleWeight' : 'omniWeight';
                              const min = role.value === 'omni' ? 1 : 0;
                              const max = role.value === 'image' ? 3 : 1000;
                              const step = role.value === 'image' ? 0.1 : 1;
                              const value = activeStep.imageParams?.[key] ?? (role.value === 'image' ? 1 : 100);
                              return (
                                <div key={role.value} className="rounded-lg border border-green-200 bg-white p-3 dark:border-green-500/20 dark:bg-slate-900">
                                  <div className="flex items-center gap-3">
                                    <label htmlFor={`material-upload-${material.id}`} className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-green-300 bg-green-50 dark:border-green-500/30 dark:bg-green-500/10">
                                      {material.url
                                        ? <img src={material.url} alt={role.label} className="h-full w-full object-cover" />
                                        : <Plus className="h-5 w-5 text-green-600" />}
                                    </label>
                                    <div className="min-w-0 flex-1">
                                      <div className="mb-2 flex items-center justify-between">
                                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{role.label} <span className="font-mono text-[10px] text-green-600">{role.flag}</span></span>
                                        <button type="button" onClick={() => removeMaterial(material.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label={`Remove ${role.label}`}><Trash2 className="h-3.5 w-3.5" /></button>
                                      </div>
                                      <label className="flex items-center gap-3">
                                        <input
                                          type="range"
                                          min={min}
                                          max={max}
                                          step={step}
                                          value={value}
                                          onChange={(event) => updateImageGenerationSettings({ [key]: Number(event.target.value) })}
                                          className="flex-1 accent-green-500"
                                        />
                                        <span className="w-12 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">{value}</span>
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isAdminTemplateMode && (
                  <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 dark:border-purple-500/20 dark:bg-purple-500/5">
                    <div className="mb-3">
                      <div className="text-sm font-semibold text-purple-950 dark:text-purple-100">Settings available to Quick Use</div>
                      <div className="mt-1 text-xs text-purple-700 dark:text-purple-300">
                        Derived from the Capability Registry. The current workflow values are the template defaults.
                      </div>
                    </div>
                    {settingCandidates.filter((candidate) => candidate.stepId === activeStep.id).length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {settingCandidates
                          .filter((candidate) => candidate.stepId === activeStep.id)
                          .map((candidate) => (
                            <div
                              key={candidate.id}
                              className="rounded-lg border border-purple-100 bg-white px-3 py-2.5 dark:border-purple-500/15 dark:bg-slate-900/70"
                            >
                              <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{candidate.label}</div>
                              <div className="mt-0.5 text-[11px] text-slate-500">
                                {candidate.parameterType} · Default: {candidate.defaultValue === undefined ? 'None' : String(candidate.defaultValue)}
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="text-xs text-purple-700 dark:text-purple-300">This capability exposes no editable settings.</div>
                    )}
                    {!quickUseCandidates.valid && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                        {quickUseCandidates.issues[0]?.message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Final Result Preview Modal */}
      <Modal
        isOpen={showFinalResultPreview && Boolean(finalResult)}
        onClose={() => setShowFinalResultPreview(false)}
        title="Final Result Preview"
        className="max-w-5xl"
      >
        <div className="flex min-h-64 items-center justify-center rounded-xl bg-slate-100 p-3 dark:bg-slate-950 sm:p-5">
          {finalResult && finalResultType === 'video' ? (
            <video
              src={finalResult}
              className="max-h-[76vh] max-w-full rounded-lg"
              controls
              autoPlay
              playsInline
              preload="metadata"
            />
          ) : finalResult ? (
            <img
              src={finalResult}
              alt="Final result preview"
              className="max-h-[76vh] max-w-full rounded-lg object-contain"
            />
          ) : null}
        </div>
      </Modal>

      {/* Material Preview Modal */}
      <Modal
        isOpen={Boolean(previewMaterial?.url)}
        onClose={() => setPreviewMaterial(null)}
        title={`${previewMaterial?.type || 'Material'} Preview`}
        className="max-w-4xl"
      >
        <div className="flex min-h-48 items-center justify-center rounded-xl bg-slate-100 p-3 dark:bg-slate-950 sm:p-5">
          {previewMaterial?.url && previewMaterial.type === 'Image' ? (
            <img
              src={previewMaterial.url}
              alt="Material preview"
              className="max-h-[72vh] max-w-full rounded-lg object-contain"
            />
          ) : previewMaterial?.url && previewMaterial.type === 'Video' ? (
            <video
              src={previewMaterial.url}
              className="max-h-[72vh] max-w-full rounded-lg"
              controls
              playsInline
              preload="metadata"
            />
          ) : previewMaterial?.url && previewMaterial.type === 'Audio' ? (
            <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-sm dark:bg-slate-900">
              <Music className="mx-auto mb-5 h-12 w-12 text-amber-500" />
              <audio src={previewMaterial.url} className="w-full" controls preload="metadata" />
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Rewards Info Modal */}
      <Modal isOpen={showRewardsModal} onClose={() => setShowRewardsModal(false)} title="Creator Rewards">
        <div className="space-y-4">
          <div className="flex items-center justify-center p-6 bg-amber-50 dark:bg-amber-900/20 rounded-xl mb-4">
            <SparklesIcon className="w-12 h-12 text-amber-500" />
          </div>
          <h4 className="text-lg font-semibold text-slate-900 dark:text-white">How rewards work</h4>
          <p className="text-slate-600 dark:text-slate-300">
            Publishing your workflow templates allows other users to quickly achieve similar results. As a thank you for contributing to the community, you'll receive rewards!
          </p>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300 list-disc pl-5">
            <li>Earn 10 credits for every user who successfully generates a result using your template.</li>
            <li>Credits are deposited to your account daily.</li>
            <li>High-quality templates with detailed prompts perform best.</li>
          </ul>
          <Button className="w-full mt-4" onClick={() => setShowRewardsModal(false)}>Got it</Button>
        </div>
      </Modal>

      {/* Dashboard History Select Modal */}
      <Modal isOpen={showHistoryModal} onClose={() => setShowHistoryModal(false)} title="Choose a Dashboard result">
        {loadingGenerations ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
            <p>Refreshing Dashboard results...</p>
          </div>
        ) : selectableGenerations.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No Dashboard results yet.</p>
            <p className="text-sm mt-2">Generate an image or video first, then return here.</p>
            <div className="mt-5 flex justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => void refreshGenerations()}>
                Refresh
              </Button>
              <Button
                variant="gradient"
                size="sm"
                onClick={() => window.open(`${window.location.origin}/#/dashboard`, '_blank')}
              >
                Open Dashboard
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto p-1 sm:grid-cols-3">
            {selectableGenerations.map((generation) => {
              const workflowGeneration = generation as WorkflowGeneration;
              const isVideo = Boolean(workflowGeneration.videoUrl);
              return (
                <button
                  key={workflowGeneration.id}
                  type="button"
                  onClick={() => handleHistorySelect(workflowGeneration)}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:border-purple-500 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="aspect-square bg-slate-100 dark:bg-slate-900">
                    {isVideo ? (
                      <video
                        src={workflowGeneration.videoUrl}
                        poster={workflowGeneration.imageUrl}
                        className="h-full w-full object-cover"
                        muted
                      />
                    ) : (
                      <img
                        src={workflowGeneration.imageUrl}
                        alt="Dashboard result"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                      {inferFeatureFromGeneration(workflowGeneration) ||
                        workflowGeneration.templateName ||
                        'Generated result'}
                    </p>
                    <p className="mt-1 truncate text-[10px] text-slate-500">
                      {workflowGeneration.prompt || 'No prompt'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      {/* Review submission modal */}
      <Modal 
        isOpen={showPublishModal}
        onClose={() => setShowPublishModal(false)}
        title="Submit Template for Review"
        className="max-w-md"
      >
        <div className="space-y-4">
            {draftIdentity && draftIdentity.versionNumber > 1 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Submitting this edit replaces the version currently waiting for review. If this template is already published, its published version stays live until the edit is approved.
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-900 dark:text-white">
                Template cover <span className="text-red-500">*</span>
              </label>
              <p className="mb-2 text-xs text-slate-500">Required. Upload the image or video shown on the template marketplace.</p>
              
              <input type="file" ref={publishFileInputRef} onChange={handlePublishCoverUpload} accept="image/*,video/*" className="hidden" />
              {publishCover ? (
                <div className="space-y-2">
                  <div 
                    className="w-full mx-auto bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden relative group cursor-pointer border border-slate-200 dark:border-slate-700 transition-[max-width,aspect-ratio] duration-200"
                    style={{
                      aspectRatio: coverAspectRatio || 3 / 4,
                      maxWidth: coverAspectRatio
                        ? coverAspectRatio > 1.15
                          ? 320
                          : coverAspectRatio >= 0.9
                            ? 260
                            : 180
                        : 180,
                    }}
                    onClick={() => publishFileInputRef.current?.click()}
                  >
                    {publishCoverType === 'video' ? (
                      <video 
                        src={publishCover} 
                        ref={videoRef}
                        className="w-full h-full object-cover" 
                        autoPlay 
                        muted 
                        onLoadedMetadata={(e) => {
                          const duration = e.currentTarget.duration;
                          if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) {
                            setCoverAspectRatio(
                              e.currentTarget.videoWidth / e.currentTarget.videoHeight,
                            );
                          }
                          const segmentStart = Math.min(
                            coverVideoStartTime,
                            Math.max(0, duration - TEMPLATE_UPLOAD_LIMITS.coverClipSeconds),
                          );
                          setCoverVideoDuration(duration);
                          if (segmentStart !== coverVideoStartTime) {
                            setCoverVideoStartTime(segmentStart);
                          }
                          e.currentTarget.currentTime = segmentStart;
                          void e.currentTarget.play().catch(() => undefined);
                        }}
                        onTimeUpdate={(e) => {
                          const video = e.currentTarget;
                          const duration = Number.isFinite(video.duration)
                            ? video.duration
                            : coverVideoDuration;
                          if (!duration) return;
                          const segmentStart = Math.min(
                            coverVideoStartTime,
                            Math.max(0, duration - TEMPLATE_UPLOAD_LIMITS.coverClipSeconds),
                          );
                          const segmentEnd = Math.min(
                            segmentStart + TEMPLATE_UPLOAD_LIMITS.coverClipSeconds,
                            duration,
                          );
                          if (
                            video.currentTime < segmentStart - 0.05 ||
                            video.currentTime >= segmentEnd - 0.02
                          ) {
                            video.currentTime = segmentStart;
                            void video.play().catch(() => undefined);
                          }
                        }}
                        onEnded={(e) => {
                          const video = e.currentTarget;
                          const segmentStart = Math.min(
                            coverVideoStartTime,
                            Math.max(
                              0,
                              video.duration - TEMPLATE_UPLOAD_LIMITS.coverClipSeconds,
                            ),
                          );
                          video.currentTime = segmentStart;
                          void video.play().catch(() => undefined);
                        }}
                      />
                    ) : (
                      <img
                        src={publishCover}
                        alt="Cover"
                        className="w-full h-full object-cover"
                        onLoad={(event) => {
                          const image = event.currentTarget;
                          if (image.naturalWidth && image.naturalHeight) {
                            setCoverAspectRatio(image.naturalWidth / image.naturalHeight);
                          }
                        }}
                      />
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-sm font-medium">Change cover</span>
                    </div>
                  </div>
                  
                  {publishCoverType === 'video' && coverVideoDuration > 0 && (
                    <div className="space-y-1 mt-3">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Cover Selection ({TEMPLATE_UPLOAD_LIMITS.coverClipSeconds}s)</span>
                        <span>
                          {coverVideoStartTime.toFixed(1)}s - {Math.min(
                            coverVideoStartTime + TEMPLATE_UPLOAD_LIMITS.coverClipSeconds,
                            coverVideoDuration,
                          ).toFixed(1)}s
                        </span>
                      </div>
                      <div 
                        className="relative h-10 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 cursor-pointer"
                        onMouseDown={(e) => {
                          if (coverVideoDuration <= TEMPLATE_UPLOAD_LIMITS.coverClipSeconds) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const updateTime = (clientX: number) => {
                            const x = clientX - rect.left;
                            const percentage = x / rect.width;
                            const targetCenter = percentage * coverVideoDuration;
                            // Ensure the 2s window doesn't go out of bounds
                            const halfClip = TEMPLATE_UPLOAD_LIMITS.coverClipSeconds / 2;
                            const targetTime = Math.max(
                              0,
                              Math.min(
                                targetCenter - halfClip,
                                coverVideoDuration - TEMPLATE_UPLOAD_LIMITS.coverClipSeconds,
                              ),
                            );
                            setCoverVideoStartTime(targetTime);
                            if (videoRef.current) {
                              videoRef.current.currentTime = targetTime;
                              void videoRef.current.play().catch(() => undefined);
                            }
                          };
                          updateTime(e.clientX);
                          
                          const handleMouseMove = (moveEvent: MouseEvent) => {
                            updateTime(moveEvent.clientX);
                          };
                          const handleMouseUp = () => {
                            document.removeEventListener('mousemove', handleMouseMove);
                            document.removeEventListener('mouseup', handleMouseUp);
                          };
                          document.addEventListener('mousemove', handleMouseMove);
                          document.addEventListener('mouseup', handleMouseUp);
                        }}
                      >
                         <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 opacity-50"></div>
                         <div 
                           className="absolute top-0 bottom-0 bg-gradient-to-r from-purple-500/30 to-pink-500/30 border-2 border-purple-500 rounded-md shadow-sm transition-colors"
                           style={{
                             left: `${(coverVideoStartTime / coverVideoDuration) * 100}%`,
                             width: `${Math.min(
                               TEMPLATE_UPLOAD_LIMITS.coverClipSeconds / coverVideoDuration * 100,
                               100,
                             )}%`
                           }}
                         >
                            <div className="absolute inset-y-0 left-0 w-1 bg-white/50 rounded-l-sm" />
                            <div className="absolute inset-y-0 right-0 w-1 bg-white/50 rounded-r-sm" />
                         </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button 
                  onClick={() => publishFileInputRef.current?.click()}
                  className="aspect-[3/4] w-full max-w-[180px] mx-auto bg-slate-50 dark:bg-slate-800/50 border-2 border-dashed border-red-200 dark:border-red-500/30 rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:scale-110 transition-transform">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Add template cover</p>
                    <p className="text-xs text-slate-500 dark:text-slate-500">
                      Image up to {TEMPLATE_UPLOAD_LIMITS.coverImageBytes / (1024 * 1024)} MB or video up to {TEMPLATE_UPLOAD_LIMITS.coverVideoBytes / (1024 * 1024)} MB / {TEMPLATE_UPLOAD_LIMITS.coverVideoSeconds}s
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      Only your selected {TEMPLATE_UPLOAD_LIMITS.coverClipSeconds}s clip is compressed and uploaded.
                    </p>
                  </div>
                </button>
              )}
            </div>
            
            <div className="pt-3 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
              <Button variant="outline" onClick={() => setShowPublishModal(false)} disabled={reviewState === 'submitting'}>Cancel</Button>
              <Button
                variant="gradient"
                onClick={() => void handleConfirmPublish()}
                disabled={!publishCover || saveState === 'saving' || reviewState === 'submitting'}
              >
                {reviewState === 'submitting' || saveState === 'saving'
                  ? 'Submitting...'
                  : 'Submit for review'}
              </Button>
            </div>
        </div>
      </Modal>
      <AuthGateModal
        isOpen={showAuthGate}
        onClose={() => setShowAuthGate(false)}
        destination={`/templates/create${location.search}`}
        title="Sign up to save this workflow"
        description="You can explore the full builder without an account. Create a free account when you are ready to save or submit your template."
      />
      <p className="text-center text-[10px] text-slate-300 dark:text-slate-700 py-2 select-all">Build: 2026-07-18-M5-7</p>
    </div>
  );
};

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  );
}
