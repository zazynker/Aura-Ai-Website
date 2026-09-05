import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, Plus, Video, Image as ImageIcon, Music, History, GripVertical, Info, Download, Trash2, ArrowRight, RefreshCw, Upload, Maximize2, MessageSquare } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useStore } from '../context/StoreContext';
import type { Generation } from '../types';
import type { WorkflowCapabilityKey } from '../workflows/types';
import {
  assignBuilderMaterialInputSlots,
  BUILDER_FEATURE_TO_CAPABILITY,
  convertAndValidateBuilderWorkflow,
  getBuilderMaterialInputSlots,
  type BuilderDraftStep as WorkflowStep,
  type BuilderFeatureType as FeatureType,
  type BuilderInputSelection,
  type BuilderMaterial as Material,
} from '../workflows/builderAdapter';
import {
  loadTemplateDraft,
  saveTemplateDraft,
  submitTemplateForReview,
  type PersistedMaterialMap,
  type PersistedResultMap,
  type PersistedResultPosterMap,
  type PersistedTimelineAssetMap,
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
import { getWorkflowInputPromptToken } from '../workflows/promptInputTokens';
import {
  deriveQuickUseCandidates,
  createQuickUseCandidateId,
} from '../workflows/quickUseCandidates';
import {
  addQuickUsePromptVariable,
  createEmptyQuickUseDefinition,
  removeQuickUsePromptVariable,
  setQuickUseMaterialReplaceable,
  updateQuickUsePromptVariable,
  withQuickUseDefaults,
} from '../workflows/quickUseAuthoring';
import type {
  QuickUseDefinition,
  QuickUseDialogueDefinition,
  QuickUsePromptInputKind,
  QuickUseSettingCandidate,
} from '../workflows/quickUseTypes';
import {
  createDefaultTimelineDefinition,
  createTimelineAssetKey,
  QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS,
  QUICK_USE_TIMELINE_MAX_DURATION_SCALE,
  QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS,
  QUICK_USE_TIMELINE_MIN_DURATION_SCALE,
} from '../workflows/quickUseTimeline';
import { AuthGateModal } from '../components/AuthGateModal';
import {
  compileDialoguePrompt,
  createDefaultDialogueDefinition,
  createDefaultDialogueValue,
  createDialogueDefinitionFromPrompt,
  findDialoguePromptRange,
  serializeDialogueValue,
} from '../workflows/dialoguePrompt';
import { AdminDialogueEditor } from '../components/template/AdminDialogueEditor';

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

interface DialogueAuthoringDraft {
  definition: QuickUseDialogueDefinition;
  existingVariableKey?: string;
  selectionStart: number;
  selectionEnd: number;
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

const isVideoFeature = (feature: FeatureType): boolean =>
  VIDEO_FEATURES.includes(feature);

const isAudioFeature = (feature: FeatureType): boolean => feature === 'Text to Speech';

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
    if (material.type !== 'Image') return material;
    const role = material.referenceRole
      || MJ_REFERENCE_ROLES.find((item) => !used.has(item.value))?.value;
    if (role) used.add(role);
    const inputSlot = role === 'image'
      ? 'image_reference'
      : role === 'style'
        ? 'style_reference'
        : role === 'omni'
          ? 'omni_reference'
          : undefined;
    return role ? { ...material, referenceRole: role, inputSlot } : material;
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

const createDefaultAudioParams = (): NonNullable<WorkflowStep['audioParams']> => ({
  voiceId: 'Wise_Woman',
  speed: 1,
  volume: 1,
  pitch: 0,
  emotion: 'neutral',
  languageBoost: 'auto',
  format: 'mp3',
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
        candidate.type.toLowerCase() === slot.assetType &&
        (candidate.inputSlot === slot.key || !candidate.inputSlot),
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
  stepId: string,
  feature: FeatureType,
  materials: Material[],
  inputBindings?: BuilderInputSelection[],
): Material[] => {
  const next = assignBuilderMaterialInputSlots(feature, materials);
  const previousStepSlots = new Set(
    (inputBindings || [])
      .filter((binding) => binding.source === 'previous_step')
      .map((binding) => binding.slot),
  );
  const requiredSlots = getBuilderMaterialInputSlots(feature).filter((slot) => (
    slot.required && !previousStepSlots.has(slot.key)
  ));
  requiredSlots.forEach((slot) => {
    if (next.some((material) => material.inputSlot === slot.key)) return;
    next.push({
      id: `material-${stableTextHash(`${stepId}:${slot.key}`)}`,
      type: slot.assetType === 'image' ? 'Image' : slot.assetType === 'video' ? 'Video' : 'Audio',
      url: null,
      allowDownload: true,
      inputSlot: slot.key,
    });
  });
  return next;
};

const createInitialStep = (): WorkflowStep => ({
  id: 'step-1',
  feature: 'Image Generation',
  resultUrl: null,
  materials: [
    {
      id: 'mat-1',
      type: 'Image',
      url: null,
      allowDownload: true,
      inputSlot: 'image_reference',
    },
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
  const [publishFlow, setPublishFlow] = useState<'review' | 'quick-use'>('review');
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
  const [timelineAssetFiles, setTimelineAssetFiles] = useState<Record<string, File>>({});
  const [persistedTimelineAssets, setPersistedTimelineAssets] = useState<PersistedTimelineAssetMap>({});
  const [timelineAssetUrls, setTimelineAssetUrls] = useState<Record<string, string>>({});
  const [promptVariableSelection, setPromptVariableSelection] = useState<PromptVariableSelection | null>(null);
  const [dialogueAuthoringDraft, setDialogueAuthoringDraft] = useState<DialogueAuthoringDraft | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultFileInputRef = useRef<HTMLInputElement>(null);
  const resultDragDepthRef = useRef(0);
  const publishFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const promptTextAreaRef = useRef<HTMLTextAreaElement>(null);
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
          materials: ensureRequiredMaterialCards(step.id, step.feature, step.materials, step.inputBindings),
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
        setQuickUseDefinition(draft.quickUseDefinition ? withQuickUseDefaults(draft.quickUseDefinition) : null);
        setPersistedTimelineAssets(draft.timelineAssets);
        setTimelineAssetUrls(draft.timelineAssetUrls);
        setTimelineAssetFiles({});
        setIsAdminTemplateMode(Boolean(user.isAdmin && draft.quickUseDefinition));
        setPromptVariableSelection(null);
        setDialogueAuthoringDraft(null);
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
    () => quickUseDefinition
      ? withQuickUseDefaults(quickUseDefinition)
      : createEmptyQuickUseDefinition(templateTitle, templateDescription),
    [quickUseDefinition, templateTitle, templateDescription],
  );
  const timelineDefinition = adminDefinition.timeline || createDefaultTimelineDefinition();
  const timelineVideoSteps = steps.filter((step) => isVideoFeature(step.feature));
  const timelineAudioSteps = steps.filter((step) => isAudioFeature(step.feature));
  const quickUseCandidates = useMemo(
    () => deriveQuickUseCandidates(workflowConversion.workflow, adminDefinition),
    [workflowConversion.workflow, adminDefinition],
  );
  const registryQuickUseCandidates = useMemo(
    () => deriveQuickUseCandidates(workflowConversion.workflow, {
      ...adminDefinition,
      // Admin needs to see every eligible registry setting in order to build
      // the allow-list. The normal derivation above remains filtered.
      editableSettings: undefined,
    }),
    [workflowConversion.workflow, adminDefinition],
  );
  const quickUseCandidateById = new Map<string, (typeof quickUseCandidates.candidates)[number]>(
    quickUseCandidates.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const exposedQuickUseStepIds = new Set(
    adminDefinition.blocks.flatMap((block) => {
      const candidate = quickUseCandidateById.get(block.candidateId);
      return candidate ? [candidate.stepId] : [];
    }),
  );
  const timelineStepLabel = (step: WorkflowStep): string => {
    const stepNumber = steps.findIndex((candidate) => candidate.id === step.id) + 1;
    const hasReplaceableMaterial = adminDefinition.replaceableMaterials.some(
      (item) => item.binding.stepId === step.id,
    );
    const hasPromptVariables = adminDefinition.promptTemplates.some(
      (template) => template.stepId === step.id && template.variables.length > 0,
    );
    const userEditable = hasReplaceableMaterial
      || hasPromptVariables
      || exposedQuickUseStepIds.has(step.id);
    return `Step ${stepNumber} · ${step.feature} · ${userEditable ? 'user-editable input' : 'template result when unchanged'}`;
  };
  const timelineVideoStepUsage = new Map<string, number>();
  timelineDefinition.videoClips.forEach((clip) => {
    if (clip.source.kind !== 'step_result') return;
    timelineVideoStepUsage.set(
      clip.source.stepId,
      (timelineVideoStepUsage.get(clip.source.stepId) || 0) + 1,
    );
  });
  const timelineAudioStepUsage = new Map<string, number>();
  timelineDefinition.audioClips.forEach((clip) => {
    if (clip.source.kind !== 'step_result') return;
    timelineAudioStepUsage.set(
      clip.source.stepId,
      (timelineAudioStepUsage.get(clip.source.stepId) || 0) + 1,
    );
  });
  const nextUnusedTimelineVideoStep = timelineVideoSteps.find(
    (step) => !timelineVideoStepUsage.has(step.id),
  );
  const nextUnusedTimelineAudioStep = timelineAudioSteps.find(
    (step) => !timelineAudioStepUsage.has(step.id),
  );
  const settingCandidates = useMemo(
    () => registryQuickUseCandidates.candidates.filter(
      (candidate): candidate is QuickUseSettingCandidate => candidate.kind === 'setting',
    ),
    [registryQuickUseCandidates.candidates],
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
  const previousStepInputOptions = activeWorkflowStep && activeCapability
    ? activeWorkflowStep.inputs.flatMap((input) => {
        if (input.source !== 'previous_step' || !input.fromStepId) return [];
        const slot = activeCapability.inputs.find((candidate) => candidate.key === input.slot);
        const upstreamStep = workflowConversion.workflow.steps.find(
          (candidate) => candidate.id === input.fromStepId,
        );
        return slot && upstreamStep ? [{ input, slot, upstreamStep }] : [];
      })
    : [];
  const inputRoutingOptions = activeWorkflowStep && activeCapability
    ? activeWorkflowStep.inputs.flatMap((input) => {
        const slot = activeCapability.inputs.find((candidate) => candidate.key === input.slot);
        if (!slot) return [];
        const upstreamSteps = workflowConversion.workflow.steps.filter((candidate) => (
          candidate.order < activeWorkflowStep.order
          && candidate.output.assetType === slot.assetType
          && slot.allowedSources.includes('previous_step')
        ));
        return [{ input, slot, upstreamSteps }];
      })
    : [];
  const previousStepSlotSignature = previousStepInputOptions
    .map(({ input }) => input.slot)
    .sort()
    .join('|');
  const previousStepSlotKeys = useMemo(
    () => new Set(previousStepSlotSignature ? previousStepSlotSignature.split('|') : []),
    [previousStepSlotSignature],
  );
  const capabilityMaterialSlots = activeCapability
    ? getBuilderMaterialInputSlots(activeStep.feature)
    : [];
  const materialSlotByKey = new Map(capabilityMaterialSlots.map((slot) => [slot.key, slot]));
  const occupiedMaterialSlotKeys = new Set(
    activeStep.materials.map((material) => material.inputSlot).filter(Boolean),
  );
  const addableMaterialSlots = capabilityMaterialSlots.filter((slot) => (
    !previousStepSlotKeys.has(slot.key) && !occupiedMaterialSlotKeys.has(slot.key)
  ));
  const getMaterialSlotOptions = (material: Material) => capabilityMaterialSlots.filter((slot) => (
    slot.assetType === material.type.toLowerCase()
    && !previousStepSlotKeys.has(slot.key)
    && (
      slot.key === material.inputSlot
      || !activeStep.materials.some((candidate) => (
        candidate.id !== material.id && candidate.inputSlot === slot.key
      ))
    )
  ));
  const canMaterialUseType = (material: Material, type: Material['type']) => {
    const assetType = type.toLowerCase();
    return capabilityMaterialSlots.some((slot) => (
      slot.assetType === assetType
      && !previousStepSlotKeys.has(slot.key)
      && (
        slot.key === material.inputSlot
        || !activeStep.materials.some((candidate) => (
          candidate.id !== material.id && candidate.inputSlot === slot.key
        ))
      )
    ));
  };
  const promptInputOptions = activeWorkflowStep && activeCapability
    ? activeCapability.inputs.filter((slot) => (
        activeWorkflowStep.inputs.some((input) => input.slot === slot.key)
      ))
    : [];
  const getPromptInputPositionLabel = (slot: (typeof promptInputOptions)[number]): string => {
    const position = promptInputOptions
      .filter((candidate) => candidate.assetType === slot.assetType)
      .findIndex((candidate) => candidate.key === slot.key) + 1;
    return `${slot.assetType.charAt(0).toUpperCase()}${slot.assetType.slice(1)} ${position}`;
  };
  const cloneActiveWorkflowInputBindings = (): BuilderInputSelection[] | undefined =>
    activeWorkflowStep?.inputs.map((input) => ({ ...input }));
  const activePromptParameterKey = activeStep.feature === 'Text to Speech' ? 'text' : 'prompt';
  const activePromptTemplate = adminDefinition.promptTemplates.find(
    (template) => template.stepId === activeStepId && template.parameterKey === activePromptParameterKey,
  );
  const promptHasConfiguredVariables = Boolean(activePromptTemplate?.variables.length);
  const detectedDialogueRange = findDialoguePromptRange(activeStep.prompt);
  const configuredDialogueVariable = activePromptTemplate?.variables.find(
    (variable) => variable.inputKind === 'dialogue',
  );

  useEffect(() => {
    if (!activeCapability || !activeWorkflowStep) return;
    const activeMaterialSlots = activeWorkflowStep.inputs.flatMap((input) => {
      if (input.source === 'previous_step') return [];
      const slot = getBuilderMaterialInputSlots(activeStep.feature).find(
        (candidate) => candidate.key === input.slot,
      );
      return slot ? [slot] : [];
    });
    const activeSlotByKey = new Map<string, (typeof activeMaterialSlots)[number]>(
      activeMaterialSlots.map((slot) => [slot.key, slot] as const),
    );
    const used = new Set<string>();
    let changed = false;
    const removedIds = new Set<string>();
    const materials = activeStep.materials.flatMap((material) => {
      if (material.inputSlot && previousStepSlotKeys.has(material.inputSlot)) {
        removedIds.add(material.id);
        changed = true;
        return [];
      }
      const currentSlot = material.inputSlot
        ? activeSlotByKey.get(material.inputSlot)
        : undefined;
      if (
        currentSlot
        && currentSlot.assetType === material.type.toLowerCase()
        && !used.has(currentSlot.key)
      ) {
        used.add(currentSlot.key);
        return [material];
      }
      const replacement = activeMaterialSlots.find((slot) => (
        slot.assetType === material.type.toLowerCase() && !used.has(slot.key)
      ));
      if (!replacement) {
        if (material.inputSlot !== undefined) changed = true;
        return [material.inputSlot === undefined ? material : { ...material, inputSlot: undefined }];
      }
      used.add(replacement.key);
      if (material.inputSlot === replacement.key) return [material];
      changed = true;
      return [{ ...material, inputSlot: replacement.key }];
    });
    activeMaterialSlots.forEach((slot) => {
      if (used.has(slot.key)) return;
      changed = true;
      used.add(slot.key);
      materials.push({
        id: `material-${stableTextHash(`${activeStep.id}:${slot.key}`)}`,
        type: slot.assetType === 'image' ? 'Image' : slot.assetType === 'video' ? 'Video' : 'Audio',
        url: null,
        allowDownload: true,
        inputSlot: slot.key,
      });
    });
    if (!changed) return;
    if (removedIds.size > 0) {
      setMaterialFiles((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => !removedIds.has(id)),
      ));
      setPersistedMaterials((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => !removedIds.has(id)),
      ));
    }
    setSteps((current) => current.map((step) => (
      step.id === activeStepId ? { ...step, materials } : step
    )));
    setSaveState('idle');
  }, [
    activeCapability,
    activeStep.feature,
    activeStep.materials,
    activeStepId,
    activeWorkflowStep,
    previousStepSlotKeys,
  ]);
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
  const activeStepResultIsAudio = activeResultGeneration
    ? activeResultGeneration.mediaType === 'audio'
    : activeStep.resultType === 'audio' || (
        !activeStep.resultType && isAudioFeature(activeStep.feature)
      );
  const selectableGenerations = generations.filter(
    (generation) =>
      isPersistedGenerationId(generation.id) &&
      Boolean(generation.imageUrl || generation.videoUrl || generation.audioUrl),
  );

  useEffect(() => {
    if (isFinalResultManual) return;
    const latestStep = [...steps].reverse().find((step) => step.resultType !== 'audio' && !isAudioFeature(step.feature));
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
  ): QuickUseDefinition => current
    ? withQuickUseDefaults(current)
    : createEmptyQuickUseDefinition(templateTitle, templateDescription);

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

  const handleQuickUseSettingChange = (
    candidate: QuickUseSettingCandidate,
    exposed: boolean,
  ) => {
    setQuickUseDefinition((current) => {
      const definition = ensureAdminDefinition(current);
      const currentBindings = definition.editableSettings === undefined
        ? settingCandidates.map((item) => item.binding)
        : definition.editableSettings;
      const matches = (binding: QuickUseSettingCandidate['binding']): boolean => (
        binding.stepId === candidate.binding.stepId
        && binding.parameterKey === candidate.binding.parameterKey
      );
      const alreadyExposed = currentBindings.some(matches);
      const editableSettings = alreadyExposed === exposed
        ? currentBindings
        : exposed
          ? [...currentBindings, candidate.binding]
          : currentBindings.filter((binding) => !matches(binding));
      const blocks = exposed
        ? definition.blocks
        : definition.blocks
            .filter((block) => block.candidateId !== candidate.id)
            .map((block, index) => ({ ...block, order: index + 1 }));
      return { ...definition, editableSettings, blocks };
    });
    setSaveState('idle');
    setBuilderError(null);
  };

  const handleInputRoutingChange = (slotKey: string, route: string) => {
    if (!activeWorkflowStep || !activeCapability) return;
    const slot = activeCapability.inputs.find((candidate) => candidate.key === slotKey);
    if (!slot) return;
    let binding: BuilderInputSelection;
    if (route.startsWith('step:')) {
      const fromStepId = route.slice('step:'.length);
      const upstreamStep = workflowConversion.workflow.steps.find((candidate) => (
        candidate.id === fromStepId
        && candidate.order < activeWorkflowStep.order
        && candidate.output.assetType === slot.assetType
      ));
      if (!upstreamStep || !slot.allowedSources.includes('previous_step')) return;
      binding = {
        slot: slot.key,
        assetType: slot.assetType,
        source: 'previous_step',
        required: slot.required,
        fromStepId: upstreamStep.id,
        outputKey: upstreamStep.output.key,
      };
    } else {
      const material = activeStep.materials.find((candidate) => candidate.inputSlot === slot.key);
      binding = material?.templateAssetId && slot.allowedSources.includes('template_asset')
        ? {
            slot: slot.key,
            assetType: slot.assetType,
            source: 'template_asset',
            required: slot.required,
            templateAssetId: material.templateAssetId,
          }
        : {
            slot: slot.key,
            assetType: slot.assetType,
            source: 'user_upload',
            required: slot.required,
          };
    }
    const bindingBySlot = new Map<string, BuilderInputSelection>(
      activeWorkflowStep.inputs.map((input) => [input.slot, { ...input } as BuilderInputSelection]),
    );
    bindingBySlot.set(slot.key, binding);
    let materials = activeStep.materials;
    if (binding.source === 'previous_step') {
      const removedIds = new Set(
        materials.filter((material) => material.inputSlot === slot.key).map((material) => material.id),
      );
      materials = materials.filter((material) => !removedIds.has(material.id));
      if (removedIds.size > 0) {
        setMaterialFiles((current) => Object.fromEntries(
          Object.entries(current).filter(([id]) => !removedIds.has(id)),
        ));
        setPersistedMaterials((current) => Object.fromEntries(
          Object.entries(current).filter(([id]) => !removedIds.has(id)),
        ));
      }
    } else if (!materials.some((material) => material.inputSlot === slot.key)) {
      materials = [...materials, {
        id: `material-${stableTextHash(`${activeStep.id}:${slot.key}`)}`,
        type: slot.assetType === 'image' ? 'Image' : slot.assetType === 'video' ? 'Video' : 'Audio',
        url: null,
        allowDownload: true,
        inputSlot: slot.key,
      }];
    }
    updateActiveStep({
      inputBindings: activeCapability.inputs.flatMap((candidate) => {
        const next = bindingBySlot.get(candidate.key);
        return next ? [next] : [];
      }),
      materials,
    });
    if (binding.source === 'previous_step') {
      setQuickUseDefinition((current) => current
        ? setQuickUseMaterialReplaceable(
            current,
            { kind: 'workflow_input', stepId: activeWorkflowStep.id, slot: slot.key },
            false,
          )
        : current);
    }
  };

  const removeOptionalInputSlot = (slotKey: string) => {
    if (!activeCapability || !activeWorkflowStep) return;
    const slot = activeCapability.inputs.find((candidate) => candidate.key === slotKey);
    if (!slot || slot.required) return;
    const removedIds = new Set(
      activeStep.materials
        .filter((material) => material.inputSlot === slotKey)
        .map((material) => material.id),
    );
    setMaterialFiles((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !removedIds.has(id)),
    ));
    setPersistedMaterials((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !removedIds.has(id)),
    ));
    updateActiveStep({
      materials: activeStep.materials.filter((material) => !removedIds.has(material.id)),
      inputBindings: activeWorkflowStep.inputs
        .filter((input) => input.slot !== slotKey)
        .map((input) => ({ ...input })),
    });
    setQuickUseDefinition((current) => current
      ? setQuickUseMaterialReplaceable(
          current,
          { kind: 'workflow_input', stepId: activeWorkflowStep.id, slot: slotKey },
          false,
        )
      : current);
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
    const inputKind: QuickUsePromptInputKind = text.trim().length > 160 ? 'textarea' : 'text';
    setPromptVariableSelection({
      stepId: activeStep.id,
      start,
      end,
      text,
      key: suggestPromptVariableKey(text, activeStep.id, start, existingKeys),
      label: text.trim().length <= 48 ? text.trim() : 'Prompt variable',
      inputKind,
      required: false,
    });
  };

  const insertPromptInputToken = (slot: string) => {
    if (promptHasConfiguredVariables) {
      addToast('error', 'Remove the configured Prompt Variables before editing this Prompt.');
      return;
    }
    const token = getWorkflowInputPromptToken(slot);
    const textarea = promptTextAreaRef.current;
    const start = textarea?.selectionStart ?? activeStep.prompt.length;
    const end = textarea?.selectionEnd ?? start;
    const before = activeStep.prompt.slice(0, start);
    const after = activeStep.prompt.slice(end);
    const leading = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const trailing = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
    const insertion = `${leading}${token}${trailing}`;
    const nextPrompt = `${before}${insertion}${after}`;
    const nextCursor = before.length + insertion.length;
    updateActiveStep({ prompt: nextPrompt });
    window.requestAnimationFrame(() => {
      promptTextAreaRef.current?.focus();
      promptTextAreaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const openStructuredDialogueEditor = () => {
    if (!isAdminTemplateMode) return;
    if (configuredDialogueVariable) {
      setDialogueAuthoringDraft({
        definition: configuredDialogueVariable.dialogue
          ? {
              characters: configuredDialogueVariable.dialogue.characters.map((character) => ({ ...character })),
              turns: configuredDialogueVariable.dialogue.turns.map((turn) => ({ ...turn })),
              allowUserRenameCharacters: configuredDialogueVariable.dialogue.allowUserRenameCharacters,
            }
          : createDialogueDefinitionFromPrompt(configuredDialogueVariable.defaultValue),
        existingVariableKey: configuredDialogueVariable.key,
        selectionStart: 0,
        selectionEnd: 0,
      });
      setPromptVariableSelection(null);
      return;
    }
    const detected = findDialoguePromptRange(activeStep.prompt);
    if (!detected && activePromptTemplate?.variables.length) {
      addToast('error', 'Add Dialogue before other Prompt Variables, or write the dialogue lines in the Prompt first.');
      return;
    }
    const selectionStart = detected?.start ?? activeStep.prompt.length;
    const selectionEnd = detected?.end ?? selectionStart;
    const selectedPrompt = activeStep.prompt.slice(selectionStart, selectionEnd);
    setPromptVariableSelection(null);
    setDialogueAuthoringDraft({
      definition: selectedPrompt.trim()
        ? createDialogueDefinitionFromPrompt(selectedPrompt)
        : createDefaultDialogueDefinition(),
      selectionStart,
      selectionEnd,
    });
  };

  const handleSaveDialogue = () => {
    if (!dialogueAuthoringDraft) return;
    try {
      const serializedDefault = serializeDialogueValue(createDefaultDialogueValue(dialogueAuthoringDraft.definition));
      const compiledDefault = compileDialoguePrompt(dialogueAuthoringDraft.definition, serializedDefault);
      if (dialogueAuthoringDraft.existingVariableKey) {
        const variableKey = dialogueAuthoringDraft.existingVariableKey;
        const updated = updateQuickUsePromptVariable(
          ensureAdminDefinition(quickUseDefinition),
          activeStep.id,
          activePromptParameterKey,
          variableKey,
          {
            label: 'Character dialogue',
            inputKind: 'dialogue',
            required: false,
            dialogue: dialogueAuthoringDraft.definition,
            defaultValue: compiledDefault,
          },
        );
        const candidateId = createQuickUseCandidateId({ kind: 'prompt_variable', stepId: activeStep.id, parameterKey: activePromptParameterKey, variableKey });
        setQuickUseDefinition({
          ...updated.definition,
          blocks: updated.definition.blocks.map((block) => block.candidateId === candidateId
            ? { ...block, defaultValue: serializedDefault }
            : block),
        });
        updateActiveStep({ prompt: updated.workflowPrompt });
      } else {
        const before = activeStep.prompt.slice(0, dialogueAuthoringDraft.selectionStart);
        const after = activeStep.prompt.slice(dialogueAuthoringDraft.selectionEnd);
        const leading = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
        const trailing = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
        const selectionStart = before.length + leading.length;
        const nextPrompt = `${before}${leading}${compiledDefault}${trailing}${after}`;
        const existingKeys = new Set<string>((activePromptTemplate?.variables || []).map((variable) => variable.key));
        const key = suggestPromptVariableKey('character dialogue', activeStep.id, selectionStart, existingKeys);
        const nextDefinition = addQuickUsePromptVariable(ensureAdminDefinition(quickUseDefinition), {
          stepId: activeStep.id,
          parameterKey: activePromptParameterKey,
          workflowPrompt: nextPrompt,
          selectionStart,
          selectionEnd: selectionStart + compiledDefault.length,
          key,
          label: 'Character dialogue',
          inputKind: 'dialogue',
          required: false,
          dialogue: dialogueAuthoringDraft.definition,
        });
        setQuickUseDefinition(nextDefinition);
        updateActiveStep({ prompt: nextPrompt });
      }
      setDialogueAuthoringDraft(null);
      setSaveState('idle');
      setBuilderError(null);
      addToast('success', 'Dialogue block saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save Dialogue.';
      setBuilderError(message);
      addToast('error', message);
    }
  };

  const handleMakePromptSelectionEditable = () => {
    if (!promptVariableSelection || promptVariableSelection.stepId !== activeStep.id) return;
    try {
      const next = addQuickUsePromptVariable(
        ensureAdminDefinition(quickUseDefinition),
        {
          stepId: activeStep.id,
          parameterKey: activePromptParameterKey,
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
    const candidateId = createQuickUseCandidateId({ kind: 'prompt_variable', stepId: activeStep.id, parameterKey: activePromptParameterKey, variableKey });
    setQuickUseDefinition((current) => {
      if (!current) return current;
      const next = removeQuickUsePromptVariable(current, activeStep.id, activePromptParameterKey, variableKey);
      return {
        ...next,
        blocks: next.blocks
          .filter((block) => block.candidateId !== candidateId)
          .map((block, index) => ({ ...block, order: index + 1 })),
      };
    });
    setPromptVariableSelection(null);
    setDialogueAuthoringDraft(null);
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

  const updateAudioSettings = (
    updates: Partial<NonNullable<WorkflowStep['audioParams']>>,
  ) => {
    updateActiveStep({
      audioParams: {
        ...createDefaultAudioParams(),
        ...activeStep.audioParams,
        ...updates,
      },
    });
  };

  const updateTimeline = (
    updater: (timeline: NonNullable<QuickUseDefinition['timeline']>) => NonNullable<QuickUseDefinition['timeline']>,
  ) => {
    setQuickUseDefinition((current) => {
      const definition = ensureAdminDefinition(current);
      return { ...definition, timeline: updater(definition.timeline || createDefaultTimelineDefinition()) };
    });
    setSaveState('idle');
  };

  const addTimelineStepClip = (assetType: 'video' | 'audio') => {
    const matchingStep = assetType === 'video'
      ? nextUnusedTimelineVideoStep
      : nextUnusedTimelineAudioStep;
    const currentCount = assetType === 'video'
      ? timelineDefinition.videoClips.length
      : timelineDefinition.audioClips.length;
    const maxCount = assetType === 'video'
      ? QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS
      : QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS;
    if (!matchingStep || currentCount >= maxCount) return;
    const id = `${assetType}-${Date.now()}`;
    const source = { kind: 'step_result' as const, stepId: matchingStep.id };
    updateTimeline((timeline) => assetType === 'video'
      ? { ...timeline, videoClips: [...timeline.videoClips, { id, source, durationScale: 1 }] }
      : { ...timeline, audioClips: [...timeline.audioClips, { id, source, startMs: 0 }] });
  };

  const addStandaloneTimelineClip = (assetType: 'video' | 'audio') => {
    const currentCount = assetType === 'video'
      ? timelineDefinition.videoClips.length
      : timelineDefinition.audioClips.length;
    const maxCount = assetType === 'video'
      ? QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS
      : QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS;
    if (currentCount >= maxCount) return;
    const id = `${assetType}-${Date.now()}`;
    const source = { kind: 'template_asset' as const, assetKey: createTimelineAssetKey(id) };
    updateTimeline((timeline) => assetType === 'video'
      ? { ...timeline, videoClips: [...timeline.videoClips, { id, source, durationScale: 1 }] }
      : { ...timeline, audioClips: [...timeline.audioClips, { id, source, startMs: 0 }] });
  };

  const setTimelineVideoDurationScale = (clipId: string, durationScale: number) => {
    const normalized = Math.min(
      QUICK_USE_TIMELINE_MAX_DURATION_SCALE,
      Math.max(QUICK_USE_TIMELINE_MIN_DURATION_SCALE, Math.round(durationScale * 100) / 100),
    );
    updateTimeline((timeline) => ({
      ...timeline,
      videoClips: timeline.videoClips.map((clip) => (
        clip.id === clipId ? { ...clip, durationScale: normalized } : clip
      )),
    }));
  };

  const setTimelineSource = (assetType: 'video' | 'audio', clipId: string, value: string) => {
    const source = value === 'template_asset'
      ? { kind: 'template_asset' as const, assetKey: createTimelineAssetKey(clipId) }
      : { kind: 'step_result' as const, stepId: value.replace(/^step:/, '') };
    updateTimeline((timeline) => assetType === 'video'
      ? { ...timeline, videoClips: timeline.videoClips.map((clip) => clip.id === clipId ? { ...clip, source } : clip) }
      : { ...timeline, audioClips: timeline.audioClips.map((clip) => clip.id === clipId ? { ...clip, source } : clip) });
  };

  const removeTimelineClip = (assetType: 'video' | 'audio', clipId: string) => {
    updateTimeline((timeline) => assetType === 'video'
      ? { ...timeline, videoClips: timeline.videoClips.filter((clip) => clip.id !== clipId) }
      : { ...timeline, audioClips: timeline.audioClips.filter((clip) => clip.id !== clipId) });
  };

  const moveTimelineVideoClip = (clipId: string, offset: -1 | 1) => {
    updateTimeline((timeline) => {
      const index = timeline.videoClips.findIndex((clip) => clip.id === clipId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= timeline.videoClips.length) return timeline;
      const videoClips = [...timeline.videoClips];
      [videoClips[index], videoClips[target]] = [videoClips[target], videoClips[index]];
      return { ...timeline, videoClips };
    });
  };

  const uploadTimelineAsset = (
    assetType: 'video' | 'audio',
    clipId: string,
    file: File,
  ) => {
    try {
      validateTemplateMaterialFile(file, assetType, `Timeline ${assetType}`);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'This timeline file is not supported.');
      return;
    }
    const assetKey = createTimelineAssetKey(clipId);
    const previousUrl = timelineAssetUrls[assetKey];
    if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
    setTimelineAssetFiles((current) => ({ ...current, [assetKey]: file }));
    setTimelineAssetUrls((current) => ({ ...current, [assetKey]: URL.createObjectURL(file) }));
    setTimelineSource(assetType, clipId, 'template_asset');
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
      inputBindings: cloneActiveWorkflowInputBindings(),
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
        inputSlot: role === 'image'
          ? 'image_reference'
          : role === 'style'
            ? 'style_reference'
            : 'omni_reference',
      }],
      inputBindings: cloneActiveWorkflowInputBindings(),
    });
  };

  const setMjReferenceRole = (materialId: string, referenceRole: 'image' | 'style' | 'omni') => {
    const inputSlot = referenceRole === 'image'
      ? 'image_reference'
      : referenceRole === 'style'
        ? 'style_reference'
        : 'omni_reference';
    updateActiveStep({
      materials: assignBuilderMaterialInputSlots(activeStep.feature, activeStep.materials.map((material) => {
        if (material.id === materialId) {
          return { ...material, type: 'Image', referenceRole, inputSlot };
        }
        return material.referenceRole === referenceRole
          ? { ...material, referenceRole: undefined, inputSlot: undefined }
          : material;
      })),
      inputBindings: cloneActiveWorkflowInputBindings(),
    });
  };

  const addMaterial = () => {
    const slot = addableMaterialSlots[0];
    if (!slot || !activeCapability || !activeWorkflowStep) return;
    const bindingBySlot = new Map<string, BuilderInputSelection>(
      activeWorkflowStep.inputs.map((input) => [input.slot, { ...input } as BuilderInputSelection]),
    );
    bindingBySlot.set(slot.key, {
      slot: slot.key,
      assetType: slot.assetType,
      source: 'user_upload',
      required: slot.required,
    });
    updateActiveStep({
      materials: [
        ...activeStep.materials,
        {
          id: `material-${stableTextHash(`${activeStep.id}:${slot.key}`)}`,
          type: slot.assetType === 'image' ? 'Image' : slot.assetType === 'video' ? 'Video' : 'Audio',
          url: null,
          allowDownload: true,
          inputSlot: slot.key,
        },
      ],
      inputBindings: activeCapability.inputs.flatMap((candidate) => {
        const binding = bindingBySlot.get(candidate.key);
        return binding ? [binding] : [];
      }),
    });
  };

  const updateMaterial = (id: string, updates: Partial<Material>) => {
    const materials = activeStep.materials.map((material) => {
      if (material.id !== id) return material;
      const typeChanged = Boolean(updates.type && updates.type !== material.type);
      return {
        ...material,
        ...updates,
        ...(typeChanged ? { inputSlot: undefined, referenceRole: undefined } : {}),
      };
    });
    const assignedMaterials = assignBuilderMaterialInputSlots(activeStep.feature, materials);
    let inputBindings = cloneActiveWorkflowInputBindings();
    const updatedMaterial = assignedMaterials.find((material) => material.id === id);
    if (updates.url && updatedMaterial?.inputSlot && activeCapability && activeWorkflowStep) {
      const slot = activeCapability.inputs.find((candidate) => candidate.key === updatedMaterial.inputSlot);
      if (slot) {
        const bindingBySlot = new Map<string, BuilderInputSelection>(
          activeWorkflowStep.inputs.map((input) => [input.slot, { ...input } as BuilderInputSelection]),
        );
        bindingBySlot.set(slot.key, {
          slot: slot.key,
          assetType: slot.assetType,
          source: 'user_upload',
          required: slot.required,
        });
        inputBindings = activeCapability.inputs.flatMap((candidate) => {
          const binding = bindingBySlot.get(candidate.key);
          return binding ? [binding] : [];
        });
      }
    }
    updateActiveStep({ materials: assignedMaterials, inputBindings });
  };

  const setMaterialInputSlot = (materialId: string, inputSlot: string) => {
    if (!activeCapability || !activeWorkflowStep || previousStepSlotKeys.has(inputSlot)) return;
    const targetSlot = activeCapability.inputs.find((slot) => slot.key === inputSlot);
    if (!targetSlot) return;
    const previousSlot = activeStep.materials.find((material) => material.id === materialId)?.inputSlot;
    const materials = activeStep.materials.map((material) => {
      if (material.id === materialId) return { ...material, inputSlot };
      return material.inputSlot === inputSlot
        ? { ...material, inputSlot: undefined }
        : material;
    });
    const bindingBySlot = new Map<string, BuilderInputSelection>(
      activeWorkflowStep.inputs.map((input) => [input.slot, { ...input } as BuilderInputSelection]),
    );
    if (previousSlot && previousSlot !== inputSlot) {
      const previousDefinition = activeCapability.inputs.find((slot) => slot.key === previousSlot);
      if (previousDefinition && !previousDefinition.required) bindingBySlot.delete(previousSlot);
    }
    bindingBySlot.set(inputSlot, {
      slot: inputSlot,
      assetType: targetSlot.assetType,
      source: 'user_upload',
      required: targetSlot.required,
    });
    updateActiveStep({
      materials,
      inputBindings: activeCapability.inputs.flatMap((candidate) => {
        const binding = bindingBySlot.get(candidate.key);
        return binding ? [binding] : [];
      }),
    });
  };

  const removeMaterial = (id: string) => {
    const removedMaterial = activeStep.materials.find((material) => material.id === id);
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
    const removedSlot = removedMaterial?.inputSlot
      ? materialSlotByKey.get(removedMaterial.inputSlot)
      : undefined;
    const inputBindings = cloneActiveWorkflowInputBindings()?.flatMap((binding) => {
      if (removedMaterial?.inputSlot !== binding.slot) return [binding];
      if (removedSlot && !removedSlot.required) return [];
      return [{
        slot: binding.slot,
        assetType: binding.assetType,
        source: 'user_upload' as const,
        required: binding.required,
      }];
    });
    updateActiveStep({
      materials: activeStep.materials.filter(m => m.id !== id),
      inputBindings,
    });
    if (removedMaterial?.inputSlot && activeWorkflowStep && removedSlot && !removedSlot.required) {
      setQuickUseDefinition((current) => current
        ? setQuickUseMaterialReplaceable(
            current,
            { kind: 'workflow_input', stepId: activeWorkflowStep.id, slot: removedMaterial.inputSlot! },
            false,
          )
        : current);
    }
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
    updateMaterial(materialId, {
      url: URL.createObjectURL(file),
      templateAssetId: undefined,
      sourceGenerationId: undefined,
    });
  };

  const applyStepResultFile = (file: File) => {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      addToast('error', 'Please choose an image, video, or audio file.');
      return;
    }
    const resultType = file.type.startsWith('video/')
      ? 'video' as const
      : file.type.startsWith('audio/')
        ? 'audio' as const
        : 'image' as const;
    try {
      validateTemplateMaterialFile(file, resultType, 'Step result');
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

    if (!isFinalResultManual && resultType !== 'audio' && activeStep.id === steps[steps.length - 1]?.id) {
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
    const resultUrl = generation.audioUrl || generation.videoUrl || generation.imageUrl;
    if (!resultUrl) {
      addToast('error', 'This Dashboard result has no usable image, video, or audio.');
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
      inputSlot: asset.key,
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
    const parameterPrompt = generation.generationParameters?.prompt ?? generation.generationParameters?.text;
    const parameterDuration = generation.generationParameters?.duration;
    const parameterResolution = generation.generationParameters?.resolution;
    const parameterGenerateAudio = generation.generationParameters?.generateAudio;
    const parameterRatio = generation.generationParameters?.ratio;
    const imageModel = getGenerationImageModel(generation.generationParameters);

    const nextFeature: FeatureType = feature ?? (
      generation.audioUrl || generation.mediaType === 'audio'
        ? 'Text to Speech'
        : generation.videoUrl || generation.mediaType === 'video'
        ? 'Image to Video'
        : 'Image Generation'
    );
    const requiredMaterials = ensureRequiredMaterialCards(activeStep.id, nextFeature, restoredMaterials);
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
    const nextAudioParams = nextFeature === 'Text to Speech'
      ? {
          ...createDefaultAudioParams(),
          voiceId: String(generation.generationParameters?.voiceId || 'Wise_Woman'),
          speed: getGenerationNumber(generation.generationParameters?.speed, 1),
          volume: getGenerationNumber(generation.generationParameters?.volume, 1),
          pitch: getGenerationNumber(generation.generationParameters?.pitch, 0),
          emotion: (generation.generationParameters?.emotion || 'neutral') as NonNullable<WorkflowStep['audioParams']>['emotion'],
          languageBoost: String(generation.generationParameters?.languageBoost || 'auto'),
          format: generation.generationParameters?.format === 'flac' ? 'flac' as const : 'mp3' as const,
        }
      : undefined;
    const nextStep: WorkflowStep = {
      ...activeStep,
      resultUrl,
      resultType: generation.audioUrl && resultUrl === generation.audioUrl
        ? 'audio'
        : generation.videoUrl && resultUrl === generation.videoUrl ? 'video' : 'image',
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
      audioParams: nextAudioParams,
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
    if (!isFinalResultManual && nextStep.resultType !== 'audio' && activeStep.id === steps[steps.length - 1]?.id) {
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
    setPublishFlow('review');
    setShowPublishModal(true);
  };

  const handleContinueToQuickUse = () => {
    if (!user) {
      setShowAuthGate(true);
      return;
    }
    setBuilderError(null);
    setPublishFlow('quick-use');
    setShowPublishModal(true);
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
    // Saving or viewing a template must not create paid Fal thumbnail jobs.
    // Persist an existing provider poster when available; otherwise the UI
    // uses its neutral video placeholder.
    const stepsForSave = steps;
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
        timelineAssetFiles,
        persistedTimelineAssets,
      });
      setDraftIdentity(saved.identity);
      setPersistedCover(saved.cover);
      setPersistedFinalResult(saved.finalResult);
      setPersistedFinalResultPoster(saved.finalResultPoster);
      setPersistedResults(saved.results);
      setPersistedResultPosters(saved.resultPosters);
      setPersistedMaterials(saved.materials);
      setQuickUseDefinition(saved.quickUseDefinition);
      setPersistedTimelineAssets(saved.timelineAssets);
      setTimelineAssetFiles({});
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
      if (publishFlow === 'review') setReviewState('failed');
      addToast('error', publishFlow === 'quick-use'
        ? 'Add a template cover before continuing to Quick Use.'
        : 'A template cover is required before submitting for review.');
      return;
    }
    if (publishFlow === 'quick-use') {
      const savedIdentity = await handleSaveDraft(false);
      if (!savedIdentity) return;
      setShowPublishModal(false);
      navigate(`/admin/templates/${savedIdentity.templateId}/quick-use`);
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
                {adminDefinition.editableSettings?.length ?? settingCandidates.length} editable settings
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
                    (Choose from Dashboard or upload a local image/video/audio)
                  </span>
                </span>
              </h3>
              <input
                ref={resultFileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                onChange={handleStepResultUpload}
                className="hidden"
                aria-label="Upload a result image, video, or audio from this device"
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
                  ) : activeStepResultIsAudio ? (
                    <div className="flex h-full w-full items-center justify-center rounded-xl bg-purple-50 px-5 dark:bg-purple-950/30">
                      <audio src={activeStep.resultUrl} className="w-full" controls onClick={(event) => event.stopPropagation()} />
                    </div>
                  ) : (
                    <img src={activeStep.resultUrl} alt="Result" className="w-full h-full object-cover rounded-xl" />
                  )
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Add a result image, video, or audio</p>
                    <p className="px-4 text-center text-xs text-slate-400">
                      Drag and drop a file here, use a saved generation, or choose one from this device.
                    </p>
                    <p className="px-4 text-center text-[11px] text-slate-400">
                      Media files up to {TEMPLATE_UPLOAD_LIMITS.materialBytes / (1024 * 1024)} MB.
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
                  'Text to Speech',
                ] as FeatureType[]).map((feature) => (
                  <button
                    key={feature}
                    onClick={() => updateActiveStep({
                      feature,
                      materials: feature === 'Text to Speech'
                        ? []
                        : ensureRequiredMaterialCards(activeStep.id, feature, activeStep.materials),
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
                      audioParams: feature === 'Text to Speech'
                        ? activeStep.feature === 'Text to Speech' && activeStep.audioParams
                          ? activeStep.audioParams
                          : createDefaultAudioParams()
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addMaterial}
                  disabled={addableMaterialSlots.length === 0}
                  title={addableMaterialSlots.length === 0 ? 'Every available workflow input is already routed or assigned.' : `Add ${addableMaterialSlots[0]?.label}`}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {addableMaterialSlots.length === 0 ? 'All inputs assigned' : 'Add Material'}
                </Button>
              </div>

              {inputRoutingOptions.length > 0 && (
                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/75 p-4 dark:border-blue-500/20 dark:bg-blue-500/5">
                  <div className="text-sm font-semibold text-blue-950 dark:text-blue-100">Workflow input routing</div>
                  <div className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                    Route each input independently. A step can merge results from several earlier branches; it is not limited to the immediately previous step.
                  </div>
                  <div className="mt-3 space-y-2">
                    {inputRoutingOptions.map(({ input, slot, upstreamSteps }) => (
                      <div
                        key={input.slot}
                        className="grid gap-2 rounded-lg border border-blue-100 bg-white px-3 py-2.5 text-sm dark:border-blue-500/15 dark:bg-slate-900/70 sm:grid-cols-[minmax(150px,0.7fr)_minmax(240px,1.3fr)] sm:items-center"
                      >
                        <div>
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{slot.label}</div>
                          <div className="text-[11px] text-slate-500">{slot.assetType} input · Step {activeWorkflowStep?.order}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={input.source === 'previous_step' && input.fromStepId
                              ? `step:${input.fromStepId}`
                              : 'material'}
                            onChange={(event) => handleInputRoutingChange(input.slot, event.target.value)}
                            className="h-10 min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 text-sm font-medium text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-blue-500/25 dark:bg-slate-950 dark:text-slate-100"
                          >
                            <option value="material">Template material / Quick Use upload</option>
                            {upstreamSteps.map((upstreamStep) => (
                              <option key={upstreamStep.id} value={`step:${upstreamStep.id}`}>
                                Step {upstreamStep.order} · {upstreamStep.title} result
                              </option>
                            ))}
                          </select>
                          {!slot.required && (
                            <button
                              type="button"
                              onClick={() => removeOptionalInputSlot(slot.key)}
                              className="rounded-lg border border-blue-200 bg-white p-2.5 text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500 dark:border-blue-500/25 dark:bg-slate-950 dark:hover:border-red-500/30 dark:hover:bg-red-500/10"
                              aria-label={`Remove optional ${slot.label} input`}
                              title={`Remove optional ${slot.label}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-blue-700 dark:text-blue-300">
                    Previous-step routes are saved as stable fromStepId bindings. Choosing Template material / Quick Use upload lets the material card or exposed Quick Use block supply that slot.
                  </p>
                </div>
              )}

              {isAdminTemplateMode && (
                <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50/70 p-4 dark:border-purple-500/20 dark:bg-purple-500/5">
                  <div className="mb-3">
                    <div className="text-sm font-semibold text-purple-950 dark:text-purple-100">Expose inputs to Quick Use</div>
                    <div className="mt-1 text-xs text-purple-700 dark:text-purple-300">
                      Checked means the end user can replace this input. Unchecked keeps the template default locked.
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
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{slot.label}</span>
                              <span className="block text-[11px] text-slate-500">
                                {slot.assetType} · {checked ? 'User can replace' : 'Fixed template default'}
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
                      {previousStepInputOptions.length > 0
                        ? 'Inputs currently routed from step results are not user uploads. Change a route to Template material / Quick Use upload if users should supply it.'
                        : 'This step has no eligible upload input yet. Add the required material or choose a capability that accepts user uploads.'}
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
                    {(!material.inputSlot || !materialSlotByKey.get(material.inputSlot)?.required) && (
                      <button
                        type="button"
                        onClick={() => removeMaterial(material.id)}
                        className="absolute top-3 right-3 z-10 rounded-lg p-1.5 text-slate-400 opacity-70 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-500/10"
                        aria-label={`Remove ${materialSlotByKey.get(material.inputSlot || '')?.label || 'material'}`}
                        title="Remove optional material"
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
                          <span className="text-xs text-slate-500">
                            {!material.url && previousStepInputOptions.some(({ input }) => input.slot === material.inputSlot)
                              ? `Override with ${material.type}`
                              : `Upload ${material.type}`}
                          </span>
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
                              disabled={!canMaterialUseType(material, type)}
                              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${material.type === type ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                              {type === 'Image' && <ImageIcon className="w-3 h-3" />}
                              {type === 'Video' && <Video className="w-3 h-3" />}
                              {type === 'Audio' && <Music className="w-3 h-3" />}
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      {getBuilderMaterialInputSlots(activeStep.feature, material.type).length > 0 && (
                        <div>
                          <label
                            htmlFor={`material-slot-${material.id}`}
                            className="mb-2 block text-xs font-medium text-slate-500 dark:text-slate-400"
                          >
                            Bind to workflow input
                          </label>
                          <select
                            id={`material-slot-${material.id}`}
                            value={material.inputSlot || ''}
                            onChange={(event) => setMaterialInputSlot(material.id, event.target.value)}
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          >
                            {!material.inputSlot && (
                              <option value="" disabled>Choose an input role</option>
                            )}
                            {getMaterialSlotOptions(material).map((slot) => (
                              <option key={slot.key} value={slot.key}>{slot.label}</option>
                            ))}
                          </select>
                          {activeCapability?.inputs.find((slot) => slot.key === material.inputSlot)?.description && (
                            <p className="mt-1.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                              {activeCapability.inputs.find((slot) => slot.key === material.inputSlot)?.description}
                            </p>
                          )}
                        </div>
                      )}

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
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Allow asset reuse</span>
                          <span className="text-xs text-slate-500">Separate from Quick Use replacement; lets others reuse this uploaded asset.</span>
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
                  {activeStep.feature === 'Modify Image' && (
                    <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-xs leading-5 text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-100">
                      <div className="font-semibold">Use the positional input tags below: Image 1, Image 2, Image 3.</div>
                      <div className="mt-1">
                        <span className="font-semibold">Image 1</span> is the first image sent to the model. For Modify Image, bind your base canvas here.
                      </div>
                      <div>
                        <span className="font-semibold">Image 2 / Image 3</span> are the next images in order and can be exposed separately to Quick Use.
                      </div>
                      <div className="mt-1 text-blue-700 dark:text-blue-200">
                        Example: Replace the woman in Image 1 with the woman from Image 2. Preserve Image 1 framing, news graphics, and text.
                      </div>
                    </div>
                  )}
                  {promptInputOptions.length > 0 && (
                    <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Insert workflow input tag</div>
                      <div className="flex flex-wrap gap-2">
                        {promptInputOptions.map((slot) => (
                          <button
                            key={slot.key}
                            type="button"
                            title={getWorkflowInputPromptToken(slot.key)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => insertPromptInputToken(slot.key)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-white px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:border-purple-400 hover:bg-purple-50 dark:border-purple-500/30 dark:bg-slate-900 dark:text-purple-200 dark:hover:bg-purple-500/10"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {slot.assetType === 'image' && <ImageIcon className="h-3.5 w-3.5" />}
                            {slot.assetType === 'video' && <Video className="h-3.5 w-3.5" />}
                            {slot.assetType === 'audio' && <Music className="h-3.5 w-3.5" />}
                            {getPromptInputPositionLabel(slot)}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                        Tags use stable workflow slots and are resolved to the matching image, video, or audio input during generation.
                      </p>
                    </div>
                  )}
                  {isAdminTemplateMode && (
                    <div className="mb-3 rounded-xl border border-purple-200 bg-purple-50/60 p-3 dark:border-purple-500/25 dark:bg-purple-500/5">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">Insert editable prompt block</div>
                      <button
                        type="button"
                        onClick={openStructuredDialogueEditor}
                        className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-white px-3 py-1.5 text-xs font-semibold text-purple-700 transition hover:border-purple-400 hover:bg-purple-50 disabled:cursor-default disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700 dark:border-purple-500/30 dark:bg-slate-900 dark:text-purple-200 dark:hover:bg-purple-500/10 dark:disabled:border-emerald-500/25 dark:disabled:bg-emerald-500/10 dark:disabled:text-emerald-200"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <MessageSquare className="h-3.5 w-3.5" />
                        {configuredDialogueVariable
                          ? 'Edit Dialogue group'
                          : detectedDialogueRange
                            ? `Configure detected dialogue (${detectedDialogueRange.lineCount} lines)`
                            : 'Add Dialogue group'}
                      </button>
                      <p className="mt-2 text-[11px] leading-4 text-purple-700/80 dark:text-purple-200/80">
                        Define the fixed character list and default turns in a dedicated editor. Character renaming is a separate permission and is off by default.
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                        Saving creates one stable Dialogue candidate and compiles it into the real Workflow Prompt used by the video model.
                      </p>
                    </div>
                  )}
                  <textarea 
                    ref={promptTextAreaRef}
                    value={activeStep.prompt}
                    onChange={(e) => updateActiveStep({ prompt: e.target.value })}
                    onSelect={handlePromptSelection}
                    readOnly={promptHasConfiguredVariables}
                    aria-describedby={promptHasConfiguredVariables ? 'prompt-variable-edit-lock' : undefined}
                    placeholder="Enter the prompt used for this step..."
                    className={`w-full h-32 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none ${promptHasConfiguredVariables ? 'cursor-not-allowed bg-slate-100 dark:bg-slate-800/70' : 'bg-white dark:bg-slate-900'}`}
                  />
                  {promptHasConfiguredVariables && (
                    <p id="prompt-variable-edit-lock" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      This Prompt is locked to keep its Prompt Variables synchronized. Edit a Dialogue group with its editor, or remove the Prompt Variables below before changing the Prompt text.
                    </p>
                  )}
                  {isAdminTemplateMode && dialogueAuthoringDraft && (
                    <div className="mt-3">
                      <AdminDialogueEditor
                        value={dialogueAuthoringDraft.definition}
                        onChange={(definition) => setDialogueAuthoringDraft((current) => current ? { ...current, definition } : current)}
                        onCancel={() => setDialogueAuthoringDraft(null)}
                        onSave={handleSaveDialogue}
                      />
                    </div>
                  )}
                  {isAdminTemplateMode && (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-purple-700 dark:text-purple-300">
                          Select text in the prompt to create a stable Prompt Variable. The workflow prompt itself remains unchanged.
                        </p>
                        {!promptVariableSelection && detectedDialogueRange && !configuredDialogueVariable && (
                          <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
                            {detectedDialogueRange.lineCount} dialogue lines are ready to configure above.
                          </span>
                        )}
                      </div>
                      {promptVariableSelection?.stepId === activeStep.id && (
                        <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 dark:border-purple-500/20 dark:bg-purple-500/5">
                          <div className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-purple-700 dark:text-purple-300">
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
                              </select>
                            </label>
                            <div className="flex items-end pb-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                              Required and collapsed/open behavior are configured later in Quick Use Builder.
                            </div>
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPromptVariableSelection(null)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleMakePromptSelectionEditable}
                            >
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
                                <div className="flex items-center gap-2">
                                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{variable.label}</div>
                                  {variable.inputKind === 'dialogue' && <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-500/15 dark:text-purple-200">Dialogue group</span>}
                                </div>
                                <div className="truncate text-[11px] text-slate-500">
                                  {`{{quick_use.${variable.key}}}`} · Default: {variable.defaultValue}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                {variable.inputKind === 'dialogue' && (
                                  <button type="button" onClick={openStructuredDialogueEditor} className="rounded-md px-2 py-1.5 text-xs font-semibold text-purple-600 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-500/10">Edit</button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemovePromptVariable(variable.key)}
                                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                                  aria-label={`Remove ${variable.label}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
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

                {activeStep.feature === 'Text to Speech' && (
                  <div className="space-y-5 rounded-xl border border-purple-200 bg-purple-50/50 p-5 dark:border-purple-500/20 dark:bg-purple-500/5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">MiniMax Speech 2.5 HD</div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">The Prompt above is the spoken text. Maximum 5,000 characters.</div>
                      </div>
                      <span className="rounded-full bg-purple-100 px-2.5 py-1 text-[10px] font-semibold text-purple-700 dark:bg-purple-500/15 dark:text-purple-200">fal.ai</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        Voice ID
                        <input
                          value={activeStep.audioParams?.voiceId || 'Wise_Woman'}
                          onChange={(event) => updateAudioSettings({ voiceId: event.target.value })}
                          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        Emotion
                        <select
                          value={activeStep.audioParams?.emotion || 'neutral'}
                          onChange={(event) => updateAudioSettings({ emotion: event.target.value as NonNullable<WorkflowStep['audioParams']>['emotion'] })}
                          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        >
                          {['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'].map((emotion) => <option key={emotion} value={emotion}>{emotion}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        Language
                        <select
                          value={activeStep.audioParams?.languageBoost || 'auto'}
                          onChange={(event) => updateAudioSettings({ languageBoost: event.target.value })}
                          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        >
                          {['auto', 'Chinese', 'English', 'Japanese', 'Korean', 'French', 'German', 'Spanish', 'Portuguese', 'Russian', 'Italian'].map((language) => <option key={language} value={language}>{language}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        Output format
                        <select
                          value={activeStep.audioParams?.format || 'mp3'}
                          onChange={(event) => updateAudioSettings({ format: event.target.value === 'flac' ? 'flac' : 'mp3' })}
                          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        >
                          <option value="mp3">MP3</option>
                          <option value="flac">FLAC</option>
                        </select>
                      </label>
                    </div>
                    {([
                      { key: 'speed', label: 'Speed', min: 0.5, max: 2, step: 0.05, fallback: 1 },
                      { key: 'volume', label: 'Volume', min: 0, max: 10, step: 0.1, fallback: 1 },
                      { key: 'pitch', label: 'Pitch', min: -12, max: 12, step: 1, fallback: 0 },
                    ] as const).map((setting) => {
                      const value = activeStep.audioParams?.[setting.key] ?? setting.fallback;
                      return (
                        <label key={setting.key} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                          <span className="mb-2 flex justify-between"><span>{setting.label}</span><span className="text-purple-600 dark:text-purple-300">{value}</span></span>
                          <input
                            type="range"
                            min={setting.min}
                            max={setting.max}
                            step={setting.step}
                            value={value}
                            onChange={(event) => updateAudioSettings({ [setting.key]: Number(event.target.value) })}
                            className="w-full accent-purple-600"
                          />
                        </label>
                      );
                    })}
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
                        Tick only the controls users may change. Unticked settings keep the workflow default and will not appear in the next-page library.
                      </div>
                    </div>
                    {settingCandidates.filter((candidate) => candidate.stepId === activeStep.id).length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {settingCandidates
                          .filter((candidate) => candidate.stepId === activeStep.id)
                          .map((candidate) => {
                            const checked = adminDefinition.editableSettings === undefined
                              || adminDefinition.editableSettings.some((binding) => (
                                binding.stepId === candidate.binding.stepId
                                && binding.parameterKey === candidate.binding.parameterKey
                              ));
                            return (
                            <label
                              key={candidate.id}
                              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${checked
                                ? 'border-purple-300 bg-white dark:border-purple-500/35 dark:bg-slate-900/70'
                                : 'border-slate-200 bg-slate-50/70 opacity-70 dark:border-slate-700 dark:bg-slate-950/50'}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => handleQuickUseSettingChange(candidate, event.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-purple-600"
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{candidate.label}</div>
                                <div className="mt-0.5 text-[11px] text-slate-500">
                                  {candidate.parameterType} · Template default: {candidate.defaultValue === undefined ? 'None' : String(candidate.defaultValue)}
                                </div>
                              </div>
                            </label>
                            );
                          })}
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

                {isAdminTemplateMode && (
                  <div className="space-y-5 rounded-xl border border-cyan-200 bg-cyan-50/60 p-5 dark:border-cyan-500/20 dark:bg-cyan-500/5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-cyan-950 dark:text-cyan-100">Final timeline · video + multi-track audio</div>
                        <div className="mt-1 max-w-2xl text-xs leading-5 text-cyan-800/80 dark:text-cyan-200/80">
                          This is the single final-assembly configuration for new templates. Video rows are joined in order, their original sound is preserved, and every audio row is mixed on top at its start time.
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-semibold text-cyan-900 dark:text-cyan-100">
                        <input
                          type="checkbox"
                          checked={timelineDefinition.enabled}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            setQuickUseDefinition((current) => {
                              const definition = ensureAdminDefinition(current);
                              const currentTimeline = definition.timeline || createDefaultTimelineDefinition();
                              const migratedVideoClips = enabled
                                && currentTimeline.videoClips.length === 0
                                && Boolean(definition.finalVideo?.enabled)
                                ? (definition.finalVideo?.stepIds || []).map((stepId, index) => ({
                                    id: `legacy-video-${index + 1}-${stepId.replace(/[^a-z0-9_-]/gi, '_')}`,
                                    source: { kind: 'step_result' as const, stepId },
                                    durationScale: 1,
                                  }))
                                : currentTimeline.videoClips;
                              return {
                                ...definition,
                                timeline: { ...currentTimeline, enabled, videoClips: migratedVideoClips },
                                finalVideo: enabled && definition.finalVideo
                                  ? { ...definition.finalVideo, enabled: false }
                                  : definition.finalVideo,
                              };
                            });
                            setSaveState('idle');
                          }}
                          className="h-4 w-4 accent-cyan-600"
                        />
                        Enable final assembly
                      </label>
                    </div>

                    {!timelineDefinition.enabled && adminDefinition.finalVideo?.enabled && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                        This draft still uses the legacy video-only Merge. It cannot include Audio steps. Enable final assembly above to migrate its selected video steps and activate the audio rows below.
                      </div>
                    )}

                    <div className="flex gap-2 rounded-lg border border-cyan-200 bg-white/70 px-3 py-2.5 text-xs leading-5 text-cyan-950 dark:border-cyan-500/20 dark:bg-slate-900/60 dark:text-cyan-100">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600" />
                      <span><strong>Fixed versus user-generated is configured on the workflow step, not in this timeline.</strong> The timeline chooses the final video order and which audio outputs are actually mixed into the result.</span>
                    </div>

                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Video sequence · {timelineDefinition.videoClips.length}/{QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS}</div>
                          <div className="mt-1 text-[11px] text-slate-500">Rows play from top to bottom. Original video sound stays on. Duration × applies only to the final assembled copy.</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addTimelineStepClip('video')}
                            disabled={!nextUnusedTimelineVideoStep || timelineDefinition.videoClips.length >= QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS}
                            title={nextUnusedTimelineVideoStep ? `Add ${timelineStepLabel(nextUnusedTimelineVideoStep)}` : 'Every video-producing workflow step is already used'}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />{nextUnusedTimelineVideoStep ? `Next unused step (${steps.findIndex((step) => step.id === nextUnusedTimelineVideoStep.id) + 1})` : 'All video steps added'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addStandaloneTimelineClip('video')}
                            disabled={timelineDefinition.videoClips.length >= QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />Standalone video
                          </Button>
                        </div>
                      </div>
                      {timelineDefinition.videoClips.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-cyan-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-cyan-500/20">Add the next unused workflow step, or add a standalone uploaded video that is not represented by a step.</div>
                      ) : timelineDefinition.videoClips.map((clip, index) => {
                        const assetKey = clip.source.kind === 'template_asset' ? clip.source.assetKey : createTimelineAssetKey(clip.id);
                        const fixedUrl = timelineAssetUrls[assetKey];
                        const usageCount = clip.source.kind === 'step_result'
                          ? timelineVideoStepUsage.get(clip.source.stepId) || 0
                          : 0;
                        return (
                          <div key={clip.id} className="grid gap-3 rounded-lg border border-cyan-100 bg-white p-3 dark:border-cyan-500/15 dark:bg-slate-900/70 sm:grid-cols-[3rem_1fr_auto] sm:items-center">
                            <div className="text-center text-sm font-bold text-cyan-700">{index + 1}</div>
                            <div className="space-y-2">
                              <select
                                value={clip.source.kind === 'step_result' ? `step:${clip.source.stepId}` : 'template_asset'}
                                onChange={(event) => setTimelineSource('video', clip.id, event.target.value)}
                                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                              >
                                <option value="template_asset">Standalone uploaded video · not a workflow step</option>
                                <optgroup label="Workflow step outputs">
                                  {timelineVideoSteps.map((step) => {
                                    const usedElsewhere = (timelineVideoStepUsage.get(step.id) || 0)
                                      - (clip.source.kind === 'step_result' && clip.source.stepId === step.id ? 1 : 0);
                                    return <option key={step.id} value={`step:${step.id}`}>{timelineStepLabel(step)}{usedElsewhere > 0 ? ` · already used ${usedElsewhere}× elsewhere` : ''}</option>;
                                  })}
                                </optgroup>
                              </select>
                              {clip.source.kind === 'step_result' && (
                                <div className={`text-[11px] ${usageCount > 1 ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
                                  {usageCount > 1
                                    ? `This same step output appears ${usageCount} times in the final video.`
                                    : 'This position follows the selected workflow step output; it does not upload another fixed file.'}
                                </div>
                              )}
                              {clip.source.kind === 'template_asset' && (
                                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-cyan-200 p-2 text-xs text-cyan-700 dark:border-cyan-500/25 dark:text-cyan-200">
                                  {fixedUrl ? <video src={fixedUrl} className="h-10 w-16 rounded object-cover" muted /> : <Upload className="h-4 w-4" />}
                                  <span>{fixedUrl ? 'Replace standalone video' : 'Upload standalone video'}</span>
                                  <input type="file" accept="video/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadTimelineAsset('video', clip.id, file); event.target.value = ''; }} />
                                </label>
                              )}
                              <label className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                                <span className="font-semibold">Final duration ×</span>
                                <input
                                  type="number"
                                  min={QUICK_USE_TIMELINE_MIN_DURATION_SCALE}
                                  max={QUICK_USE_TIMELINE_MAX_DURATION_SCALE}
                                  step={0.05}
                                  value={clip.durationScale ?? 1}
                                  onChange={(event) => setTimelineVideoDurationScale(
                                    clip.id,
                                    Number(event.target.value) || 1,
                                  )}
                                  className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                                />
                                <span>
                                  {(clip.durationScale ?? 1) === 1
                                    ? 'Normal speed'
                                    : `${Math.round(100 / (clip.durationScale ?? 1))}% playback speed · source result unchanged`}
                                </span>
                              </label>
                            </div>
                            <div className="flex items-center justify-end gap-1">
                              <button type="button" onClick={() => moveTimelineVideoClip(clip.id, -1)} disabled={index === 0} className="rounded px-2 py-1 text-xs disabled:opacity-30">↑</button>
                              <button type="button" onClick={() => moveTimelineVideoClip(clip.id, 1)} disabled={index === timelineDefinition.videoClips.length - 1} className="rounded px-2 py-1 text-xs disabled:opacity-30">↓</button>
                              <button type="button" onClick={() => removeTimelineClip('video', clip.id)} className="rounded p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-3 border-t border-cyan-200 pt-4 dark:border-cyan-500/20">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Audio overlays · {timelineDefinition.audioClips.length}/{QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS}</div>
                          <div className="mt-1 text-[11px] text-slate-500">Each row is mixed over the video from its start time.</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addTimelineStepClip('audio')}
                            disabled={!nextUnusedTimelineAudioStep || timelineDefinition.audioClips.length >= QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS}
                            title={nextUnusedTimelineAudioStep ? `Add ${timelineStepLabel(nextUnusedTimelineAudioStep)}` : 'Every audio-producing workflow step is already used'}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />{nextUnusedTimelineAudioStep ? `Next unused step (${steps.findIndex((step) => step.id === nextUnusedTimelineAudioStep.id) + 1})` : 'All audio steps added'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addStandaloneTimelineClip('audio')}
                            disabled={timelineDefinition.audioClips.length >= QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />Standalone audio
                          </Button>
                        </div>
                      </div>
                      {timelineDefinition.audioClips.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-cyan-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-cyan-500/20">Optional: use a Text to Speech step output, or upload standalone narration or music that has no workflow step.</div>
                      ) : timelineDefinition.audioClips.map((clip) => {
                        const assetKey = clip.source.kind === 'template_asset' ? clip.source.assetKey : createTimelineAssetKey(clip.id);
                        const fixedUrl = timelineAssetUrls[assetKey];
                        const usageCount = clip.source.kind === 'step_result'
                          ? timelineAudioStepUsage.get(clip.source.stepId) || 0
                          : 0;
                        return (
                          <div key={clip.id} className="grid gap-3 rounded-lg border border-cyan-100 bg-white p-3 dark:border-cyan-500/15 dark:bg-slate-900/70 sm:grid-cols-[1fr_9rem_auto] sm:items-start">
                            <div className="space-y-2">
                              <select
                                value={clip.source.kind === 'step_result' ? `step:${clip.source.stepId}` : 'template_asset'}
                                onChange={(event) => setTimelineSource('audio', clip.id, event.target.value)}
                                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                              >
                                <option value="template_asset">Standalone uploaded audio · not a workflow step</option>
                                <optgroup label="Workflow step outputs">
                                  {timelineAudioSteps.map((step) => {
                                    const usedElsewhere = (timelineAudioStepUsage.get(step.id) || 0)
                                      - (clip.source.kind === 'step_result' && clip.source.stepId === step.id ? 1 : 0);
                                    return <option key={step.id} value={`step:${step.id}`}>{timelineStepLabel(step)}{usedElsewhere > 0 ? ` · already used ${usedElsewhere}× elsewhere` : ''}</option>;
                                  })}
                                </optgroup>
                              </select>
                              {clip.source.kind === 'step_result' && (
                                <div className={`text-[11px] ${usageCount > 1 ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
                                  {usageCount > 1
                                    ? `This same audio step output is mixed ${usageCount} times.`
                                    : 'This track follows the selected audio step output.'}
                                </div>
                              )}
                              {clip.source.kind === 'template_asset' && (
                                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-cyan-200 p-2 text-xs text-cyan-700 dark:border-cyan-500/25 dark:text-cyan-200">
                                  <Music className="h-4 w-4" />
                                  <span>{fixedUrl ? 'Replace standalone audio' : 'Upload standalone audio'}</span>
                                  {fixedUrl && <audio src={fixedUrl} className="h-8 max-w-48" controls onClick={(event) => event.preventDefault()} />}
                                  <input type="file" accept="audio/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadTimelineAsset('audio', clip.id, file); event.target.value = ''; }} />
                                </label>
                              )}
                            </div>
                            <label className="text-[11px] font-medium text-slate-500">
                              Start time (seconds)
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={clip.startMs / 1000}
                                onChange={(event) => updateTimeline((timeline) => ({ ...timeline, audioClips: timeline.audioClips.map((item) => item.id === clip.id ? { ...item, startMs: Math.max(0, Math.round((Number(event.target.value) || 0) * 1000)) } : item) }))}
                                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                              />
                            </label>
                            <button type="button" onClick={() => removeTimelineClip('audio', clip.id)} className="rounded p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        );
                      })}
                    </div>
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
            <p className="text-sm mt-2">Generate an image, video, or audio file first, then return here.</p>
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
              const isAudio = workflowGeneration.mediaType === 'audio' || Boolean(workflowGeneration.audioUrl);
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
                    ) : isAudio ? (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-purple-50 p-4 text-purple-700 dark:bg-purple-950/30 dark:text-purple-200">
                        <span className="text-sm font-semibold">Audio</span>
                        <audio src={workflowGeneration.audioUrl || workflowGeneration.imageUrl} className="w-full" controls onClick={(event) => event.stopPropagation()} />
                      </div>
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
        title={publishFlow === 'quick-use' ? 'Add Template Cover' : 'Submit Template for Review'}
        className="max-w-md"
      >
        <div className="space-y-4">
            {publishFlow === 'review' && draftIdentity && draftIdentity.versionNumber > 1 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Submitting this edit replaces the version currently waiting for review. If this template is already published, its published version stays live until the edit is approved.
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-900 dark:text-white">
                Template cover <span className="text-red-500">*</span>
              </label>
              <p className="mb-2 text-xs text-slate-500">Required. Upload the image or video shown on the template marketplace.</p>
              {publishFlow === 'quick-use' && (
                <p className="mb-3 rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-xs leading-5 text-purple-800 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-200">
                  This cover is saved with the current template version and will be used by the Home Template card and View preview.
                </p>
              )}
              
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
                  ? (publishFlow === 'quick-use' ? 'Saving...' : 'Submitting...')
                  : (publishFlow === 'quick-use' ? 'Save cover & Continue' : 'Submit for review')}
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
