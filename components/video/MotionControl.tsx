import React, { useEffect, useRef, useState } from 'react';
import {
  Settings,
  ChevronDown,
  ImagePlus,
  RefreshCw,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { VideoResult } from '../../utils/video';
import { generateVideo, getPendingVideoJob, pollPendingVideoJob, PendingVideoJob } from '../../utils/generateService';
import { supabase } from '../../utils/supabase';
import { estimateVideoCredits } from '../../context/StoreContext';

interface MotionControlProps {
  onGenerate: (result: VideoResult) => void;
  onUpdate?: (id: string, updates: Partial<VideoResult>) => void;
  initialImage: string | null;
  userCredits: number;
  onInsufficientCredits: (requiredCredits: number) => void;
}

type DirectionMatch = 'video' | 'image';
type Resolution = '720p' | '1080p';

const formatDuration = (seconds?: number) => `00:${String(seconds || 5).padStart(2, '0')}`;

export const MotionControl: React.FC<MotionControlProps> = ({ onGenerate, onUpdate, initialImage, userCredits, onInsufficientCredits }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(initialImage);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [directionMatch, setDirectionMatch] = useState<DirectionMatch>('video');
  const [motionPrompt, setMotionPrompt] = useState<string>('');

  const [resolution, setResolution] = useState<Resolution>('720p');
  const [quantity, setQuantity] = useState<number>(1);
  const [duration, setDuration] = useState<number>(5);

  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingJob, setPendingJob] = useState<PendingVideoJob | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const restoredPendingRef = useRef(false);

  useEffect(() => {
    if (initialImage) setSelectedImage(initialImage);
  }, [initialImage]);

  useEffect(() => {
    const existing = getPendingVideoJob();
    if (!existing || existing.mode !== 'motion_control' || restoredPendingRef.current) return;

    restoredPendingRef.current = true;
    setPendingJob(existing);
    setMotionPrompt(existing.prompt || '');
    setSelectedImage(existing.startImageUrl || null);
    setSelectedVideo(existing.inputVideoUrl || null);
    setDirectionMatch(existing.characterOrientation || 'video');
    setResolution(existing.resolution || '720p');
    setDuration(existing.duration || 5);

    onGenerate({
      id: existing.clientJobId,
      type: 'Motion Control',
      model: existing.characterOrientation === 'image'
        ? 'Motion Control · Image Orientation'
        : 'Motion Control · Video Orientation',
      resolution: existing.resolution || '720p',
      prompt: existing.prompt || '',
      duration: formatDuration(existing.duration),
      aspectRatio: '16:9',
      timestamp: 'Pending',
      bgColor: 'bg-indigo-900/50',
      sourceImage: existing.startImageUrl,
      status: 'pending',
      requestId: existing.requestId,
      creditsUsed: existing.creditsUsed,
      error: 'This motion-control job was already submitted. Click Resume to check the same Fal job.',
    });
  }, [onGenerate]);

  const uploadFileIfNeeded = async (
    previewUrl: string | null,
    file: File | null,
    label: 'character-image' | 'driver-video'
  ): Promise<string | undefined> => {
    if (!previewUrl) return undefined;
    if (!file || !previewUrl.startsWith('blob:')) return previewUrl;

    const timestamp = Date.now();
    const fileExt = file.name.split('.').pop() || (label === 'driver-video' ? 'mp4' : 'jpg');
    const filePath = `video-inputs/${timestamp}-${label}.${fileExt}`;

    const { error } = await supabase.storage
      .from('generations')
      .upload(filePath, file, { contentType: file.type });

    if (error) {
      console.error(`[MotionControl] Upload ${label} error:`, error);
      throw new Error(`Failed to upload ${label}. Please try again.`);
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
      });
      return;
    }

    if (result.pending) {
      if (result.pendingJob) setPendingJob(result.pendingJob);
      onUpdate?.(placeholderId, {
        status: 'pending',
        error: result.error || 'Motion-control job submitted. Status check failed. Click Resume instead of Generate.',
        requestId: result.requestId || result.pendingJob?.requestId,
      });
      alert(result.error || 'Motion-control job submitted. Status check failed. Please click Resume instead of generating again.');
      return;
    }

    setPendingJob(null);
    onUpdate?.(placeholderId, {
      status: 'failed',
      error: result.error || 'Motion-control generation failed.',
      timestamp: 'Failed',
      requestId: result.requestId,
    });
    alert(result.error || 'Motion-control generation failed. Please try again.');
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
      console.error('Resume motion-control job error:', error);
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
    if (existing && existing.mode === 'motion_control') {
      await handleResumePending();
      return;
    }

    if (existing && existing.mode !== 'motion_control') {
      alert(`A ${existing.mode} job is already pending. Resume that job before submitting a new one.`);
      return;
    }

    if (!selectedImage) {
      alert('Please upload a character image.');
      return;
    }
    if (!selectedVideo) {
      alert('Please upload a motion reference video.');
      return;
    }
    if (!motionPrompt.trim()) {
      alert('Please enter a motion prompt.');
      return;
    }

    const requiredCredits = estimateVideoCredits({
      mode: 'motion_control', duration, resolution, generationCount: quantity,
    });
    if (userCredits < requiredCredits) {
      onInsufficientCredits(requiredCredits);
      return;
    }

    const placeholderId = `motion-${Date.now()}`;
    const pendingResult: VideoResult = {
      id: placeholderId,
      type: 'Motion Control',
      model: directionMatch === 'video'
        ? 'Motion Control · Video Orientation'
        : 'Motion Control · Image Orientation',
      resolution,
      prompt: motionPrompt,
      duration: formatDuration(duration),
      aspectRatio: '16:9',
      timestamp: 'Uploading',
      bgColor: 'bg-indigo-900/50',
      sourceImage: selectedImage,
      status: 'pending',
    };

    onGenerate(pendingResult);
    setIsGenerating(true);

    try {
      const characterImageUrl = await uploadFileIfNeeded(selectedImage, imageFile, 'character-image');
      const driverVideoUrl = await uploadFileIfNeeded(selectedVideo, videoFile, 'driver-video');

      if (!characterImageUrl || !driverVideoUrl) {
        throw new Error('Both character image and motion reference video are required.');
      }

      onUpdate?.(placeholderId, {
        sourceImage: characterImageUrl,
        timestamp: 'Generating',
      });

      const result = await generateVideo({
        mode: 'motion_control',
        prompt: motionPrompt,
        startImageUrl: characterImageUrl,
        videoUrl: driverVideoUrl,
        characterOrientation: directionMatch,
        duration,
        resolution,
        generationCount: quantity,
        clientJobId: placeholderId,
        onJobSubmitted: (job) => {
          setPendingJob(job);
          onUpdate?.(placeholderId, {
            status: 'pending',
            requestId: job.requestId,
            creditsUsed: job.creditsUsed,
          });
        },
      });

      applyResult(placeholderId, result);
    } catch (error) {
      console.error('Motion control error:', error);
      onUpdate?.(placeholderId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Motion-control generation failed. Please try again.',
        timestamp: 'Failed',
      });
      alert(error instanceof Error ? error.message : 'Motion-control generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setSelectedImage(URL.createObjectURL(file));
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setSelectedVideo(URL.createObjectURL(file));
    }
  };

  const isGenerateDisabled = isGenerating || ((!selectedImage || !selectedVideo || !motionPrompt.trim()) && !pendingJob);
  const estimatedCredits = estimateVideoCredits({
    mode: 'motion_control',
    duration,
    resolution,
    generationCount: quantity,
  });
  const buttonLabel = pendingJob ? 'Resume' : `${estimatedCredits} Generate`;

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 flex flex-col gap-2">
              <div className="group relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition-all dark:border-slate-700 dark:bg-slate-800/50">
                {selectedVideo ? (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/5 dark:bg-slate-900">
                      <video
                        src={selectedVideo}
                        className="h-full w-full object-contain"
                        autoPlay
                        loop
                        muted
                        playsInline
                        onLoadedMetadata={(event) => {
                          const detectedDuration = Math.ceil(event.currentTarget.duration || 5);
                          setDuration(Math.max(1, detectedDuration));
                        }}
                      />
                    </div>
                    <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          videoInputRef.current?.click();
                        }}
                        className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black"
                        title="Replace video"
                        type="button"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVideo(null);
                          setVideoFile(null);
                        }}
                        className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-red-500"
                        title="Delete video"
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    className="flex h-full w-full cursor-pointer flex-col items-center justify-center px-3 text-center hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => videoInputRef.current?.click()}
                  >
                    <ImagePlus className="mb-2 h-6 w-6 text-slate-400 transition-colors group-hover:text-blue-500" />
                    <span className="text-xs font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                      Add video of character actions to mimic
                    </span>
                  </div>
                )}
                <input
                  type="file"
                  ref={videoInputRef}
                  onChange={handleVideoUpload}
                  className="hidden"
                  accept="video/*"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/30 dark:hover:bg-slate-800">
                <input
                  type="radio"
                  name="directionMatch"
                  checked={directionMatch === 'video'}
                  onChange={() => setDirectionMatch('video')}
                  className="h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  Character Orientation Matches Video
                </span>
              </label>
            </div>

            <div className="flex-1 flex flex-col gap-2">
              <div className="group relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition-all dark:border-slate-700 dark:bg-slate-800/50">
                {selectedImage ? (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/5 dark:bg-slate-900">
                      <img src={selectedImage} alt="Character" className="h-full w-full object-contain" />
                    </div>
                    <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black"
                        title="Replace image"
                        type="button"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedImage(null);
                          setImageFile(null);
                        }}
                        className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-red-500"
                        title="Delete image"
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    className="flex h-full w-full cursor-pointer flex-col items-center justify-center px-3 text-center hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="mb-2 h-6 w-6 text-slate-400 transition-colors group-hover:text-blue-500" />
                    <span className="text-xs font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                      Add character image
                    </span>
                  </div>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  className="hidden"
                  accept="image/*"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/30 dark:hover:bg-slate-800">
                <input
                  type="radio"
                  name="directionMatch"
                  checked={directionMatch === 'image'}
                  onChange={() => setDirectionMatch('image')}
                  className="h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  Character Orientation Matches Image
                </span>
              </label>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            When Character Orientation matches the video, complex motions perform better; when it matches the image,
            camera movement is more stable. Refer to the{' '}
            <a href="#" className="text-blue-500 hover:underline">
              upload guide
            </a>{' '}
            for details.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Motion Prompt
          </label>
          <textarea
            value={motionPrompt}
            onChange={(e) => setMotionPrompt(e.target.value)}
            placeholder="Describe how the character should move, act, and perform using the reference motion."
            className="min-h-[100px] w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        {pendingJob && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            A Fal motion-control job is already submitted. Use Resume to check the same job. Do not generate again.
          </div>
        )}
      </div>

      <div className="relative z-50 w-full shrink-0 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-4px_24px_rgba(0,0,0,0.05)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 dark:shadow-[0_-4px_24px_rgba(0,0,0,0.2)]">
        {isParamsOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-4 w-[calc(100%-32px)] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Mode</label>
                <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  {(['720p', '1080p'] as const).map((res) => (
                    <button
                      key={res}
                      onClick={() => setResolution(res)}
                      type="button"
                      className={`relative flex-1 rounded-md py-2 text-sm font-semibold transition-all ${
                        resolution === res
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {res}
                      {res === '1080p' && (
                        <span className="absolute -top-1.5 -right-1.5 rounded bg-gradient-to-r from-pink-400 to-purple-500 px-1 text-[8px] font-bold text-white shadow-sm">
                          PRO
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Number of Outputs</label>
                <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  {[1, 2, 3, 4].map((num) => (
                    <button
                      key={num}
                      onClick={() => setQuantity(num)}
                      type="button"
                      className={`relative flex-1 rounded-md py-2 text-sm font-semibold transition-all ${
                        quantity === num
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {num}
                      {num > 1 && (
                        <span className="absolute -top-1.5 -right-1.5 rounded bg-gradient-to-r from-pink-400 to-purple-500 px-1 text-[8px] font-bold text-white shadow-sm">
                          PRO
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsParamsOpen(!isParamsOpen)}
            className="flex h-11 min-w-[108px] items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800"
            type="button"
          >
            <div className="flex items-center gap-1.5">
              <Settings className="h-4 w-4 text-slate-500" />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {resolution} · {quantity}
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isParamsOpen ? 'rotate-180' : ''}`} />
          </button>

          <button
            onClick={handleGenerate}
            disabled={isGenerateDisabled}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-md transition-all hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-900"
            type="button"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-white" />
                <span>{pendingJob ? 'Checking...' : 'Applying Motion...'}</span>
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
    </>
  );
};
