import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Share,
  Play,
  Pause,
  Maximize2,
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  Wand2,
  Film,
  Mic,
  X,
  Loader2,
  LockKeyhole,
  Gift,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import {
  getWorkflowTargetRoute,
  queueWorkflowHandoff,
  startWorkflow,
} from '../components/workflow/workflowManager';
import { useStore } from '../context/StoreContext';
import {
  fetchTemplateDetail,
  fetchPublicTemplateDetail,
  type RealTemplateDetail,
} from '../utils/templateDetailApi';
import { ensureTemplateResultPoster } from '../utils/templatePosterApi';
import {
  createRunIdempotencyKey,
  startTemplateRun,
} from '../utils/templateRunApi';

const getFeatureIcon = (featureName: string) => {
  if (featureName.includes('Lip Sync')) return Mic;
  if (featureName.includes('Video') || featureName.includes('Motion')) return Film;
  if (featureName.includes('Modify')) return Wand2;
  return Layers;
};

const blockVideoContextMenu = (event: React.MouseEvent<HTMLVideoElement>) => {
  event.preventDefault();
};

const formatSettingLabel = (key: string) => key
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/^./, (letter) => letter.toUpperCase());

const formatSettingValue = (value: unknown) => {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  return String(value);
};

const VideoPosterFrame: React.FC<{
  src: string;
  poster?: string;
  className?: string;
}> = ({ src, poster, className }) => {
  useEffect(() => {
    let origin: string;
    try {
      origin = new URL(src, window.location.href).origin;
    } catch {
      return;
    }
    if (origin === window.location.origin) return;
    const selector = `link[data-template-video-origin="${CSS.escape(origin)}"]`;
    if (document.head.querySelector(selector)) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    link.crossOrigin = 'anonymous';
    link.dataset.templateVideoOrigin = origin;
    document.head.appendChild(link);
    return () => link.remove();
  }, [src]);

  return (
    <div className={`relative overflow-hidden ${className || ''}`}>
      {poster ? (
        <img
          src={poster}
          alt="Video preview"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 to-black text-slate-300">
          <VideoIcon className="h-10 w-10" />
        </div>
      )}
    </div>
  );
};

export const TemplateDetail = () => {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, authLoading, addToast } = useStore();
  const [template, setTemplate] = useState<RealTemplateDetail | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<string>('');
  const [modalContent, setModalContent] = useState<{
    type: string;
    url: string;
    poster?: string;
    allowDownload?: boolean;
  } | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [startingRun, setStartingRun] = useState(false);
  const [modalVideoReady, setModalVideoReady] = useState(false);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [pendingGuestAction, setPendingGuestAction] = useState('');
  const startingRunRef = useRef(false);
  const startKeyRef = useRef<string | null>(null);
  const guestVideoRef = useRef<HTMLVideoElement | null>(null);
  const [guestVideoPlaying, setGuestVideoPlaying] = useState(false);

  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!templateId) {
      setTemplateError('No template was selected.');
      setLoadingTemplate(false);
      return;
    }

    setLoadingTemplate(true);
    setTemplateError(null);
    const detailRequest = user
      ? fetchTemplateDetail(templateId)
      : fetchPublicTemplateDetail(templateId);
    detailRequest
      .then((data) => {
        if (cancelled) return;
        setTemplate(data);
        setActiveStep(data.steps[0]?.id || '');
        setModalContent(null);
        if (
          user
          &&
          data.finalResult.type === 'video'
          && (data.finalResult.thumbnailIsFallback || !data.finalResult.thumbnail)
        ) {
          void ensureTemplateResultPoster(data.id, data.versionId).then((thumbnail) => {
            if (cancelled || !thumbnail) return;
            setTemplate((current) => {
              if (
                !current
                || current.id !== data.id
                || current.versionId !== data.versionId
              ) {
                return current;
              }
              const finalResultId = current.finalResult.id;
              return {
                ...current,
                finalResult: {
                  ...current.finalResult,
                  thumbnail,
                  thumbnailIsFallback: false,
                },
                steps: current.steps.map((step) => ({
                  ...step,
                  results: step.results.map((result) => (
                    result.id === finalResultId
                      ? { ...result, thumbnail, thumbnailIsFallback: false }
                      : result
                  )),
                })),
              };
            });
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTemplateError(error instanceof Error ? error.message : 'The template could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplate(false);
      });

    return () => {
      cancelled = true;
    };
  }, [templateId, location.key, location.search, authLoading, user?.id]);

  useEffect(() => {
    if (user) setShowAuthGate(false);
  }, [user]);

  useEffect(() => {
    setModalVideoReady(false);
  }, [modalContent?.url]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && !(document as any).webkitIsFullScreen) {
        setModalContent(null);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const detailDestination = `${location.pathname}${location.search}`;

  const openGuestGate = (action: string) => {
    if (user) return false;
    setPendingGuestAction(action);
    setShowAuthGate(true);
    return true;
  };

  const continueToAuth = (mode: 'login' | 'signup') => {
    sessionStorage.setItem('postAuthDestination', detailDestination);
    sessionStorage.setItem('postAuthAction', pendingGuestAction || 'unlock-workflow');
    sessionStorage.setItem('authEntryContext', 'template');
    navigate(`/${mode}`, {
      state: {
        from: detailDestination,
        authContext: 'template',
      },
    });
  };

  const toggleGuestVideo = () => {
    const video = guestVideoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setGuestVideoPlaying(false));
    } else {
      video.pause();
    }
  };

  const toggleAudio = (id: string, url: string) => {
    if (openGuestGate('preview-material')) return;
    if (playingAudioId === id) {
      audioRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const newAudio = new Audio(url);
      newAudio.onended = () => setPlayingAudioId(null);
      newAudio.play().catch(console.error);
      audioRef.current = newAudio;
      setPlayingAudioId(id);
    }
  };

  const handleUseTemplate = async () => {
    if (!template || template.status !== 'published') {
      addToast('info', 'This template is not published yet.');
      return;
    }
    if (!user) {
      openGuestGate('use-template');
      return;
    }
    if (startingRunRef.current) return;

    startingRunRef.current = true;
    setStartingRun(true);
    const idempotencyKey = startKeyRef.current || createRunIdempotencyKey(template.id);
    startKeyRef.current = idempotencyKey;
    try {
      const run = await startTemplateRun(template.id, idempotencyKey);
      const workflowSteps = run.steps.map((runStep, index) => {
        const savedStep = run.workflow.steps.find((step) => step.id === runStep.stepId)
          || run.workflow.steps[index];
        const detailStep = template.steps.find((step) => step.id === runStep.stepId)
          || template.steps[index];
        const referenceResult = detailStep?.results[0]
          || (index === run.steps.length - 1 ? template.finalResult : undefined);
        const reusableStepMaterials = (detailStep?.materials || [])
          .filter((material) => material.permission === 'download')
          .map((material) => {
            const matchingInput = savedStep?.inputs?.find(
              (input) => input.templateAssetId === material.id,
            );
            const sameTypeInputs = savedStep?.inputs?.filter(
              (input) => input.assetType === material.type && input.source === 'template_asset',
            ) || [];
            const sameTypeMaterialIndex = (detailStep?.materials || [])
              .filter((item) => item.permission === 'download' && item.type === material.type)
              .findIndex((item) => item.id === material.id);
            return {
              id: material.id,
              name: material.name,
              type: material.type,
              url: material.url,
              slot: typeof matchingInput?.slot === 'string'
                ? matchingInput.slot
                : typeof sameTypeInputs[sameTypeMaterialIndex]?.slot === 'string'
                  ? sameTypeInputs[sameTypeMaterialIndex].slot
                  : undefined,
            };
          });
        return {
          id: runStep.stepId,
          runStepId: runStep.id,
          stepNumber: runStep.stepOrder,
          capability: runStep.capability,
          feature: detailStep?.featureName || savedStep?.title || runStep.capability,
          targetRoute: getWorkflowTargetRoute(runStep.capability),
          reusableMaterials: reusableStepMaterials.length > 0,
          materials: reusableStepMaterials,
          prompt: detailStep?.prompt || savedStep?.instruction || '',
          settings: savedStep?.parameters || {},
          status: runStep.status,
          result: referenceResult?.url
            ? {
                type: referenceResult.type,
                url: referenceResult.url,
                thumbnail: referenceResult.thumbnail,
              }
            : undefined,
        };
      });

      startWorkflow({
        runId: run.id,
        templateId: run.templateId,
        templateVersionId: run.templateVersionId,
        status: run.status,
        steps: workflowSteps,
      });
      const firstStep = workflowSteps[0];
      if (!firstStep) throw new Error('This template has no executable steps.');
      const handoff = await queueWorkflowHandoff(firstStep, 'all');
      startKeyRef.current = null;
      addToast('success', 'Workflow started. Your progress is now saved.');
      const separator = firstStep.targetRoute.includes('?') ? '&' : '?';
      navigate(`${firstStep.targetRoute}${separator}workflowAction=all&workflowNonce=${encodeURIComponent(handoff.nonce)}`);
    } catch (error) {
      startingRunRef.current = false;
      setStartingRun(false);
      addToast(
        'error',
        error instanceof Error ? error.message : 'Could not start this workflow.',
      );
    }
  };

  const handleShare = async () => {
    if (!template || template.status !== 'published') return;
    const shareUrl = `${window.location.origin}/#/templates/${template.slug || template.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      addToast('success', 'Template link copied.');
    } catch {
      addToast('error', 'Could not copy the template link.');
    }
  };

  const handleCopyPrompt = (prompt: string, id: string) => {
    if (openGuestGate('copy-prompt')) return;
    navigator.clipboard.writeText(prompt);
    setCopiedPromptId(id);
    setTimeout(() => setCopiedPromptId(null), 2000);
  };

  const getMaterialIcon = (type: string) => {
    switch (type) {
      case 'image': return <ImageIcon className="w-5 h-5 text-blue-500" />;
      case 'video': return <VideoIcon className="w-5 h-5 text-purple-500" />;
      case 'audio': return <Music className="w-5 h-5 text-amber-500" />;
      default: return <ImageIcon className="w-5 h-5 text-slate-500" />;
    }
  };

  if (loadingTemplate) {
    return (
      <div className="min-h-screen pt-28 flex items-start justify-center">
        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading template…</span>
        </div>
      </div>
    );
  }

  if (templateError || !template) {
    return (
      <div className="min-h-screen pt-28 px-4 flex items-start justify-center">
        <div className="max-w-lg w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Template unavailable</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{templateError || 'The template could not be loaded.'}</p>
          <Button
            className="mt-6"
            variant="secondary"
            onClick={() => navigate(user ? '/dashboard?tab=templates' : '/')}
          >
            {user ? 'Back to My Templates' : 'Back to Templates'}
          </Button>
        </div>
      </div>
    );
  }

  const creatorName = template.creatorId === user?.id
    ? 'You'
    : template.creatorName || 'Lazora creator';
  const isPublished = template.status === 'published';
  const primaryButtonLabel = template.status === 'pending_review'
    ? 'Under review'
    : isPublished
      ? 'Use this template'
      : 'Preview only';

  return (
    <div className="min-h-screen pt-20 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Template Details</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Review the workflow and materials</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" className="gap-2" onClick={handleShare} disabled={!isPublished}>
            <Share className="w-4 h-4" />
            Share
          </Button>
          <Button
            variant="gradient"
            onClick={() => void handleUseTemplate()}
            disabled={!isPublished || startingRun}
          >
            {startingRun && <Loader2 className="w-4 h-4 animate-spin" />}
            {startingRun ? 'Starting…' : primaryButtonLabel}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Final Result & Info */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-white/10">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Final Result</h2>
            
            {/* Display Window (3:4 ratio) */}
            <div 
              className={`relative aspect-[3/4] bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden group ${
                user ? 'cursor-pointer' : ''
              }`}
              onClick={() => {
                if (!user || !template.finalResult.url) return;
                setModalContent({
                  type: template.finalResult.type,
                  url: template.finalResult.url,
                  poster: template.finalResult.thumbnail,
                });
              }}
            >
              {!template.finalResult.url ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-400">
                  <ImageIcon className="w-10 h-10" />
                  <span className="text-sm">No result preview</span>
                </div>
              ) : template.finalResult.type === 'video' ? (
                <>
                  {user ? (
                    <>
                      <VideoPosterFrame
                        src={template.finalResult.url}
                        poster={template.finalResult.thumbnail}
                        className="h-full w-full pointer-events-none"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                        <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-lg group-hover:scale-110 transition-transform">
                          <Play className="w-5 h-5 text-white ml-1" fill="currentColor" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <video
                        ref={guestVideoRef}
                        src={template.finalResult.url}
                        poster={template.finalResult.thumbnail}
                        className="h-full w-full object-cover"
                        playsInline
                        preload="metadata"
                        controlsList="nodownload noremoteplayback"
                        disablePictureInPicture
                        onPlay={() => setGuestVideoPlaying(true)}
                        onPause={() => setGuestVideoPlaying(false)}
                        onEnded={() => setGuestVideoPlaying(false)}
                        onContextMenu={blockVideoContextMenu}
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleGuestVideo();
                        }}
                        className="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105"
                        aria-label={guestVideoPlaying ? 'Pause final result' : 'Play final result'}
                      >
                        {guestVideoPlaying
                          ? <Pause className="h-5 w-5" fill="currentColor" />
                          : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
                      </button>
                    </>
                  )}
                </>
              ) : (
                <img 
                  src={template.finalResult.url}
                  alt="Final Result" 
                  className="w-full h-full object-cover"
                />
              )}
              
              {/* Hover overlay for zoom */}
              {template.finalResult.url && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (openGuestGate('view-final-result')) return;
                    setModalContent({
                      type: template.finalResult.type,
                      url: template.finalResult.url,
                      poster: template.finalResult.thumbnail,
                    });
                  }}
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity bg-black/60 backdrop-blur-md rounded-lg px-3 py-1.5 flex items-center gap-2 border border-white/10"
                >
                  <Maximize2 className="w-4 h-4 text-white" />
                  <span className="text-xs font-medium text-white">View larger</span>
                </button>
              )}
            </div>

            {/* Basic Info */}
            <div className="mt-6 space-y-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{template.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Used {template.usageCount} times</p>
              </div>

              <div className="flex items-center gap-3 py-3 border-y border-slate-200 dark:border-white/10">
                <div className="w-10 h-10 rounded-full border border-slate-200 dark:border-white/10 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 flex items-center justify-center font-semibold">
                  {template.creatorAvatarUrl ? (
                    <img
                      src={template.creatorAvatarUrl}
                      alt=""
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    creatorName.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Created by</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{creatorName}</p>
                </div>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                {template.description || 'No description provided.'}
              </p>
            </div>
          </div>
        </div>

        {/* Middle Column: Workflow Steps */}
        <div className="lg:col-span-8">
          <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-white/10">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">How this template was made</h2>
            
            <div className="space-y-4">
              {template.steps.map((step, index) => {
                const isExpanded = activeStep === step.id;
                const isGuestLockedStep = !user && (step.locked || index > 0);
                const FeatureIcon = getFeatureIcon(step.featureName);

                return (
                  <div 
                    key={step.id}
                    className={`border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden transition-all duration-300 ${isExpanded ? 'bg-white dark:bg-slate-800/50 shadow-sm' : 'bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  >
                    {/* Step Header (Clickable) */}
                    <div 
                      className="p-4 flex items-center justify-between cursor-pointer select-none"
                      onClick={() => {
                        if (isGuestLockedStep) {
                          openGuestGate(`view-step-${index + 1}`);
                          return;
                        }
                        setActiveStep(isExpanded ? '' : step.id);
                      }}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-semibold text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <h3 className="font-medium text-slate-900 dark:text-white">{step.name}</h3>
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 dark:text-slate-400">
                            <FeatureIcon className="w-3.5 h-3.5" />
                            <span>{step.featureName}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-slate-400">
                        {isGuestLockedStep
                          ? <LockKeyhole className="w-4 h-4 text-purple-500" />
                          : isExpanded
                            ? <ChevronUp className="w-5 h-5" />
                            : <ChevronDown className="w-5 h-5" />}
                      </div>
                    </div>

                    {/* Step Content (Expanded) */}
                    {isExpanded && (
                      <div className="p-4 pt-0 border-t border-slate-100 dark:border-white/5 mt-2 space-y-6">
                        
                        {/* Feature Used (Prominent) */}
                        <div className="pt-4">
                          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Feature I Used</h4>
                          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-lg text-sm font-medium border border-purple-100 dark:border-purple-800/30">
                            <FeatureIcon className="w-4 h-4" />
                            {step.featureName}
                          </div>
                        </div>

                        {/* Materials Uploaded */}
                        {step.materials.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Materials I Uploaded</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {step.materials.map(material => (
                                <div key={material.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/5">
                                  <div className="flex items-center gap-3 overflow-hidden">
                                    <div 
                                      className="w-10 h-10 rounded-md bg-slate-200 dark:bg-slate-800 flex-shrink-0 flex items-center justify-center overflow-hidden cursor-pointer border border-slate-300 dark:border-slate-700"
                                      onClick={() => {
                                        if (openGuestGate('view-reference-material')) return;
                                        if (material.type !== 'audio' && material.url !== '#') {
                                          setModalContent({
                                            type: material.type,
                                            url: material.url,
                                            allowDownload: material.permission === 'download',
                                          });
                                        }
                                      }}
                                    >
                                      {material.type === 'image' && material.url !== '#' ? (
                                        <img src={material.url} alt={material.name} className="w-full h-full object-cover" />
                                      ) : (
                                        getMaterialIcon(material.type)
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{material.name}</p>
                                      <p className="text-xs text-slate-500 capitalize">{material.type}</p>
                                    </div>
                                  </div>
                                  <div className="flex-shrink-0 ml-3">
                                    {material.type === 'audio' ? (
                                      <Button 
                                        variant="secondary" 
                                        size="sm" 
                                        className="h-8 gap-1.5 px-3"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleAudio(material.id, material.url);
                                        }}
                                      >
                                        {playingAudioId === material.id ? (
                                          <Pause className="w-3.5 h-3.5" />
                                        ) : (
                                          <Play className="w-3.5 h-3.5" />
                                        )}
                                        <span className="text-xs">
                                          {playingAudioId === material.id ? 'Pause' : 'Play'}
                                        </span>
                                      </Button>
                                    ) : material.permission === 'preview' ? (
                                      <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-md">
                                        Preview only
                                      </span>
                                    ) : (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        className="h-8 gap-1.5 px-3"
                                        onClick={() => {
                                          if (openGuestGate('download-material')) return;
                                        }}
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        <span className="text-xs">Download</span>
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Prompt & Settings */}
                        {step.prompt && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Prompt & Settings I Set</h4>
                              <button 
                                onClick={() => handleCopyPrompt(step.prompt, step.id)}
                                className="flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                              >
                                {copiedPromptId === step.id ? (
                                  <><Check className="w-3.5 h-3.5" /> Copied</>
                                ) : (
                                  <><Copy className="w-3.5 h-3.5" /> Copy Prompt</>
                                )}
                              </button>
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-white/5 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono">
                              {step.prompt}
                            </div>
                          </div>
                        )}

                        {Object.keys(step.settings || {}).length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                              Settings
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {Object.entries(step.settings).map(([key, value]) => (
                                <div
                                  key={key}
                                  className="rounded-lg border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/50 px-3 py-2"
                                >
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {formatSettingLabel(key)}
                                  </p>
                                  <p className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                                    {formatSettingValue(value)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Results from This Step */}
                        {step.results.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Results from This Step</h4>
                            <div className="flex flex-wrap gap-3">
                              {step.results.map(result => (
                                <div 
                                  key={result.id}
                                  className="relative w-24 h-24 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 cursor-pointer group"
                                  onClick={() => {
                                    if (openGuestGate('view-step-result')) return;
                                    setModalContent({
                                      type: result.type,
                                      url: result.url,
                                      poster: result.thumbnail,
                                    });
                                  }}
                                >
                                  {result.type === 'video' ? (
                                    <>
                                      {result.thumbnail ? (
                                        <img src={result.thumbnail} alt="Result" className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-slate-500 dark:from-slate-800 dark:to-slate-900 dark:text-slate-400">
                                          <VideoIcon className="h-7 w-7" />
                                        </div>
                                      )}
                                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                        <Play className="w-6 h-6 text-white ml-0.5" fill="currentColor" />
                                      </div>
                                    </>
                                  ) : (
                                    <img src={result.url} alt="Result" className="w-full h-full object-cover" />
                                  )}
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                    <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {showAuthGate && !user && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/65 px-4 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workflow-auth-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowAuthGate(false);
          }}
        >
          <div className="relative w-full max-w-md rounded-3xl border border-white/20 bg-white p-7 shadow-2xl dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setShowAuthGate(false)}
              className="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Close sign up prompt"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/25">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <h2 id="workflow-auth-title" className="pr-8 text-2xl font-bold text-slate-900 dark:text-white">
              Sign up to unlock the complete workflow
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              View every step, prompt and reference — and get 120 free credits.
            </p>
            <div className="mt-5 rounded-2xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-800/50 dark:bg-purple-950/30">
              <div className="flex items-start gap-3">
                <Gift className="mt-0.5 h-5 w-5 flex-none text-purple-600 dark:text-purple-400" />
                <div>
                  <p className="font-semibold text-purple-900 dark:text-purple-100">
                    Get 120 free credits when you sign up
                  </p>
                  <p className="mt-1 text-xs text-purple-700 dark:text-purple-300">
                    No credit card required.
                  </p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              Create an account to unlock the full workflow and continue recreating this result.
            </p>
            <div className="mt-6 grid gap-3">
              <Button
                variant="gradient"
                className="w-full"
                onClick={() => continueToAuth('signup')}
              >
                Sign up — Get 120 Credits
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => continueToAuth('login')}
              >
                Log in
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen media viewer overlay */}
      {modalContent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200">
          <button 
            onClick={() => setModalContent(null)}
            className="absolute top-4 right-4 md:top-6 md:right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white z-10"
            aria-label="Close fullscreen view"
          >
            <X className="w-8 h-8" />
          </button>
          
          <div className="w-full h-full flex items-center justify-center p-4">
            {modalContent.type === 'video' ? (
              <div className="relative flex h-full w-full items-center justify-center">
                {!modalVideoReady && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {modalContent.poster && (
                      <img
                        src={modalContent.poster}
                        alt=""
                        className="absolute inset-0 h-full w-full object-contain opacity-60"
                      />
                    )}
                    <div className="relative z-10 flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-sm text-white backdrop-blur">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading video...
                    </div>
                  </div>
                )}
                <video
                  src={modalContent.url}
                  poster={modalContent.poster}
                  className={`max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-opacity ${
                    modalVideoReady ? 'opacity-100' : 'opacity-0'
                  }`}
                  controls
                  autoPlay
                  playsInline
                  preload="auto"
                  controlsList={modalContent.allowDownload
                    ? 'noremoteplayback'
                    : 'nodownload noremoteplayback'}
                  disablePictureInPicture
                  onCanPlay={() => setModalVideoReady(true)}
                  onContextMenu={modalContent.allowDownload ? undefined : blockVideoContextMenu}
                />
              </div>
            ) : modalContent.type === 'image' ? (
              <img 
                src={modalContent.url} 
                alt="Enlarged view" 
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              />
            ) : null}
          </div>
        </div>
      )}
      <p className="text-center text-[10px] text-slate-300 dark:text-slate-700 pt-4 select-all">Build: 2026-07-18-M5-8</p>
    </div>
  );
};
