import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, Plus, Video, Image as ImageIcon, Music, History, GripVertical, Info, Download, Trash2, ArrowRight } from 'lucide-react';
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
  type TemplateDraftIdentity,
} from '../utils/templateDraftApi';
import type { UploadedTemplateCover } from '../utils/templateStorage';

type WorkflowGeneration = Generation;

type PublishGateIssue = {
  code: 'result' | 'material' | 'title' | 'workflow';
  message: string;
  stepId?: string;
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
  'Text to Image': [],
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

const hasCompleteMaterialSnapshot = (
  feature: FeatureType | null,
  materials: Material[],
): boolean => {
  if (!feature) return false;
  const remaining = [...FEATURE_REQUIRED_MATERIAL_TYPES[feature]];
  materials.forEach((material) => {
    const index = remaining.indexOf(material.type);
    if (material.url && index >= 0) remaining.splice(index, 1);
  });
  return remaining.length === 0;
};

const hasRequiredBuilderMaterials = (step: WorkflowStep): boolean => {
  const requiredTypes = FEATURE_REQUIRED_MATERIAL_TYPES[step.feature];
  return requiredTypes.length === 0
    ? step.materials.some((material) => Boolean(material.url))
    : hasCompleteMaterialSnapshot(step.feature, step.materials);
};

const createInitialStep = (): WorkflowStep => ({
  id: 'step-1',
  feature: 'Text to Image',
  resultUrl: null,
  materials: [
    { id: 'mat-1', type: 'Image', url: null, allowDownload: true },
  ],
  prompt: '',
});

const getPublishGateIssue = (
  templateTitle: string,
  steps: WorkflowStep[],
): PublishGateIssue | null => {
  const incompleteStepIndex = steps.findIndex((step) => !step.resultUrl);
  if (incompleteStepIndex >= 0) {
    return {
      code: 'result',
      stepId: steps[incompleteStepIndex].id,
      message: `Choose the Dashboard result for Step ${incompleteStepIndex + 1}.`,
    };
  }

  const missingMaterialIndex = steps.findIndex(
    (step) => !hasRequiredBuilderMaterials(step),
  );
  if (missingMaterialIndex >= 0) {
    return {
      code: 'material',
      stepId: steps[missingMaterialIndex].id,
      message: `Add every required material used in Step ${missingMaterialIndex + 1}.`,
    };
  }

  if (!templateTitle.trim()) {
    return {
      code: 'title',
      message: 'Add a template title before submitting for review.',
    };
  }

  const { validation } = convertAndValidateBuilderWorkflow(steps);
  if (!validation.valid) {
    return {
      code: 'workflow',
      message:
        validation.issues[0]?.message ||
        'Check every workflow step before submitting.',
    };
  }

  return null;
};

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
  
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  
  // Publish Modal States
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishCover, setPublishCover] = useState<string | null>(null);
  const [publishCoverFile, setPublishCoverFile] = useState<File | null>(null);
  const [publishCoverType, setPublishCoverType] = useState<'image' | 'video' | null>(null);
  const [coverVideoDuration, setCoverVideoDuration] = useState<number>(0);
  const [coverVideoStartTime, setCoverVideoStartTime] = useState<number>(0);

  const [steps, setSteps] = useState<WorkflowStep[]>([createInitialStep()]);
  const [activeStepId, setActiveStepId] = useState<string>('step-1');
  const [showRewardsModal, setShowRewardsModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [draftIdentity, setDraftIdentity] = useState<TemplateDraftIdentity | null>(null);
  const [persistedCover, setPersistedCover] = useState<UploadedTemplateCover | null>(null);
  const [materialFiles, setMaterialFiles] = useState<Record<string, File>>({});
  const [persistedMaterials, setPersistedMaterials] = useState<PersistedMaterialMap>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [reviewState, setReviewState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');
  const [draftLoadState, setDraftLoadState] = useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        setSteps(draft.steps);
        setActiveStepId(draft.steps[0]?.id || 'step-1');
        setFinalResult(draft.finalResultUrl);
        setFinalResultType(draft.finalResultType);
        setPersistedCover(draft.cover);
        setPublishCover(draft.coverUrl);
        setPublishCoverType(draft.coverType);
        setPublishCoverFile(null);
        setPersistedMaterials(draft.materials);
        setMaterialFiles({});
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
  const activeResultGeneration = generations.find(
    (generation) => generation.id === activeStep.resultGenerationId,
  );
  const activeStepResultIsVideo = activeResultGeneration
    ? Boolean(
        activeResultGeneration.videoUrl &&
          activeResultGeneration.videoUrl === activeStep.resultUrl,
      )
    : isVideoFeature(activeStep.feature);
  const selectableGenerations = generations.filter(
    (generation) =>
      isPersistedGenerationId(generation.id) &&
      Boolean(generation.imageUrl || generation.videoUrl),
  );
  const publishGateIssue = getPublishGateIssue(templateTitle, steps);

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
    if (file) {
      const url = URL.createObjectURL(file);
      setFinalResult(url);
      setFinalResultType(file.type.startsWith('video/') ? 'video' : 'image');
      setSaveState('idle');
    }
  };

  const handlePublishCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setPublishCover(url);
      setPublishCoverFile(file);
      setPersistedCover(null);
      setSaveState('idle');
      setPublishCoverType(file.type.startsWith('video/') ? 'video' : 'image');
      setCoverVideoDuration(0);
      setCoverVideoStartTime(0);
    }
  };

  const addStep = () => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      feature: 'Text to Image',
      resultUrl: null,
      materials: [{ id: `mat-${Date.now()}`, type: 'Image', url: null, allowDownload: true }],
      prompt: ''
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

  const addMaterial = () => {
    updateActiveStep({
      materials: [...activeStep.materials, { id: `mat-${Date.now()}`, type: 'Image', url: null, allowDownload: true }]
    });
  };

  const updateMaterial = (id: string, updates: Partial<Material>) => {
    updateActiveStep({
      materials: activeStep.materials.map(m => m.id === id ? { ...m, ...updates } : m)
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
      materials: activeStep.materials.filter(m => m.id !== id)
    });
  };

  const removeStep = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (steps.length === 1) return;
    const newSteps = steps.filter(s => s.id !== id);
    setSteps(newSteps);
    setSaveState('idle');
    if (activeStepId === id) {
      setActiveStepId(newSteps[0].id);
    }
  };

  const handleMaterialUpload = (materialId: string, file?: File) => {
    if (!file) return;
    setMaterialFiles((current) => ({ ...current, [materialId]: file }));
    setPersistedMaterials((current) => {
      const next = { ...current };
      delete next[materialId];
      return next;
    });
    setSaveState('idle');
    updateMaterial(materialId, { url: URL.createObjectURL(file) });
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
    if (generation.templateId === 'text-to-image') return 'Text to Image';
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

    updateActiveStep({
      resultUrl,
      resultGenerationId: generation.id,
      feature: feature ?? activeStep.feature,
      prompt:
        typeof parameterPrompt === 'string'
          ? parameterPrompt
          : generation.prompt ?? '',
      materials:
        restoredMaterials.length > 0
          ? restoredMaterials
          : activeStep.materials,
      videoParams:
        feature === 'Image to Video'
          ? {
              duration: `${
                typeof parameterDuration === 'number'
                  ? parameterDuration
                  : generation.videoDuration || 5
              }s`,
              resolution:
                typeof parameterResolution === 'string'
                  ? parameterResolution
                  : activeStep.videoParams?.resolution || '720p',
              generateAudio:
                typeof parameterGenerateAudio === 'boolean'
                  ? parameterGenerateAudio
                  : activeStep.videoParams?.generateAudio ?? true,
            }
          : activeStep.videoParams,
    });

    if (activeStep.id === steps[steps.length - 1]?.id) {
      setFinalResult(resultUrl);
      setFinalResultType(
        generation.videoUrl && resultUrl === generation.videoUrl
          ? 'video'
          : 'image',
      );
    }

    if (!hasCompleteMaterialSnapshot(feature, restoredMaterials)) {
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

  const showPublishGateIssue = (issue: PublishGateIssue) => {
    if (issue.stepId) setActiveStepId(issue.stepId);
    setBuilderError(issue.message);
    setShowPublishModal(false);
    addToast('error', issue.message);
  };

  const handleOpenPublish = () => {
    if (reviewState === 'submitted') return;
    const issue = getPublishGateIssue(templateTitle, steps);
    if (issue) return showPublishGateIssue(issue);

    setBuilderError(null);
    setShowPublishModal(true);
  };

  const handleSaveDraft = async (
    showSuccessToast = true,
  ): Promise<TemplateDraftIdentity | null> => {
    if (!user) {
      setBuilderError('Please log in before saving a template draft.');
      addToast('error', 'Please log in before saving a template draft.');
      return null;
    }

    const { workflow, validation } = convertAndValidateBuilderWorkflow(steps);
    if (!validation.valid) {
      const message =
        validation.issues[0]?.message ||
        'Check the workflow settings before saving this draft.';
      setBuilderError(message);
      addToast('error', message);
      setSaveState('failed');
      return null;
    }

    setSaveState('saving');
    setBuilderError(null);
    try {
      const saved = await saveTemplateDraft({
        identity: draftIdentity,
        userId: user.id,
        title: templateTitle,
        description: templateDescription,
        workflow,
        steps,
        finalResultUrl: finalResult,
        coverFile: publishCoverFile,
        persistedCover,
        materialFiles,
        persistedMaterials,
      });
      setDraftIdentity(saved.identity);
      setPersistedCover(saved.cover);
      setPersistedMaterials(saved.materials);
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
    const issue = getPublishGateIssue(templateTitle, steps);
    if (issue) return showPublishGateIssue(issue);

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
    steps.forEach((step) => {
      step.materials.forEach((material) => {
        if (material.url?.startsWith('blob:')) URL.revokeObjectURL(material.url);
      });
    });

    setFinalResult(null);
    setFinalResultType(null);
    setTemplateTitle('');
    setTemplateDescription('');
    setPublishCover(null);
    setPublishCoverFile(null);
    setPublishCoverType(null);
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
    setMaterialFiles({});
    setPersistedMaterials({});
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
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Build a workflow template</h1>
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
            <Button
              variant="gradient"
              size="sm"
              onClick={handleOpenPublish}
              disabled={draftLoadState === 'loading' || saveState === 'saving' || reviewState === 'submitting' || reviewState === 'submitted'}
            >
              {reviewState === 'submitted' ? 'Under review' : 'Submit for review'}
            </Button>
          </div>
        </div>
      </div>

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
                <div 
                  className="aspect-[3/4] w-full bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden relative group cursor-pointer border border-slate-200 dark:border-slate-700"
                  onClick={() => fileInputRef.current?.click()}
                >
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
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white text-sm font-medium">Change final result</span>
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
                <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center text-sm">1</span>
                <span>
                  Result from This Step
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                    (Choose from Dashboard â the fields below fill automatically)
                  </span>
                </span>
              </h3>
              <div 
                onClick={openDashboardResults}
                className={`w-full max-w-sm aspect-video bg-slate-50 dark:bg-slate-800/50 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group ${
                  builderError && publishGateIssue?.code === 'result' && publishGateIssue.stepId === activeStep.id
                    ? 'border-red-500 ring-2 ring-red-100 dark:ring-red-900/40'
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
                      <History className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Choose from Dashboard</p>
                    <p className="px-4 text-center text-xs text-slate-400">
                      This does not upload a local file. Select one of your saved generation results.
                    </p>
                  </>
                )}
              </div>
              {builderError && publishGateIssue?.code === 'result' && publishGateIssue.stepId === activeStep.id && (
                <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                  Required: choose this step's saved result from Dashboard.
                </p>
              )}
            </section>

            {/* Section 2: Feature */}
            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 flex items-center justify-center text-sm">2</span>
                Feature I Used
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  'Text to Image',
                  'Replace Product',
                  'Modify Image',
                  'Image to Video',
                  'Motion Control',
                  'Image Lip Sync',
                  'Video Lip Sync',
                ] as FeatureType[]).map((feature) => (
                  <button
                    key={feature}
                    onClick={() => updateActiveStep({ feature })}
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
             
              <div className="space-y-4">
                {activeStep.materials.map((material, idx) => (
                  <div
                    key={material.id}
                    className={`p-4 rounded-xl border bg-slate-50 dark:bg-slate-800/30 flex flex-col sm:flex-row gap-6 relative group ${
                      builderError && publishGateIssue?.code === 'material' && publishGateIssue.stepId === activeStep.id && !material.url
                        ? 'border-red-500 ring-2 ring-red-100 dark:ring-red-900/40'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
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
              {builderError && publishGateIssue?.code === 'material' && publishGateIssue.stepId === activeStep.id && (
                <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                  Required: upload or restore the material used for this step.
                </p>
              )}
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
                    placeholder="Enter the prompt used for this step..."
                    className="w-full h-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  />
                </div>

                {activeStep.feature === 'Image to Video' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30">
                    <div>
                       <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Duration</label>
                       <div className="flex gap-2">
                         {['5s', '10s'].map(dur => (
                           <button 
                             key={dur}
                             onClick={() => updateActiveStep({ videoParams: { ...activeStep.videoParams, duration: dur, resolution: activeStep.videoParams?.resolution || '1080p' } })}
                             className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${activeStep.videoParams?.duration === dur ? 'border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'}`}
                           >
                             {dur}
                           </button>
                         ))}
                       </div>
                    </div>
                    <div>
                       <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Resolution</label>
                       <div className="flex gap-2">
                         {['720p', '1080p'].map(res => (
                           <button 
                             key={res}
                             onClick={() => updateActiveStep({ videoParams: { ...activeStep.videoParams, resolution: res, duration: activeStep.videoParams?.duration || '5s' } })}
                             className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${activeStep.videoParams?.resolution === res ? 'border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'}`}
                           >
                             {res}
                           </button>
                         ))}
                       </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

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
        isOpen={showPublishModal && !publishGateIssue}
        onClose={() => setShowPublishModal(false)}
        title="Submit Template for Review"
        className="max-w-md"
      >
        <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">Template cover</label>
              <p className="text-xs text-slate-500 mb-4">Upload an image or video. This will be displayed on the template marketplace.</p>
              
              <input type="file" ref={publishFileInputRef} onChange={handlePublishCoverUpload} accept="image/*,video/*" className="hidden" />
              {publishCover ? (
                <div className="space-y-3">
                  <div 
                    className="aspect-[3/4] w-full max-w-[240px] mx-auto bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden relative group cursor-pointer border border-slate-200 dark:border-slate-700"
                    onClick={() => publishFileInputRef.current?.click()}
                  >
                    {publishCoverType === 'video' ? (
                      <video 
                        src={publishCover} 
                        ref={videoRef}
                        className="w-full h-full object-cover" 
                        autoPlay 
                        muted 
                        loop 
                        onLoadedMetadata={(e) => {
                          setCoverVideoDuration(e.currentTarget.duration);
                        }}
                      />
                    ) : (
                      <img src={publishCover} alt="Cover" className="w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-sm font-medium">Change cover</span>
                    </div>
                  </div>
                  
                  {publishCoverType === 'video' && coverVideoDuration > 0 && (
                    <div className="space-y-1 mt-3">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Cover Selection (2s)</span>
                        <span>{coverVideoStartTime.toFixed(1)}s - {Math.min(coverVideoStartTime + 2, coverVideoDuration).toFixed(1)}s</span>
                      </div>
                      <div 
                        className="relative h-10 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 cursor-pointer"
                        onMouseDown={(e) => {
                          if (coverVideoDuration <= 2) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const updateTime = (clientX: number) => {
                            const x = clientX - rect.left;
                            const percentage = x / rect.width;
                            const targetCenter = percentage * coverVideoDuration;
                            // Ensure the 2s window doesn't go out of bounds
                            const targetTime = Math.max(0, Math.min(targetCenter - 1, coverVideoDuration - 2));
                            setCoverVideoStartTime(targetTime);
                            if (videoRef.current) {
                              videoRef.current.currentTime = targetTime;
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
                             width: `${Math.min(2 / coverVideoDuration * 100, 100)}%`
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
                  className="aspect-[3/4] w-full max-w-[240px] mx-auto bg-slate-50 dark:bg-slate-800/50 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:scale-110 transition-transform">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Add template cover</p>
                    <p className="text-xs text-slate-500 dark:text-slate-500">Image or video</p>
                  </div>
                </button>
              )}
            </div>
            
            <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
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
