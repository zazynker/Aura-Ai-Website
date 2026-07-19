import React, { useState, useRef, useEffect } from 'react';
import { 
  Settings, ChevronDown, ArrowRightLeft, ImagePlus, 
  Image as ImageIcon, RefreshCw, Sparkles, Trash2, Maximize2,
} from 'lucide-react';
import { VideoResult } from '../../utils/video';
import { generateVideo, getPendingVideoJob, pollPendingVideoJob, PendingVideoJob } from '../../utils/generateService';
import { supabase } from '../../utils/supabase';
import { estimateVideoCredits } from '../../context/StoreContext';
import type { WorkflowHandoff } from '../workflow/workflowManager';
import { MediaLightbox } from './MediaLightbox';

interface ImageToVideoProps {
  onGenerate: (result: VideoResult) => void;
  onUpdate?: (id: string, updates: Partial<VideoResult>) => void;
  initialImage: string | null;
  workflowHandoff?: WorkflowHandoff | null;
  userCredits: number;
  onInsufficientCredits: (requiredCredits: number) => void;
  isPro: boolean;
  onProRequired: () => void;
}

const formatDuration = (seconds?: number) => `00:${String(seconds || 3).padStart(2, '0')}`;

export const ImageToVideo: React.FC<ImageToVideoProps> = ({ onGenerate, onUpdate, initialImage, workflowHandoff, userCredits, onInsufficientCredits, isPro, onProRequired }) => {
  const [prompt, setPrompt] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(initialImage);
  const [selectedEndImage, setSelectedEndImage] = useState<string | null>(null);
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [duration, setDuration] = useState<number>(3);
  const [generationCount, setGenerationCount] = useState<number>(1);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingJob, setPendingJob] = useState<PendingVideoJob | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endFileInputRef = useRef<HTMLInputElement>(null);
  const restoredPendingRef = useRef(false);
  const [startImageFile, setStartImageFile] = useState<File | null>(null);
  const [endImageFile, setEndImageFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);

  useEffect(() => {
    if (initialImage) {
      setSelectedImage(initialImage);
    }
  }, [initialImage]);

  useEffect(() => {
    if (!workflowHandoff || workflowHandoff.capability !== 'video.image_to_video') return;
    if (workflowHandoff.action === 'materials' || workflowHandoff.action === 'all') {
      const start = workflowHandoff.materials.find((item) => item.slot === 'start_image')
        || workflowHandoff.materials.find((item) => item.type === 'image');
      const end = workflowHandoff.materials.find((item) => item.slot === 'end_image');
      const willOverwrite = Boolean(
        (start && selectedImage && selectedImage !== start.url)
        || (end && selectedEndImage && selectedEndImage !== end.url),
      );
      if (workflowHandoff.action === 'materials' && willOverwrite && !window.confirm('Replace the media currently selected on this page with the template materials?')) return;
      if (start) { setSelectedImage(start.url); setStartImageFile(null); }
      if (end) { setSelectedEndImage(end.url); setEndImageFile(null); }
      if (workflowHandoff.action === 'materials') return;
    }
    const next = workflowHandoff.settings;
    const nextPrompt = workflowHandoff.prompt || (typeof next.prompt === 'string' ? next.prompt : '');
    const willOverwrite = Boolean(prompt.trim() && prompt !== nextPrompt);
    if (workflowHandoff.action === 'prompt' && willOverwrite && !window.confirm('Replace the prompt and settings currently entered on this page?')) return;
    setPrompt(nextPrompt);
    if (next.resolution === '720p' || next.resolution === '1080p') setResolution(next.resolution);
    if (typeof next.duration === 'number') setDuration(next.duration);
    if (typeof next.outputCount === 'number') setGenerationCount(next.outputCount);
    if (typeof next.generateAudio === 'boolean') setGenerateAudio(next.generateAudio);
  }, [workflowHandoff?.nonce]);

  useEffect(() => {
    const existing = getPendingVideoJob();
    if (!existing || existing.mode !== 'image_to_video' || restoredPendingRef.current) return;

    restoredPendingRef.current = true;
    setPendingJob(existing);
    setPrompt(existing.prompt || '');
    setSelectedImage(existing.startImageUrl || null);
    setSelectedEndImage(existing.endImageUrl || null);
    setDuration(existing.duration || 3);
    setResolution(existing.resolution || '720p');
    setGenerationCount(existing.requestedOutputCount || 1);
    setGenerateAudio(existing.generateAudio !== false);

    onGenerate({
      id: existing.clientJobId,
      type: 'Image to Video',
      model: existing.resolution === '1080p' ? 'Pro' : 'Standard',
      resolution: existing.resolution || '720p',
      prompt: existing.prompt || '',
      duration: formatDuration(existing.duration),
      aspectRatio: '16:9',
      timestamp: 'Pending',
      bgColor: 'bg-slate-900/50',
      sourceImage: existing.startImageUrl,
      status: 'pending',
      requestId: existing.requestId,
      creditsUsed: existing.creditsUsed,
      templateRunId: existing.templateRunId,
      templateStepId: existing.templateStepId,
      templateCapability: existing.templateCapability,
      error: 'This video was already submitted. Click Resume to check the same job.',
    });
  }, [onGenerate]);

  const uploadImageIfNeeded = async (
    selectedUrl: string | null,
    file: File | null,
    label: 'start' | 'end'
  ): Promise<string | undefined> => {
    if (!selectedUrl) return undefined;
    if (!file || !selectedUrl.startsWith('blob:')) return selectedUrl;

    const timestamp = Date.now();
    const fileExt = file.name.split('.').pop() || 'jpg';
    const filePath = `video-inputs/${timestamp}-${label}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('generations')
      .upload(filePath, file, { contentType: file.type });
    
    if (uploadError) {
      console.error(`${label} frame upload error:`, uploadError);
      throw new Error(label === 'start' ? 'Failed to upload image. Please try again.' : 'Failed to upload end frame.');
    }
    
    const { data: urlData } = supabase.storage
      .from('generations')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  };

  const applyResult = (placeholderId: string, result: Awaited<ReturnType<typeof generateVideo>>) => {
    if (result.success && result.videoUrl) {
      setPendingJob(null);
      onUpdate?.(placeholderId, {
        status: 'completed',
        videoUrl: result.videoUrl,
        timestamp: 'Just now',
        error: undefined,
        requestId: result.requestId,
        creditsUsed: result.creditsUsed,
        templateRunId: result.templateRunId,
        templateStepId: result.templateStepId,
        templateCapability: result.templateCapability,
      });
      return;
    }

    if (result.pending) {
      if (result.pendingJob) setPendingJob(result.pendingJob);
      onUpdate?.(placeholderId, {
        status: 'pending',
        error: result.error || 'Video submitted. Status check failed. Click Resume instead of Generate.',
        requestId: result.requestId || result.pendingJob?.requestId,
        templateRunId: result.templateRunId || result.pendingJob?.templateRunId,
        templateStepId: result.templateStepId || result.pendingJob?.templateStepId,
        templateCapability: result.templateCapability || result.pendingJob?.templateCapability,
      });
      alert(result.error || 'Video submitted. Status check failed. Please click Resume instead of generating again.');
      return;
    }

    setPendingJob(null);
    onUpdate?.(placeholderId, {
      status: 'failed',
      error: result.error || 'Video generation failed.',
      timestamp: 'Failed',
      requestId: result.requestId,
      templateRunId: result.templateRunId,
      templateStepId: result.templateStepId,
      templateCapability: result.templateCapability,
    });
    alert(result.error || 'Video generation failed. Please try again.');
  };

  const handleResumePending = async () => {
    const existing = pendingJob || getPendingVideoJob();
    if (!existing) return;

    setPendingJob(existing);
    setIsGenerating(true);

    try {
      const result = await pollPendingVideoJob();
      applyResult(existing.clientJobId, result);
    } catch (error) {
      console.error('Resume video job error:', error);
      onUpdate?.(existing.clientJobId, {
        status: 'pending',
        error: error instanceof Error ? error.message : 'Failed to resume status check.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    const existing = getPendingVideoJob();
    if (existing && existing.mode === 'image_to_video') {
      await handleResumePending();
      return;
    }

    if (existing && existing.mode !== 'image_to_video') {
      alert(`A ${existing.mode} job is already pending. Resume that job before submitting a new one.`);
      return;
    }

    if (!selectedImage) {
      alert('Please upload a first frame image.');
      return;
    }
    if (!isPro && (resolution === '1080p' || generationCount > 1)) {
      onProRequired();
      return;
    }
    const requiredCredits = estimateVideoCredits({
      mode: 'image_to_video', duration, resolution, generationCount, generateAudio,
    });
    if (userCredits < requiredCredits) {
      onInsufficientCredits(requiredCredits);
      return;
    }
    
    const batchTimestamp = Date.now();
    const placeholderIds = Array.from(
      { length: generationCount },
      (_, index) => `video-${batchTimestamp}-${index + 1}`,
    );
    placeholderIds.forEach((placeholderId, index) => {
      onGenerate({
        id: placeholderId,
        type: 'Image to Video',
        model: resolution === '1080p' ? 'Pro' : 'Standard',
        resolution,
        prompt,
        duration: formatDuration(duration),
        aspectRatio: '16:9',
        timestamp: index === 0 ? 'Uploading' : 'Queued',
        bgColor: 'bg-slate-900/50',
        sourceImage: selectedImage,
        status: 'pending',
      });
    });
    setIsGenerating(true);
    
    try {
      const startImageUrl = await uploadImageIfNeeded(selectedImage, startImageFile, 'start');
      if (!startImageUrl) throw new Error('Please upload a first frame image.');

      placeholderIds.forEach((placeholderId) => onUpdate?.(placeholderId, {
        sourceImage: startImageUrl,
        timestamp: 'Submitting',
      }));

      let endImageUrl: string | undefined;
      if (selectedEndImage && endImageFile) {
        try {
          endImageUrl = await uploadImageIfNeeded(selectedEndImage, endImageFile, 'end');
        } catch (endErr) {
          console.warn('End frame upload skipped:', endErr);
        }
      }

      await Promise.all(
        placeholderIds.map(async (placeholderId) => {
          const result = await generateVideo({
            mode: 'image_to_video',
            prompt,
            startImageUrl,
            endImageUrl,
            duration,
            resolution,
            generationCount: 1,
            requestedOutputCount: generationCount,
            generateAudio,
            allowConcurrent: generationCount > 1,
            clientJobId: placeholderId,
            onJobSubmitted: (job) => {
              setPendingJob(job);
              onUpdate?.(placeholderId, {
                status: 'pending',
                timestamp: 'Generating',
                requestId: job.requestId,
                creditsUsed: job.creditsUsed,
                templateRunId: job.templateRunId,
                templateStepId: job.templateStepId,
                templateCapability: job.templateCapability,
              });
            },
          });
          applyResult(placeholderId, result);
        }),
      );
    } catch (error) {
      console.error('Video generation error:', error);
      placeholderIds.forEach((placeholderId) => onUpdate?.(placeholderId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Video generation failed. Please try again.',
        timestamp: 'Failed',
      }));
      alert(error instanceof Error ? error.message : 'Video generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEndFrame = false) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      if (isEndFrame) {
        setSelectedEndImage(url);
        setEndImageFile(file);
      } else {
        setSelectedImage(url);
        setStartImageFile(file);
      }
    }
  };

  const estimatedCredits = estimateVideoCredits({
    mode: 'image_to_video',
    duration,
    resolution,
    generationCount,
    generateAudio,
  });
  const buttonLabel = pendingJob ? 'Resume' : `${estimatedCredits} Generate`;

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Source Media</label>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="group relative flex aspect-square flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition-all hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800">
              {selectedImage ? (
                <>
                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-zoom-in"
                    onClick={() => setPreviewImage({ url: selectedImage, alt: 'First frame' })}
                    aria-label="Preview first frame"
                  >
                    <img src={selectedImage} alt="First frame" className="h-full w-full object-contain" />
                  </button>
                  <div className="absolute right-2 top-2 z-20 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setPreviewImage({ url: selectedImage, alt: 'First frame' })}
                      className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black"
                      title="Preview image"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black"
                      title="Replace image"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedImage(null);
                        setStartImageFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-red-500"
                      title="Delete image"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="flex h-full w-full cursor-pointer flex-col items-center justify-center"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="mb-2 h-6 w-6 text-slate-400 group-hover:text-purple-500 transition-colors" />
                  <span className="text-xs font-medium text-slate-500">First frame</span>
                </button>
              )}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={(e) => handleImageUpload(e, false)} 
                className="hidden" 
                accept="image/*" 
              />
            </div>

            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 shadow-sm shrink-0">
              <ArrowRightLeft className="h-4 w-4 text-slate-400" />
            </div>

            <div className="group relative flex aspect-square flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition-all hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800">
              {selectedEndImage ? (
                <>
                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-zoom-in"
                    onClick={() => setPreviewImage({ url: selectedEndImage, alt: 'End frame' })}
                    aria-label="Preview end frame"
                  >
                    <img src={selectedEndImage} alt="End frame" className="h-full w-full object-contain" />
                  </button>
                  <div className="absolute right-2 top-2 z-20 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setPreviewImage({ url: selectedEndImage, alt: 'End frame' })}
                      className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black"
                      title="Preview image"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => endFileInputRef.current?.click()}
                      className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black"
                      title="Replace image"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEndImage(null);
                        setEndImageFile(null);
                        if (endFileInputRef.current) endFileInputRef.current.value = '';
                      }}
                      className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-red-500"
                      title="Delete image"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="flex h-full w-full cursor-pointer flex-col items-center justify-center"
                  onClick={() => endFileInputRef.current?.click()}
                >
                  <ImageIcon className="mb-2 h-6 w-6 text-slate-400 group-hover:text-purple-500 transition-colors" />
                  <span className="text-xs font-medium text-slate-500">End frame (opt)</span>
                </button>
              )}
              <input 
                type="file" 
                ref={endFileInputRef} 
                onChange={(e) => handleImageUpload(e, true)} 
                className="hidden" 
                accept="image/*" 
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Prompt</label>
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the video you want to generate. Be specific about camera movement, lighting, and action..."
              className="min-h-[120px] w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 text-sm outline-none placeholder:text-slate-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 dark:focus:border-purple-500"
            />
          </div>
        </div>

        {pendingJob && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            A job is already submitted. Use Resume to check the same job. Do not generate again.
          </div>
        )}
      </div>

      <div className="relative z-50 w-full shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-4 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.2)]">
        {isParamsOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-4 w-[calc(100%-32px)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-2xl">
            <div className="mb-4 flex flex-col gap-5">
              <div>
                <label className="mb-2 block text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Resolution</label>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 p-0.5 dark:bg-slate-800/50">
                  {['720p', '1080p'].map((res) => (
                    <button
                      key={res}
                      onClick={() => {
                        if (res === '1080p' && !isPro) {
                          onProRequired();
                          return;
                        }
                        setResolution(res as '720p' | '1080p');
                      }}
                      className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        resolution === res 
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' 
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {res}
                      {res !== '720p' && (
                        <span className="absolute -top-1.5 -right-1.5 rounded bg-gradient-to-r from-purple-500 to-pink-500 px-1 text-[8px] font-bold text-white shadow-sm">PRO</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/50">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">Generate Audio</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">Include synchronized sound</div>
                </div>
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(event) => setGenerateAudio(event.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-purple-600"
                />
              </label>

              <div>
                <label className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
                  Duration <span className="normal-case tracking-normal text-slate-700 dark:text-slate-200">{duration}s</span>
                </label>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-400">3s</span>
                  <input
                    type="range"
                    min="3"
                    max="15"
                    step="1"
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 dark:bg-slate-700 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
                  />
                  <span className="text-xs font-medium text-slate-400">15s</span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Generation Count</label>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 p-0.5 dark:bg-slate-800/50">
                  {[1, 2, 3, 4].map((count) => (
                    <button
                      key={count}
                      onClick={() => {
                        if (count > 1 && !isPro) {
                          onProRequired();
                          return;
                        }
                        setGenerationCount(count);
                      }}
                      className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        generationCount === count 
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' 
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {count}
                      {count > 1 && (
                        <span className="absolute -top-1.5 -right-1.5 rounded bg-gradient-to-r from-purple-500 to-pink-500 px-1 text-[8px] font-bold text-white shadow-sm">PRO</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                  Creates separate variations in parallel. Total credits equal the single-video cost × count.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsParamsOpen(!isParamsOpen)}
            className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Settings className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {resolution} · {duration}s · {generateAudio ? 'Audio on' : 'Audio off'} · {generationCount}
            </span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isParamsOpen ? 'rotate-180' : ''}`} />
          </button>
          <button 
            onClick={handleGenerate}
            disabled={isGenerating || (!selectedImage && !pendingJob)}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-4 text-sm font-semibold text-white shadow-md hover:from-purple-700 hover:to-pink-700 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-white" />
                <span>{pendingJob ? 'Checking...' : 'Generating...'}</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-white" />
                <span>{buttonLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>
      <MediaLightbox
        url={previewImage?.url || null}
        type="image"
        alt={previewImage?.alt}
        onClose={() => setPreviewImage(null)}
      />
    </>
  );
};
