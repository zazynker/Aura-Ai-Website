import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ImagePlus,
  RefreshCw,
  Mic,
  Volume2,
  Video,
  Trash2,
  Play,
  Pause,
  GripVertical,
  Sparkles,
} from 'lucide-react';
import { VideoResult } from '../../utils/video';
import { generateVideo, getPendingVideoJob, pollPendingVideoJob, PendingVideoJob } from '../../utils/generateService';
import { supabase } from '../../utils/supabase';

interface LipSyncProps {
  onGenerate: (result: VideoResult) => void;
  onUpdate?: (id: string, updates: Partial<VideoResult>) => void;
  initialImage: string | null;
}

type MediaState = { url: string; type: 'image' | 'video'; file?: File };
type DragMode = 'playhead' | 'audio-move' | 'audio-trim-left' | 'audio-trim-right' | null;

type DragSession = {
  mode: Exclude<DragMode, null>;
  startClientX: number;
  startCurrentTime: number;
  startAudioStartTime: number;
  startAudioTrimStart: number;
  startAudioTrimEnd: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const formatTime = (timeInSeconds: number) => {
  if (!Number.isFinite(timeInSeconds)) return '00:00';
  const mins = Math.floor(Math.max(0, timeInSeconds) / 60);
  const secs = Math.floor(Math.max(0, timeInSeconds) % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const LipSync: React.FC<LipSyncProps> = ({ onGenerate, onUpdate, initialImage }) => {
  const [selectedMedia, setSelectedMedia] = useState<MediaState | null>(
    initialImage ? { url: initialImage, type: 'image' } : null
  );
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);

  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingJob, setPendingJob] = useState<PendingVideoJob | null>(null);

  const [prompt, setPrompt] = useState(
    'Keep the camera fixed. The character speaks naturally, smiles slightly, and uses subtle hand gestures.'
  );
  const [selectedPerson, setSelectedPerson] = useState<number>(1);

  // Timeline states
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [audioStartTime, setAudioStartTime] = useState(0);
  const [audioTrimStart, setAudioTrimStart] = useState(0);
  const [audioTrimEnd, setAudioTrimEnd] = useState(0);
  const [videoThumbnails, setVideoThumbnails] = useState<string[]>([]);
  const [dragMode, setDragMode] = useState<DragMode>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const createdObjectUrlsRef = useRef<string[]>([]);
  const restoredPendingRef = useRef(false);

  const timelineDuration = Math.max(videoDuration || 0, selectedMedia?.type === 'video' ? 3 : 0);
  const minAudioClipLength = Math.min(2, Math.max(0.2, audioDuration || 0.2));
  const effectiveAudioLength = Math.max(0, audioTrimEnd - audioTrimStart);
  const basePixelsPerSecond = 56;
  const naturalTimelineWidth = Math.max(1, timelineDuration * basePixelsPerSecond * timelineZoom);
  const timelineContentWidth = Math.max(timelineViewportWidth || 0, naturalTimelineWidth);
  const pixelsPerSecond = timelineDuration > 0 ? timelineContentWidth / timelineDuration : 0;

  const waveformBars = useMemo(
    () =>
      Array.from({ length: 72 }, (_, i) => {
        // Stable pseudo-waveform: no Math.random() in render, so it does not flicker.
        const a = Math.sin(i * 1.9) * 0.5 + 0.5;
        const b = Math.sin(i * 0.47 + 1.3) * 0.5 + 0.5;
        return Math.round(22 + (a * 0.65 + b * 0.35) * 58);
      }),
    [audioFile?.name]
  );

  useEffect(() => {
    return () => {
      createdObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const existing = getPendingVideoJob();
    if (!existing || existing.mode !== 'lip_sync' || restoredPendingRef.current) return;

    restoredPendingRef.current = true;
    setPendingJob(existing);

    if (existing.startImageUrl) {
      setSelectedMedia({ url: existing.startImageUrl, type: 'image' });
    } else if (existing.inputVideoUrl) {
      setSelectedMedia({ url: existing.inputVideoUrl, type: 'video' });
    }
    if (existing.audioUrl) setAudioUrl(existing.audioUrl);
    if (existing.prompt) setPrompt(existing.prompt);

    onGenerate({
      id: existing.clientJobId,
      type: 'Lip Sync',
      model: existing.startImageUrl ? 'Kling AI Avatar' : 'Kling Lip Sync',
      resolution: '720p',
      prompt: existing.prompt || 'Lip sync generation',
      duration: formatTime(existing.duration || 0),
      aspectRatio: existing.startImageUrl ? '1:1' : '16:9',
      timestamp: 'Pending',
      bgColor: 'bg-emerald-900/50',
      sourceImage: existing.startImageUrl,
      sourceVideo: existing.inputVideoUrl,
      audioUrl: existing.audioUrl,
      status: 'pending',
      requestId: existing.requestId,
      mode: 'lip_sync',
      error: 'This lip sync job was already submitted. Click Resume to check the same Fal job.',
    });
  }, [onGenerate]);

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;

    const updateWidth = () => setTimelineViewportWidth(el.clientWidth);
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectedMedia?.type]);

  useEffect(() => {
    if (!audioDuration) return;

    const maxLength = timelineDuration ? Math.min(audioDuration, timelineDuration) : audioDuration;
    setAudioTrimStart(0);
    setAudioTrimEnd(maxLength);
    setAudioStartTime(0);
  }, [audioDuration, timelineDuration]);

  useEffect(() => {
    if (!timelineDuration || !audioFile) return;

    const maxStart = Math.max(0, timelineDuration - effectiveAudioLength);
    setAudioStartTime((value) => clamp(value, 0, maxStart));
    setCurrentTime((value) => clamp(value, 0, timelineDuration));
  }, [timelineDuration, effectiveAudioLength, audioFile]);

  useEffect(() => {
    if (selectedMedia?.type !== 'video') {
      setVideoThumbnails([]);
      return;
    }

    let cancelled = false;
    const captureFrames = async () => {
      try {
        const video = document.createElement('video');
        video.src = selectedMedia.url;
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';

        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Failed to load video metadata'));
        });

        const duration = video.duration || 3;
        const canvas = document.createElement('canvas');
        const width = 120;
        const height = 68;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const frames: string[] = [];
        const frameCount = 8;
        for (let i = 0; i < frameCount; i += 1) {
          const time = clamp((duration * i) / Math.max(1, frameCount - 1), 0, Math.max(0, duration - 0.05));
          video.currentTime = time;
          await new Promise<void>((resolve) => {
            video.onseeked = () => resolve();
          });
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(video, 0, 0, width, height);
          frames.push(canvas.toDataURL('image/jpeg', 0.72));
        }

        if (!cancelled) setVideoThumbnails(frames);
      } catch {
        if (!cancelled) setVideoThumbnails([]);
      }
    };

    captureFrames();
    return () => {
      cancelled = true;
    };
  }, [selectedMedia?.url, selectedMedia?.type]);

  const uploadFileIfNeeded = async (url: string, file: File | undefined | null, label: string): Promise<string> => {
    if (!file || !url.startsWith('blob:')) return url;

    const fileExt = file.name.split('.').pop() || (file.type.startsWith('audio/') ? 'mp3' : file.type.startsWith('video/') ? 'mp4' : 'jpg');
    const safeLabel = label.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
    const filePath = `video-inputs/${Date.now()}-${safeLabel}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('generations')
      .upload(filePath, file, { contentType: file.type || 'application/octet-stream' });

    if (uploadError) {
      console.error(`${label} upload error:`, uploadError);
      throw new Error(`Failed to upload ${label}. Please try again.`);
    }

    const { data: urlData } = supabase.storage
      .from('generations')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  };

  const applyLipSyncResult = (placeholderId: string, result: Awaited<ReturnType<typeof generateVideo>>) => {
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
        error: result.error || 'Lip sync was submitted. Status check failed. Click Resume instead of Generate.',
        requestId: result.requestId || result.pendingJob?.requestId,
      });
      alert(result.error || 'Lip sync was submitted. Please click Resume instead of generating again.');
      return;
    }

    setPendingJob(null);
    onUpdate?.(placeholderId, {
      status: 'failed',
      error: result.error || 'Lip sync generation failed.',
      timestamp: 'Failed',
      requestId: result.requestId,
    });
    alert(result.error || 'Lip sync generation failed. Please try again.');
  };

  const handleResumePending = async () => {
    const existing = pendingJob || getPendingVideoJob();
    if (!existing || existing.mode !== 'lip_sync') return;

    setPendingJob(existing);
    setIsGenerating(true);

    try {
      const result = await pollPendingVideoJob();
      applyLipSyncResult(existing.clientJobId, result);
    } catch (error) {
      console.error('Resume lip sync job error:', error);
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
    if (existing && existing.mode === 'lip_sync') {
      await handleResumePending();
      return;
    }

    if (existing && existing.mode !== 'lip_sync') {
      alert(`A ${existing.mode} job is already pending. Resume that job before submitting a new one.`);
      return;
    }

    if (!selectedMedia) {
      alert('Please upload a character image or video.');
      return;
    }
    if (!audioFile || !audioUrl) {
      alert('Please upload an audio track.');
      return;
    }

    const resultDuration = Math.ceil(
      selectedMedia.type === 'video' ? timelineDuration || effectiveAudioLength || 5 : audioDuration || 5
    );

    const placeholderId = `lip-${Date.now()}`;
    const promptText =
      selectedMedia.type === 'video'
        ? `Audio Sync: ${audioFile.name} • Person ${selectedPerson} • audio ${formatTime(audioStartTime)}-${formatTime(
            audioStartTime + effectiveAudioLength
          )}`
        : `AI Avatar: ${audioFile.name} • ${prompt}`;

    onGenerate({
      id: placeholderId,
      type: 'Lip Sync',
      model: selectedMedia.type === 'image' ? 'Kling AI Avatar' : 'Kling Lip Sync',
      resolution: '720p',
      prompt: promptText,
      duration: formatTime(resultDuration),
      aspectRatio: selectedMedia.type === 'image' ? '1:1' : '16:9',
      timestamp: 'Uploading',
      bgColor: 'bg-emerald-900/50',
      sourceImage: selectedMedia.type === 'image' ? selectedMedia.url : undefined,
      sourceVideo: selectedMedia.type === 'video' ? selectedMedia.url : undefined,
      status: 'pending',
      mode: 'lip_sync',
    });

    setIsGenerating(true);

    try {
      const uploadedAudioUrl = await uploadFileIfNeeded(audioUrl, audioFile, 'audio');
      const uploadedMediaUrl = await uploadFileIfNeeded(
        selectedMedia.url,
        selectedMedia.file,
        selectedMedia.type === 'video' ? 'lip-sync-video' : 'avatar-image'
      );

      onUpdate?.(placeholderId, {
        timestamp: 'Generating',
        sourceImage: selectedMedia.type === 'image' ? uploadedMediaUrl : undefined,
        sourceVideo: selectedMedia.type === 'video' ? uploadedMediaUrl : undefined,
        audioUrl: uploadedAudioUrl,
      });

      const result = await generateVideo({
        mode: 'lip_sync',
        prompt: selectedMedia.type === 'image' ? prompt : undefined,
        startImageUrl: selectedMedia.type === 'image' ? uploadedMediaUrl : undefined,
        videoUrl: selectedMedia.type === 'video' ? uploadedMediaUrl : undefined,
        audioUrl: uploadedAudioUrl,
        duration: resultDuration,
        resolution: '720p',
        clientJobId: placeholderId,
        onJobSubmitted: (job) => {
          setPendingJob(job);
          onUpdate?.(placeholderId, {
            status: 'pending',
            requestId: job.requestId,
          });
        },
      });

      applyLipSyncResult(placeholderId, result);
    } catch (error) {
      console.error('Lip sync generation error:', error);
      onUpdate?.(placeholderId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Lip sync generation failed. Please try again.',
        timestamp: 'Failed',
      });
      alert(error instanceof Error ? error.message : 'Lip sync generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    createdObjectUrlsRef.current.push(url);

    setSelectedMedia({ url, type: isVideo ? 'video' : 'image', file });
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoDuration(0);
    setVideoThumbnails([]);
    videoRef.current?.pause();

    e.target.value = '';
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    createdObjectUrlsRef.current.push(url);

    setAudioFile(file);
    setAudioUrl(url);
    setAudioDuration(0);
    setAudioStartTime(0);
    setAudioTrimStart(0);
    setAudioTrimEnd(0);

    const audio = new Audio(url);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const realDuration = Number.isFinite(audio.duration) ? audio.duration : 5;
      setAudioDuration(realDuration);
      setAudioTrimEnd(Math.min(realDuration, timelineDuration || realDuration));
    };

    e.target.value = '';
  };

  const removeSelectedMedia = () => {
    videoRef.current?.pause();
    setSelectedMedia(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoDuration(0);
    setVideoThumbnails([]);
  };

  const removeAudio = () => {
    setAudioFile(null);
    setAudioUrl(null);
    setAudioDuration(0);
    setAudioStartTime(0);
    setAudioTrimStart(0);
    setAudioTrimEnd(0);
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused || video.ended) {
      try {
        await video.play();
      } catch (error) {
        console.error('Unable to play video', error);
      }
    } else {
      video.pause();
    }
  };

  const handleTimeUpdate = () => {
    if (!dragSessionRef.current && videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleVideoLoaded = () => {
    const video = videoRef.current;
    if (!video) return;

    const realDuration = Number.isFinite(video.duration) ? video.duration : 3;
    setVideoDuration(realDuration);
    setCurrentTime(0);
    video.currentTime = 0;
  };

  const seekTo = (time: number) => {
    const clamped = clamp(time, 0, timelineDuration || 0);
    setCurrentTime(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  const clientXToTimelineTime = (clientX: number) => {
    const content = timelineContentRef.current;
    if (!content || !timelineDuration) return 0;

    const rect = content.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, timelineContentWidth);
    return clamp((x / timelineContentWidth) * timelineDuration, 0, timelineDuration);
  };

  const clientDeltaXToSeconds = (deltaX: number) => {
    if (!pixelsPerSecond) return 0;
    return deltaX / pixelsPerSecond;
  };

  const startDrag = (mode: Exclude<DragMode, null>, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();

    dragSessionRef.current = {
      mode,
      startClientX: event.clientX,
      startCurrentTime: currentTime,
      startAudioStartTime: audioStartTime,
      startAudioTrimStart: audioTrimStart,
      startAudioTrimEnd: audioTrimEnd,
    };
    setDragMode(mode);

    if (mode === 'playhead') {
      videoRef.current?.pause();
      seekTo(clientXToTimelineTime(event.clientX));
    }
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;

      const dxSeconds = clientDeltaXToSeconds(event.clientX - session.startClientX);

      if (session.mode === 'playhead') {
        seekTo(clientXToTimelineTime(event.clientX));
        return;
      }

      if (!audioFile || !timelineDuration || !audioDuration) return;

      const startLength = session.startAudioTrimEnd - session.startAudioTrimStart;

      if (session.mode === 'audio-move') {
        const maxStart = Math.max(0, timelineDuration - startLength);
        setAudioStartTime(clamp(session.startAudioStartTime + dxSeconds, 0, maxStart));
        return;
      }

      if (session.mode === 'audio-trim-left') {
        // Trim the source audio from the left without visually compressing the waveform.
        // Keep the original source-audio position stable, then move the visible clip edge.
        const sourceStartOnTimeline = session.startAudioStartTime - session.startAudioTrimStart;
        const minNextTrimStart = Math.max(0, -sourceStartOnTimeline);
        const maxNextTrimStart = Math.max(
          minNextTrimStart,
          session.startAudioTrimEnd - minAudioClipLength
        );
        const nextTrimStart = clamp(
          session.startAudioTrimStart + dxSeconds,
          minNextTrimStart,
          maxNextTrimStart
        );
        const nextAudioStartTime = sourceStartOnTimeline + nextTrimStart;
        setAudioTrimStart(nextTrimStart);
        setAudioStartTime(nextAudioStartTime);
        return;
      }

      if (session.mode === 'audio-trim-right') {
        // Trim the source audio from the right. The left edge stays fixed on the timeline.
        const maxTrimEndByTimeline = session.startAudioTrimStart + (timelineDuration - session.startAudioStartTime);
        const maxTrimEnd = Math.min(audioDuration, maxTrimEndByTimeline);
        const nextTrimEnd = clamp(
          session.startAudioTrimEnd + dxSeconds,
          session.startAudioTrimStart + minAudioClipLength,
          maxTrimEnd
        );
        setAudioTrimEnd(nextTrimEnd);
      }
    };

    const handlePointerUp = () => {
      if (!dragSessionRef.current) return;
      dragSessionRef.current = null;
      setDragMode(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    audioDuration,
    audioFile,
    audioTrimStart,
    audioTrimEnd,
    audioStartTime,
    currentTime,
    minAudioClipLength,
    pixelsPerSecond,
    timelineContentWidth,
    timelineDuration,
  ]);

  const renderMediaPreview = () => {
    if (!selectedMedia) {
      return (
        <div
          className="flex h-full w-full cursor-pointer flex-col items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="mb-2 flex gap-2">
            <ImagePlus className="h-6 w-6 text-slate-400 transition-colors group-hover:text-emerald-500" />
            <Video className="h-6 w-6 text-slate-400 transition-colors group-hover:text-emerald-500" />
          </div>
          <span className="text-sm font-medium text-slate-500">Upload Character Image or Video</span>
        </div>
      );
    }

    return (
      <>
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/5 dark:bg-slate-950">
          {selectedMedia.type === 'video' ? (
            <video
              ref={videoRef}
              src={selectedMedia.url}
              className="h-full w-full bg-black/10 object-contain"
              playsInline
              preload="metadata"
              autoPlay={false}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleVideoLoaded}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            />
          ) : (
            <img src={selectedMedia.url} alt="Character" className="h-full w-full object-contain" />
          )}
        </div>

        <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black"
            title="Replace Media"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeSelectedMedia();
            }}
            className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-red-500"
            title="Delete Media"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </>
    );
  };

  const renderTimeline = () => {
    if (selectedMedia?.type !== 'video') return null;

    const audioClipLeft = audioStartTime * pixelsPerSecond;
    const audioClipWidth = Math.max(0, effectiveAudioLength * pixelsPerSecond);
    const audioSourceLeft = (audioStartTime - audioTrimStart) * pixelsPerSecond;
    const audioSourceWidth = Math.max(1, audioDuration * pixelsPerSecond);
    const playheadLeft = currentTime * pixelsPerSecond;
    const rulerTicks = Array.from({ length: 5 }, (_, i) => (timelineDuration * i) / 4);

    const renderWaveform = (tone: 'muted' | 'active') => (
      <div className="flex h-full items-center justify-around gap-[2px] px-4">
        {waveformBars.map((height, index) => (
          <div
            key={index}
            className={`w-0.5 shrink-0 rounded-full ${
              tone === 'active'
                ? 'bg-emerald-500 dark:bg-emerald-400'
                : 'bg-slate-300 dark:bg-slate-600'
            }`}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    );

    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {formatTime(currentTime)} / {formatTime(timelineDuration)}
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-[10px] text-slate-400">▵</span>
            <input
              type="range"
              min="1"
              max="5"
              step="0.25"
              value={timelineZoom}
              onChange={(event) => setTimelineZoom(Number(event.target.value))}
              className="h-1 w-20 cursor-pointer accent-emerald-500"
              aria-label="Timeline zoom"
            />
            <span className="text-xs text-slate-500">▴</span>
          </div>
        </div>

        <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
          <div className="space-y-2 pt-7 text-[10px] font-medium text-slate-500 dark:text-slate-400">
            <div className="h-12 leading-[48px]">Video</div>
            <div className="h-14 leading-[56px]">Audio</div>
          </div>

          <div ref={timelineScrollRef} className="overflow-x-auto overflow-y-visible pb-3">
            <div
              ref={timelineContentRef}
              className={`relative overflow-visible ${dragMode ? 'cursor-grabbing' : ''}`}
              style={{ width: `${timelineContentWidth}px`, minWidth: '100%' }}
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return;
                startDrag('playhead', event);
              }}
            >
              {/* Time ruler. Keep enough height so tick labels and playhead knob are not clipped. */}
              <div
                className="relative h-7 border-b border-slate-200 dark:border-slate-600"
                onPointerDown={(event) => startDrag('playhead', event)}
              >
                {rulerTicks.map((time, index) => (
                  <div
                    key={time}
                    className="absolute bottom-1 select-none font-mono text-[9px] text-slate-400"
                    style={{
                      left: `${time * pixelsPerSecond}px`,
                      transform:
                        index === 0
                          ? 'translateX(0)'
                          : index === rulerTicks.length - 1
                            ? 'translateX(-100%)'
                            : 'translateX(-50%)',
                    }}
                  >
                    {formatTime(time)}
                  </div>
                ))}
              </div>

              <div
                className="relative mt-2 h-12 overflow-hidden rounded-md bg-slate-200 dark:bg-slate-700"
                onPointerDown={(event) => startDrag('playhead', event)}
              >
                {videoThumbnails.length > 0 ? (
                  <div className="flex h-full w-full">
                    {videoThumbnails.map((thumb, index) => (
                      <div
                        key={`${thumb}-${index}`}
                        className="h-full flex-1 border-r border-white/50 bg-cover bg-center last:border-r-0 dark:border-slate-600"
                        style={{ backgroundImage: `url(${thumb})` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-slate-200 text-[10px] text-slate-400 dark:bg-slate-700">
                    Video frames
                  </div>
                )}
              </div>

              <div
                className="relative mt-2 h-14 overflow-hidden rounded-md border border-dashed border-slate-300 bg-white/60 dark:border-slate-600 dark:bg-slate-900/40"
                onPointerDown={(event) => startDrag('playhead', event)}
              >
                {audioFile && audioDuration && audioUrl ? (
                  <>
                    {/* Full source audio waveform ghost. This shows what has been trimmed away instead of compressing the waveform. */}
                    <div
                      className="pointer-events-none absolute top-1 bottom-1 overflow-hidden rounded-md opacity-70"
                      style={{ left: `${audioSourceLeft}px`, width: `${audioSourceWidth}px` }}
                    >
                      {renderWaveform('muted')}
                    </div>

                    {/* Visible selected / synced audio segment. */}
                    <div
                      className="absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md border border-emerald-300 bg-emerald-100 shadow-sm active:cursor-grabbing dark:border-emerald-700 dark:bg-emerald-900/40"
                      style={{ left: `${audioClipLeft}px`, width: `${audioClipWidth}px` }}
                      onPointerDown={(event) => startDrag('audio-move', event)}
                      title="Drag to align audio"
                    >
                      {/* The inner source waveform keeps its original scale and is cropped by the selected segment. */}
                      <div
                        className="pointer-events-none absolute top-0 bottom-0"
                        style={{ left: `${-audioTrimStart * pixelsPerSecond}px`, width: `${audioSourceWidth}px` }}
                      >
                        {renderWaveform('active')}
                      </div>

                      <div className="pointer-events-none absolute left-5 top-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
                        {audioFile.name.length > 16 ? `${audioFile.name.slice(0, 16)}…` : audioFile.name}
                      </div>

                      <div
                        className="absolute bottom-0 left-0 top-0 z-20 flex w-3 cursor-ew-resize items-center justify-center border-r border-emerald-400 bg-emerald-500/30 hover:bg-emerald-500/50"
                        onPointerDown={(event) => startDrag('audio-trim-left', event)}
                        title="Trim left: crop source audio, do not compress"
                      >
                        <GripVertical className="h-3 w-3 text-emerald-800 dark:text-emerald-200" />
                      </div>
                      <div
                        className="absolute bottom-0 right-0 top-0 z-20 flex w-3 cursor-ew-resize items-center justify-center border-l border-emerald-400 bg-emerald-500/30 hover:bg-emerald-500/50"
                        onPointerDown={(event) => startDrag('audio-trim-right', event)}
                        title="Trim right: crop source audio, do not compress"
                      >
                        <GripVertical className="h-3 w-3 text-emerald-800 dark:text-emerald-200" />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                    Upload audio to sync
                  </div>
                )}
              </div>

              <div
                className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-amber-500"
                style={{ left: `${playheadLeft}px` }}
              >
                <div
                  className="pointer-events-auto absolute -left-2 top-0 h-4 w-4 cursor-ew-resize rounded bg-amber-500 shadow-sm"
                  onPointerDown={(event) => startDrag('playhead', event)}
                  title="Drag playhead"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
          <span>
            Audio on video: {formatTime(audioStartTime)} - {formatTime(audioStartTime + effectiveAudioLength)}
          </span>
          <span>
            Source trim: {formatTime(audioTrimStart)} - {formatTime(audioTrimEnd || audioDuration)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 no-scrollbar">
        <div className="space-y-6 pb-4">
          {/* Character Media */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Character Media
            </label>
            <div
              className={`group relative flex w-full flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition-all dark:border-slate-700 dark:bg-slate-800/50 ${
                selectedMedia?.type === 'video' ? 'h-48' : 'h-56'
              }`}
            >
              {renderMediaPreview()}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleMediaUpload}
                className="hidden"
                accept="image/*,video/*"
              />
            </div>

            {selectedMedia?.type === 'video' && (
              <>
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Lip Sync Timeline
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    Video Mode
                  </span>
                </div>
                {renderTimeline()}

                <div className="space-y-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Detected Persons
                  </label>
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {[1, 2, 3].map((id) => (
                      <button
                        key={id}
                        onClick={() => setSelectedPerson(id)}
                        className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                          selectedPerson === id
                            ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                        }`}
                      >
                        <div className="h-5 w-5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <img
                            src={`https://i.pravatar.cc/100?img=${id + 10}`}
                            alt={`Person ${id}`}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        Person {id}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Audio Track */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Voice / Audio
            </label>
            <div
              className={`group relative flex h-24 w-full flex-col items-center justify-center overflow-hidden rounded-xl border-2 transition-all ${
                audioFile
                  ? 'border-solid border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/20'
                  : 'cursor-pointer border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800'
              }`}
              onClick={() => !audioFile && audioInputRef.current?.click()}
            >
              {audioFile ? (
                <>
                  <div className="flex w-full items-center gap-3 px-4">
                    <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900/50">
                      <Volume2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex-1 overflow-hidden text-left">
                      <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {audioFile.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {(audioFile.size / 1024 / 1024).toFixed(2)} MB • {formatTime(audioDuration || effectiveAudioLength || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        audioInputRef.current?.click();
                      }}
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                      title="Replace Audio"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAudio();
                      }}
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-red-500 shadow-sm transition-colors hover:bg-red-50 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-red-900/30"
                      title="Delete Audio"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Mic className="mb-2 h-6 w-6 text-slate-400 transition-colors group-hover:text-emerald-500" />
                  <span className="text-xs font-medium text-slate-500">Upload Audio Track (.mp3, .wav, .m4a)</span>
                </>
              )}
              <input
                type="file"
                ref={audioInputRef}
                onChange={handleAudioUpload}
                className="hidden"
                accept="audio/*"
              />
            </div>
          </div>

          {/* Character Performance Prompt (Only for Image) */}
          {selectedMedia?.type !== 'video' && (
            <div className="space-y-2">
              <label className="flex justify-between text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span>Character Performance</span>
                <span className="text-[10px] font-normal normal-case text-slate-400">Optional</span>
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the character's expression, emotion, gestures, and speaking style."
                className="min-h-[80px] w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          )}
        </div>
      </div>

      {pendingJob && (
        <div className="mx-5 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          A Fal lip sync job is already submitted. Use Resume to check the same job. Do not generate again.
        </div>
      )}

      {/* Bottom Bar */}
      <div className="relative w-full shrink-0 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-4px_24px_rgba(0,0,0,0.05)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 dark:shadow-[0_-4px_24px_rgba(0,0,0,0.2)]">
        <button
          onClick={handleGenerate}
          disabled={isGenerating || (!pendingJob && (!selectedMedia || !audioFile))}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 text-sm font-semibold text-white shadow-md transition-all hover:from-emerald-600 hover:to-teal-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-900"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-white" />
              <span>{pendingJob ? 'Checking...' : 'Syncing...'}</span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 text-white" />
              <span>{pendingJob ? 'Resume' : '36 Generate'}</span>
            </>
          )}
        </button>
      </div>
    </>
  );
};
