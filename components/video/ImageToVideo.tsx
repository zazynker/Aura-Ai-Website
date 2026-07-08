import React, { useState, useRef, useEffect } from 'react';
import { 
  Settings, ChevronDown, ArrowRightLeft, ImagePlus, 
  Image as ImageIcon, RefreshCw, Sparkles 
} from 'lucide-react';
import { VideoResult } from '../../utils/video';
import { generateVideo, getPendingVideoJob, pollPendingVideoJob, PendingVideoJob } from '../../utils/generateService';
import { supabase } from '../../utils/supabase';

interface ImageToVideoProps {
  onGenerate: (result: VideoResult) => void;
  onUpdate?: (id: string, updates: Partial<VideoResult>) => void;
  initialImage: string | null;
}

const formatDuration = (seconds?: number) => `00:${String(seconds || 3).padStart(2, '0')}`;

export const ImageToVideo: React.FC<ImageToVideoProps> = ({ onGenerate, onUpdate, initialImage }) => {
  const [prompt, setPrompt] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(initialImage);
  const [selectedEndImage, setSelectedEndImage] = useState<string | null>(null);
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [duration, setDuration] = useState<number>(3);
  const [generationCount, setGenerationCount] = useState<number>(1);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingJob, setPendingJob] = useState<PendingVideoJob | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endFileInputRef = useRef<HTMLInputElement>(null);
  const restoredPendingRef = useRef(false);
  const [startImageFile, setStartImageFile] = useState<File | null>(null);
  const [endImageFile, setEndImageFile] = useState<File | null>(null);

  useEffect(() => {
    if (initialImage) {
      setSelectedImage(initialImage);
    }
  }, [initialImage]);

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

    onGenerate({
      id: existing.clientJobId,
      type: 'Image to Video',
      model: 'Kling 3.0',
      resolution: existing.resolution || '720p',
      prompt: existing.prompt || '',
      duration: formatDuration(existing.duration),
      aspectRatio: '16:9',
      timestamp: 'Pending',
      bgColor: 'bg-slate-900/50',
      sourceImage: existing.startImageUrl,
      status: 'pending',
      requestId: existing.requestId,
      error: 'This video was already submitted. Click Resume to check the same Fal job.',
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
      });
      return;
    }

    if (result.pending) {
      if (result.pendingJob) setPendingJob(result.pendingJob);
      onUpdate?.(placeholderId, {
        status: 'pending',
        error: result.error || 'Video submitted. Status check failed. Click Resume instead of Generate.',
        requestId: result.requestId || result.pendingJob?.requestId,
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
    if (!prompt.trim()) {
      alert('Please enter a prompt.');
      return;
    }
    
    const placeholderId = `video-${Date.now()}`;
    const pendingResult: VideoResult = {
      id: placeholderId,
      type: 'Image to Video',
      model: 'Kling 3.0',
      resolution,
      prompt,
      duration: formatDuration(duration),
      aspectRatio: '16:9',
      timestamp: 'Uploading',
      bgColor: 'bg-slate-900/50',
      sourceImage: selectedImage,
      status: 'pending',
    };

    onGenerate(pendingResult);
    setIsGenerating(true);
    
    try {
      const startImageUrl = await uploadImageIfNeeded(selectedImage, startImageFile, 'start');
      if (!startImageUrl) throw new Error('Please upload a first frame image.');

      onUpdate?.(placeholderId, {
        sourceImage: startImageUrl,
        timestamp: 'Generating',
      });

      let endImageUrl: string | undefined;
      if (selectedEndImage && endImageFile) {
        try {
          endImageUrl = await uploadImageIfNeeded(selectedEndImage, endImageFile, 'end');
        } catch (endErr) {
          console.warn('End frame upload skipped:', endErr);
        }
      }

      const result = await generateVideo({
        mode: 'image_to_video',
        prompt,
        startImageUrl,
        endImageUrl,
        duration,
        resolution,
        generationCount,
        clientJobId: placeholderId,
        onJobSubmitted: (job) => {
          setPendingJob(job);
          onUpdate?.(placeholderId, {
            status: 'pending',
            requestId: job.requestId,
          });
        },
      });

      applyResult(placeholderId, result);
    } catch (error) {
      console.error('Video generation error:', error);
      onUpdate?.(placeholderId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Video generation failed. Please try again.',
        timestamp: 'Failed',
      });
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

  const buttonLabel = pendingJob ? 'Resume' : '36 Generate';

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Source Media</label>
          </div>
          
          <div className="flex items-center gap-3">
            <div 
              className="group relative flex h-32 flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800 transition-all"
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedImage ? (
                <img src={selectedImage} alt="First frame" className="h-full w-full object-cover" />
              ) : (
                <>
                  <ImagePlus className="mb-2 h-6 w-6 text-slate-400 group-hover:text-purple-500 transition-colors" />
                  <span className="text-xs font-medium text-slate-500">First frame</span>
                </>
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

            <div 
              className="group relative flex h-32 flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800 transition-all"
              onClick={() => endFileInputRef.current?.click()}
            >
              {selectedEndImage ? (
                <img src={selectedEndImage} alt="End frame" className="h-full w-full object-cover" />
              ) : (
                <>
                  <ImageIcon className="mb-2 h-6 w-6 text-slate-400 group-hover:text-purple-500 transition-colors" />
                  <span className="text-xs font-medium text-slate-500">End frame (opt)</span>
                </>
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
            A Fal job is already submitted. Use Resume to check the same job. Do not generate again.
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
                      onClick={() => setResolution(res as any)}
                      className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        resolution === res 
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' 
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {res}
                      {res !== '720p' && (
                        <span className="absolute -top-1.5 -right-1.5 rounded bg-gradient-to-r from-pink-400 to-purple-500 px-1 text-[8px] font-bold text-white shadow-sm">PRO</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

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
                      onClick={() => setGenerationCount(count)}
                      className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        generationCount === count 
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' 
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {count}
                      {count > 1 && (
                        <span className="absolute -top-1.5 -right-1.5 rounded bg-gradient-to-r from-pink-400 to-purple-500 px-1 text-[8px] font-bold text-white shadow-sm">PRO</span>
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
            className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Settings className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {resolution} · {duration}s · {generationCount}
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
    </>
  );
};
