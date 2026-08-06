import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Copy,
  RefreshCw,
  Download,
  ImagePlus,
  Trash2,
  AlertTriangle,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  VideoResult,
  getCachedVideoResults,
  saveCachedVideoResults,
  upsertCachedVideoResult,
  updateCachedVideoResult,
  removeCachedVideoResult,
  dedupeVideoResults,
} from '../utils/video';
import { clearPendingVideoJob, getPendingVideoJobs, pollPendingVideoJob } from '../utils/generateService';
import { FeatureSwitcher, FeatureType } from '../components/video/FeatureSwitcher';
import { ImageToVideo } from '../components/video/ImageToVideo';
import { MotionControl } from '../components/video/MotionControl';
import { LipSync } from '../components/video/LipSync';
import { FreeMode } from '../components/video/FreeMode';
import { useStore } from '../context/StoreContext';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Generation, VideoMode, type GenerationInputAssetSnapshot } from '../types';
import type { WorkflowCapabilityKey } from '../workflows/types';
import { WelcomeGiftModal } from '../components/WelcomeGiftModal';
import { consumeWorkflowHandoff, type WorkflowHandoff } from '../components/workflow/workflowManager';
import { AuthGateModal } from '../components/AuthGateModal';

const parseDurationSeconds = (duration: string): number | undefined => {
  if (!duration) return undefined;
  const parts = duration.split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(duration) || undefined;
};

const formatDuration = (seconds?: number | null) => {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const getUserFacingError = (error?: string) =>
  error
    ?.replace(/Fal/gi, 'generation service')
    .replace(/Kling/gi, 'generation service');

const getVideoMode = (type: string): VideoMode | undefined => {
  const normalized = type.toLowerCase();
  if (normalized.includes('image')) return 'image_to_video';
  if (normalized.includes('motion')) return 'motion_control';
  if (normalized.includes('lip')) return 'lip_sync';
  return undefined;
};

const getTypeFromMode = (mode?: VideoMode) => {
  if (mode === 'image_to_video') return 'Image to Video';
  if (mode === 'motion_control') return 'Motion Control';
  if (mode === 'lip_sync') return 'Lip Sync';
  return 'Video';
};

const generationToVideoResult = (generation: Generation): VideoResult | null => {
  if (generation.mediaType !== 'video' && !generation.videoUrl) return null;

  const mode = generation.videoMode;
  return {
    id: generation.id,
    type: getTypeFromMode(mode),
    model: 'Standard',
    resolution: 'Saved',
    prompt: generation.prompt || '',
    duration: formatDuration(generation.videoDuration),
    aspectRatio: (generation.videoAspectRatio as VideoResult['aspectRatio']) || '16:9',
    timestamp: 'Saved',
    bgColor: 'bg-slate-900/50',
    videoUrl: generation.videoUrl,
    sourceImage: generation.imageUrl,
    status: generation.videoUrl ? 'completed' : 'pending',
    mode,
    createdAt: generation.createdAt,
    requestId: generation.requestId,
    templateRunId: generation.templateRunId,
    templateStepId: generation.templateStepId,
    templateCapability: generation.templateCapability,
    generateAudio:
      typeof generation.generationParameters?.generateAudio === 'boolean'
        ? generation.generationParameters.generateAudio
        : undefined,
  };
};

const getCapabilityFromVideoResult = (
  result: VideoResult,
): WorkflowCapabilityKey => {
  const mode = result.mode || getVideoMode(result.type);
  if (mode === 'motion_control') return 'video.motion_control';
  if (mode === 'lip_sync') {
    return result.sourceVideo
      ? 'video.lip_sync_video'
      : 'video.lip_sync_image';
  }
  return 'video.image_to_video';
};

const getInputAssetsFromVideoResult = (
  result: VideoResult,
): GenerationInputAssetSnapshot[] => {
  const capability = getCapabilityFromVideoResult(result);
  const assets: GenerationInputAssetSnapshot[] = [];

  if (result.sourceImage) {
    assets.push({
      key:
        capability === 'video.image_to_video'
          ? 'start_image'
          : capability === 'video.motion_control'
            ? 'character_image'
            : 'source_image',
      assetType: 'image',
      url: result.sourceImage,
    });
  }
  if (result.sourceVideo) {
    assets.push({
      key: capability === 'video.motion_control' ? 'driver_video' : 'source_video',
      assetType: 'video',
      url: result.sourceVideo,
    });
  }
  if (result.audioUrl) {
    assets.push({
      key: 'audio',
      assetType: 'audio',
      url: result.audioUrl,
    });
  }

  return assets;
};

const pendingJobsToVideoResults = (userId?: string): VideoResult[] =>
  getPendingVideoJobs()
    .filter((job) => !userId || job.userId === userId)
    .map((job) => ({
    id: job.clientJobId,
    type: getTypeFromMode(job.mode),
    model: job.resolution === '1080p' ? 'Pro' : 'Standard',
    resolution: job.resolution || '720p',
    prompt: job.prompt || '',
    duration: formatDuration(job.duration || 0),
    aspectRatio: '16:9',
    timestamp: 'Pending',
    bgColor: 'bg-slate-900/50',
    sourceImage: job.startImageUrl,
    sourceVideo: job.inputVideoUrl,
    audioUrl: job.audioUrl,
    generateAudio: job.generateAudio,
    status: 'pending',
    requestId: job.requestId,
    mode: job.mode,
    creditsUsed: job.creditsUsed,
    createdAt: job.createdAt,
    templateRunId: job.templateRunId,
    templateStepId: job.templateStepId,
    templateCapability: job.templateCapability,
    error: 'This job was already submitted. Use Resume to check the same request instead of generating again.',
  }));

const getFeatureFromSearch = (search: string): FeatureType => {
  const requestedMode = new URLSearchParams(search).get('mode');
  if (requestedMode === 'motion-control') return 'motion-control';
  if (requestedMode === 'lip-sync') return 'lip-sync';
  if (requestedMode === 'free-mode') return 'free-mode';
  return 'image-to-video';
};

export const Video: React.FC = () => {
  const location = useLocation();
  const navigationState = location.state as { initialImage?: string } | null;
  const [initialImage] = useState<string | null>(navigationState?.initialImage || null);
  const [workflowHandoff, setWorkflowHandoff] = useState<WorkflowHandoff | null>(null);

  const [results, setResults] = useState<VideoResult[]>([]);
  const resultsRef = useRef<VideoResult[]>([]);
  const [activeFeature, setActiveFeature] = useState<FeatureType>(() =>
    getFeatureFromSearch(location.search),
  );
  const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
  const [showWelcomeGift, setShowWelcomeGift] = useState(false);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [downloadingVideoId, setDownloadingVideoId] = useState<string | null>(null);
  // Synthetic progress for the in-card loading UI (mirrors the image page)
  const [pendingProgress, setPendingProgress] = useState<Record<string, number>>({});
  const { addGeneration, user, generations } = useStore();
  const savedVideoKeysRef = useRef<Set<string>>(new Set());
  const autoResumedRequestIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setActiveFeature(getFeatureFromSearch(location.search));
    const handoff = consumeWorkflowHandoff();
    if (handoff) setWorkflowHandoff(handoff);
  }, [location.search]);

  const handleInsufficientCredits = () => {
    if (!user) {
      setShowAuthGate(true);
      return;
    }
    if (user?.welcomeGiftEligible && !user.welcomeGiftRedeemed) {
      setShowWelcomeGift(true);
      return;
    }
    window.location.hash = '#/pricing';
  };

  const handleProRequired = () => {
    if (!user) {
      setShowAuthGate(true);
      return;
    }
    window.location.hash = '#/pricing';
  };

  const hasProAccess = user?.plan === 'Pro' || Boolean(user?.isWhitelisted);

  const handleCopyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt || '');
    } catch {
      alert('Unable to copy the prompt. Please select and copy it manually.');
    }
  };

  const handleDownloadVideo = async (result: VideoResult) => {
    if (!result.videoUrl || downloadingVideoId) return;
    setDownloadingVideoId(result.id);

    try {
      const response = await fetch(result.videoUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeType = result.type.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      link.href = objectUrl;
      link.download = `${safeType || 'video'}-${Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      console.error('[Video] Download failed:', error);
      window.open(result.videoUrl, '_blank', 'noopener,noreferrer');
      alert('Direct download was blocked by the video host. The video was opened in a new tab so you can save it from there.');
    } finally {
      setDownloadingVideoId(null);
    }
  };

  const setResultsAndCache = (next: VideoResult[] | ((prev: VideoResult[]) => VideoResult[])) => {
    setResults((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      const deduped = dedupeVideoResults(resolved);
      resultsRef.current = deduped;
      // Admin demo videos are local blob: URLs — never persist them (they die on refresh)
      if (user?.id) saveCachedVideoResults(user.id, deduped.filter((item) => !item.videoUrl?.startsWith('blob:')));
      return deduped;
    });
  };

  const saveCompletedVideo = (result: VideoResult) => {
    if (!user || !result.videoUrl) return;
    // Admin demo videos are local blob: URLs — do not write them to the database
    if (result.videoUrl.startsWith('blob:') || result.videoUrl.startsWith('data:')) return;

    const possibleKeys = [result.videoUrl, result.requestId, result.id].filter(Boolean) as string[];
    if (possibleKeys.some((key) => savedVideoKeysRef.current.has(key))) return;
    possibleKeys.forEach((key) => savedVideoKeysRef.current.add(key));

    addGeneration({
      userId: user.id,
      templateId: 'video-gen',
      templateName: result.type,
      imageUrl: result.sourceImage || result.sourceVideo || result.videoUrl,
      mediaType: 'video',
      videoUrl: result.videoUrl,
      videoDuration: parseDurationSeconds(result.duration),
      videoAspectRatio: result.aspectRatio === 'Auto' ? undefined : result.aspectRatio,
      videoMode: result.mode || getVideoMode(result.type),
      prompt: result.prompt,
      creditsUsed: result.creditsUsed ?? 0,
      requestId: result.requestId,
      capability: getCapabilityFromVideoResult(result),
      inputAssets: getInputAssetsFromVideoResult(result),
      generationParameters: {
        prompt: result.prompt || '',
        resolution: result.resolution,
        duration: parseDurationSeconds(result.duration) || 0,
        aspectRatio: result.aspectRatio,
        ...(result.mode === 'image_to_video' || getVideoMode(result.type) === 'image_to_video'
          ? { generateAudio: result.generateAudio !== false }
          : {}),
      },
      templateRunId: result.templateRunId,
      templateStepId: result.templateStepId,
      templateCapability: result.templateCapability,
    });
  };

  useEffect(() => {
    if (navigationState?.initialImage) {
      window.history.replaceState({}, document.title);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setResults([]);
      resultsRef.current = [];
      return;
    }

    const dbVideos = generations
      .map(generationToVideoResult)
      .filter((item): item is VideoResult => Boolean(item));

    for (const item of dbVideos) {
      if (item.videoUrl) savedVideoKeysRef.current.add(item.videoUrl);
      if (item.requestId) savedVideoKeysRef.current.add(item.requestId);
      if (item.id) savedVideoKeysRef.current.add(item.id);
    }

    const cached = getCachedVideoResults(user.id);
    const pending = pendingJobsToVideoResults(user.id);
    const combined = dedupeVideoResults([
      ...pending,
      ...cached,
      ...dbVideos,
    ]);

    resultsRef.current = combined;
    setResults(combined);
    saveCachedVideoResults(user.id, combined);
  }, [user?.id, generations]);

  const handleDeleteConfirm = () => {
    if (videoToDelete) {
      const deleting = resultsRef.current.find(v => v.id === videoToDelete);
      const pending = deleting ? findMatchingPendingJob(deleting) : undefined;
      if (pending) clearPendingVideoJob(pending.requestId);
      setResultsAndCache(prev => prev.filter(v => v.id !== videoToDelete));
      if (user?.id) removeCachedVideoResult(user.id, videoToDelete);
      savedVideoKeysRef.current.delete(videoToDelete);
      setVideoToDelete(null);
    }
  };

  const handleNewResult = (result: VideoResult) => {
    const normalized: VideoResult = {
      ...result,
      createdAt: result.createdAt || Date.now(),
      mode: result.mode || getVideoMode(result.type),
    };

    setResultsAndCache(prev => {
      const exists = prev.some(v => v.id === normalized.id);
      return exists
        ? prev.map(v => v.id === normalized.id ? { ...v, ...normalized } : v)
        : [normalized, ...prev];
    });

    if (user?.id) upsertCachedVideoResult(user.id, normalized);

    if (normalized.videoUrl && normalized.status !== 'pending') {
      saveCompletedVideo({ ...normalized, status: normalized.status || 'completed' });
    }
  };

  const handleUpdateResult = (id: string, updates: Partial<VideoResult>) => {
    let merged: VideoResult | null = null;

    setResultsAndCache(prev => prev.map(item => {
      if (item.id !== id) return item;
      merged = { ...item, ...updates, createdAt: item.createdAt || Date.now() };
      return merged;
    }));

    const fallback = resultsRef.current.find(item => item.id === id);
    const finalMerged = merged || (fallback ? { ...fallback, ...updates } : null);

    if (user?.id && finalMerged) {
      updateCachedVideoResult(user.id, id, finalMerged);
    }

    if (finalMerged?.videoUrl && finalMerged.status === 'completed') {
      saveCompletedVideo(finalMerged);
    }
  };


  const findMatchingPendingJob = (gen: VideoResult) =>
    getPendingVideoJobs().find((job) =>
      job.clientJobId === gen.id || Boolean(gen.requestId && job.requestId === gen.requestId)
    );

  const isMatchingPendingCard = (gen: VideoResult) => Boolean(findMatchingPendingJob(gen));

  const handleResumeCard = async (gen: VideoResult) => {
    if (gen.status !== 'pending') return;

    const pending = findMatchingPendingJob(gen);
    if (!pending) {
      handleUpdateResult(gen.id, {
        status: 'failed',
        timestamp: 'Failed',
        error: 'No matching local pending job was found. Clear this card and generate again.',
      });
      return;
    }

    handleUpdateResult(gen.id, {
      status: 'pending',
      error: 'Checking the existing request. Do not submit a new generation.',
    });

    try {
      const result = await pollPendingVideoJob(pending.requestId);

      if (result.success && result.videoUrl) {
        handleUpdateResult(gen.id, {
          status: 'completed',
          videoUrl: result.videoUrl,
          timestamp: 'Just now',
          requestId: result.requestId || gen.requestId,
          templateRunId: result.templateRunId || gen.templateRunId,
          templateStepId: result.templateStepId || gen.templateStepId,
          templateCapability: result.templateCapability || gen.templateCapability,
          error: undefined,
        });
        return;
      }

      if (result.pending) {
        handleUpdateResult(gen.id, {
          status: 'pending',
          requestId: result.requestId || gen.requestId,
          templateRunId: result.templateRunId || gen.templateRunId,
          templateStepId: result.templateStepId || gen.templateStepId,
          templateCapability: result.templateCapability || gen.templateCapability,
          error: result.error || 'The generation service is still processing this request. Check again later.',
        });
        return;
      }

      handleUpdateResult(gen.id, {
        status: 'failed',
        timestamp: 'Failed',
        requestId: result.requestId || gen.requestId,
        templateRunId: result.templateRunId || gen.templateRunId,
        templateStepId: result.templateStepId || gen.templateStepId,
        templateCapability: result.templateCapability || gen.templateCapability,
        error: result.error || 'The request failed or was not found. You can clear this card and generate again.',
      });
    } catch (error) {
      handleUpdateResult(gen.id, {
        status: 'pending',
        error: error instanceof Error ? error.message : 'Failed to check the pending job.',
      });
    }
  };

  const handleClearPendingCard = (gen: VideoResult) => {
    const pending = findMatchingPendingJob(gen);
    if (pending) clearPendingVideoJob(pending.requestId);

    setResultsAndCache(prev => prev.filter(item => item.id !== gen.id));
    if (user?.id) removeCachedVideoResult(user.id, gen.id);
  };


  // Restore and resume every unfinished job once after a page refresh.
  useEffect(() => {
    const pendingCards = results
      .filter((item) => item.status === 'pending' && item.requestId)
      .filter((item) => !autoResumedRequestIdsRef.current.has(item.requestId as string));
    if (!pendingCards.length) return;

    pendingCards.forEach((item) => autoResumedRequestIdsRef.current.add(item.requestId as string));
    const timer = window.setTimeout(() => {
      pendingCards.forEach((item) => handleResumeCard(item));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [results, user?.id]);

  // Drive the synthetic progress bar for every card that is still generating
  useEffect(() => {
    const pendingIds = results.filter((item) => item.status === 'pending').map((item) => item.id);
    if (!pendingIds.length) {
      setPendingProgress((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const timer = window.setInterval(() => {
      setPendingProgress((prev) => {
        const next = { ...prev };
        pendingIds.forEach((id) => {
          next[id] = Math.min((next[id] ?? 0) + Math.random() * 8, 92);
        });
        return next;
      });
    }, 500);

    return () => window.clearInterval(timer);
  }, [results]);

  const renderStatusPill = (gen: VideoResult) => {
    if (gen.status === 'pending') {
      return (
        <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          Generating
        </span>
      );
    }

    if (gen.status === 'failed') {
      return (
        <span className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">
          Failed
        </span>
      );
    }

    return (
      <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        Completed
      </span>
    );
  };

  return (
    <div className="mt-16 flex min-h-[calc(100vh-64px)] w-full flex-col overflow-visible bg-white dark:bg-slate-900 lg:h-[calc(100vh-64px)] lg:flex-row lg:overflow-hidden">
      <div className="relative z-10 flex min-h-[calc(100vh-64px)] w-full shrink-0 flex-col border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 lg:min-h-0 lg:w-[480px] lg:border-b-0 lg:border-r">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 shrink-0 relative z-50">
          <FeatureSwitcher activeFeature={activeFeature} onChange={setActiveFeature} isAdmin={Boolean(user?.isAdmin)} />
        </div>

        {activeFeature === 'image-to-video' && (
          <ImageToVideo onGenerate={handleNewResult} onUpdate={handleUpdateResult} initialImage={initialImage} workflowHandoff={workflowHandoff} userCredits={user?.credits ?? 0} onInsufficientCredits={handleInsufficientCredits} isPro={hasProAccess} onProRequired={handleProRequired} isAuthenticated={Boolean(user)} onRequireAuth={() => setShowAuthGate(true)} />
        )}
        {activeFeature === 'motion-control' && (
          <MotionControl onGenerate={handleNewResult} onUpdate={handleUpdateResult} initialImage={initialImage} workflowHandoff={workflowHandoff} userCredits={user?.credits ?? 0} onInsufficientCredits={handleInsufficientCredits} isPro={hasProAccess} onProRequired={handleProRequired} isAuthenticated={Boolean(user)} onRequireAuth={() => setShowAuthGate(true)} />
        )}
        {activeFeature === 'lip-sync' && (
          <LipSync onGenerate={handleNewResult} onUpdate={handleUpdateResult} initialImage={initialImage} workflowHandoff={workflowHandoff} userCredits={user?.credits ?? 0} onInsufficientCredits={handleInsufficientCredits} isAuthenticated={Boolean(user)} onRequireAuth={() => setShowAuthGate(true)} />
        )}
        {activeFeature === 'free-mode' && (
          <FreeMode onGenerate={handleNewResult} initialImage={initialImage} isAuthenticated={Boolean(user)} onRequireAuth={() => setShowAuthGate(true)} />
        )}
      </div>

      <div className="relative flex min-h-[60vh] flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto w-full max-w-3xl space-y-8 pb-12">
            {results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="h-16 w-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  <ImagePlus className="h-8 w-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">Generate your first video</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                  Upload media on the left, type a prompt, and click generate to create a video.
                </p>
              </div>
            )}
            
            {results.map((gen) => (
              <div key={gen.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-800/50 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {gen.type}
                    </span>
                    {renderStatusPill(gen)}
                    {gen.resolution !== 'Saved' && (
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {gen.resolution}
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative p-5">
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed pr-8">
                    "{gen.prompt}"
                  </p>
                  {gen.error && (
                    <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                      {getUserFacingError(gen.error)}
                    </p>
                  )}
                  <button
                    onClick={() => handleCopyPrompt(gen.prompt)}
                    className="absolute right-5 top-5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    title="Copy prompt"
                    type="button"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>

                <div className="px-5 pb-2">
                  <div 
                    className={`relative w-full rounded-xl overflow-hidden bg-black ${
                      gen.aspectRatio === '16:9' || gen.aspectRatio === 'Auto' ? 'aspect-video' : 
                      gen.aspectRatio === '9:16' ? 'aspect-[9/16] w-3/5 mx-auto' : 
                      'aspect-square w-3/4 mx-auto'
                    }`}
                  >
                    {gen.videoUrl ? (
                      <video
                        key={gen.videoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-contain bg-black"
                        poster={gen.sourceImage}
                        onError={(event) => {
                          console.error('[Video] HTML video playback error:', {
                            videoUrl: gen.videoUrl,
                            error: event.currentTarget.error,
                          });
                        }}
                      >
                        <source src={gen.videoUrl} />
                        Your browser does not support the video tag.
                      </video>
                    ) : gen.sourceVideo ? (
                      <video src={gen.sourceVideo} muted playsInline className="h-full w-full object-contain bg-black opacity-70" />
                    ) : gen.sourceImage ? (
                      <img src={gen.sourceImage} alt="Source" className="h-full w-full object-cover opacity-70" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-500">
                        <ImagePlus className="h-8 w-8" />
                      </div>
                    )}

                    {gen.status === 'pending' && (
                      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/60 text-white backdrop-blur-sm">
                        <div className="relative h-24 w-24">
                          <Loader2 className="h-24 w-24 animate-spin text-purple-500" />
                          <Sparkles className="absolute inset-0 m-auto h-10 w-10 text-white animate-pulse" />
                        </div>
                        <p className="text-lg font-semibold text-white">Generating your magic...</p>
                        <div className="h-2 w-48 overflow-hidden rounded-full bg-white/20">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                            style={{ width: `${pendingProgress[gen.id] ?? 5}%` }}
                          />
                        </div>
                        <p className="text-xs text-white/70">You may leave this page. This job can be resumed later.</p>
                      </div>
                    )}

                    {gen.status === 'failed' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white backdrop-blur-sm">
                        <AlertTriangle className="mb-3 h-8 w-8" />
                        <p className="text-sm font-semibold">Generation failed</p>
                      </div>
                    )}

                    <div className="absolute bottom-3 right-3 rounded bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-md pointer-events-none">
                      {gen.duration}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end px-5 py-4 mt-auto border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    {gen.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleResumeCard(gen)}
                          className="flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50 transition-colors"
                          type="button"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Check status
                        </button>
                        <button
                          onClick={() => handleClearPendingCard(gen)}
                          className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40 transition-colors"
                          type="button"
                        >
                          Clear stuck job
                        </button>
                      </>
                    )}
                    {gen.videoUrl && (
                      <button
                        onClick={() => handleDownloadVideo(gen)}
                        disabled={downloadingVideoId === gen.id}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 transition-colors"
                        type="button"
                      >
                        {downloadingVideoId === gen.id
                          ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          : <Download className="h-3.5 w-3.5" />}
                        {downloadingVideoId === gen.id ? 'Downloading...' : 'Download'}
                      </button>
                    )}
                    <button 
                      onClick={() => setVideoToDelete(gen.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title="Delete video"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <div className="pt-4 pb-8 text-center text-sm text-slate-400 dark:text-slate-500">
              No more generations to show.
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={!!videoToDelete}
        onClose={() => setVideoToDelete(null)}
        title="Delete Video Generation"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setVideoToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </div>
        }
      >
        <div className="flex items-center gap-4 py-4">
          <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Are you sure you want to delete this video generation? This action cannot be undone.
            </p>
          </div>
        </div>
      </Modal>
      <WelcomeGiftModal isOpen={showWelcomeGift} onClose={() => setShowWelcomeGift(false)} />
      <AuthGateModal
        isOpen={showAuthGate}
        onClose={() => setShowAuthGate(false)}
        destination={`/video${location.search}`}
        title="Sign up to generate your video"
        description="Browse every video mode and configure your inputs first. Create a free account only when you are ready to generate."
      />
    </div>
  );
};
