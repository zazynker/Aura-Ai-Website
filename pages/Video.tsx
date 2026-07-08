import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { 
  Copy, Edit2, RefreshCw,
  Download, ImagePlus, Trash2, AlertTriangle
} from 'lucide-react';
import { VideoResult } from '../utils/video';
import { FeatureSwitcher, FeatureType } from '../components/video/FeatureSwitcher';
import { ImageToVideo } from '../components/video/ImageToVideo';
import { MotionControl } from '../components/video/MotionControl';
import { LipSync } from '../components/video/LipSync';
import { FreeMode } from '../components/video/FreeMode';
import { useStore } from '../context/StoreContext';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { VideoMode } from '../types';

const parseDurationSeconds = (duration: string): number | undefined => {
  if (!duration) return undefined;
  const parts = duration.split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(duration) || undefined;
};

const getVideoMode = (type: string): VideoMode | undefined => {
  const normalized = type.toLowerCase();
  if (normalized.includes('image')) return 'image_to_video';
  if (normalized.includes('motion')) return 'motion_control';
  if (normalized.includes('lip')) return 'lip_sync';
  return undefined;
};

export const Video: React.FC = () => {
  const location = useLocation();
  const navigationState = location.state as { initialImage?: string } | null;
  const [initialImage] = useState<string | null>(navigationState?.initialImage || null);
  
  const [results, setResults] = useState<VideoResult[]>([]);
  const [activeFeature, setActiveFeature] = useState<FeatureType>('image-to-video');
  const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
  const { addGeneration, user } = useStore();
  const savedVideoIdsRef = useRef<Set<string>>(new Set());

  const saveCompletedVideo = (result: VideoResult) => {
    if (!user || !result.videoUrl || savedVideoIdsRef.current.has(result.id)) return;

    savedVideoIdsRef.current.add(result.id);

    addGeneration({
      userId: user.id,
      templateId: 'video-gen',
      templateName: result.type,
      imageUrl: result.sourceImage || result.videoUrl || 'blob:placeholder',
      mediaType: 'video',
      videoUrl: result.videoUrl,
      videoDuration: parseDurationSeconds(result.duration),
      videoAspectRatio: result.aspectRatio === 'Auto' ? undefined : result.aspectRatio,
      videoMode: getVideoMode(result.type),
      prompt: result.prompt,
      creditsUsed: 36,
    });
  };

  const handleDeleteConfirm = () => {
    if (videoToDelete) {
      setResults(prev => prev.filter(v => v.id !== videoToDelete));
      savedVideoIdsRef.current.delete(videoToDelete);
      setVideoToDelete(null);
    }
  };

  useEffect(() => {
    if (navigationState?.initialImage) {
      window.history.replaceState({}, document.title);
    }
  }, []);

  const handleNewResult = (result: VideoResult) => {
    setResults(prev => {
      const exists = prev.some(v => v.id === result.id);
      if (exists) {
        return prev.map(v => v.id === result.id ? { ...v, ...result } : v);
      }
      return [result, ...prev];
    });

    if (result.videoUrl && result.status !== 'pending') {
      saveCompletedVideo({ ...result, status: result.status || 'completed' });
    }
  };

  const handleUpdateResult = (id: string, updates: Partial<VideoResult>) => {
    const existing = results.find(item => item.id === id);
    const merged = existing ? { ...existing, ...updates } : null;

    setResults(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));

    if (merged?.videoUrl && merged.status === 'completed') {
      saveCompletedVideo(merged);
    }
  };

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
    <div className="flex w-full overflow-hidden bg-white dark:bg-slate-900 mt-16" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="flex w-[480px] shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl relative z-10">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 shrink-0 relative z-50">
          <FeatureSwitcher activeFeature={activeFeature} onChange={setActiveFeature} />
        </div>

        {activeFeature === 'image-to-video' && (
          <ImageToVideo onGenerate={handleNewResult} onUpdate={handleUpdateResult} initialImage={initialImage} />
        )}
        {activeFeature === 'motion-control' && (
          <MotionControl onGenerate={handleNewResult} onUpdate={handleUpdateResult} initialImage={initialImage} />
        )}
        {activeFeature === 'lip-sync' && (
          <LipSync onGenerate={handleNewResult} initialImage={initialImage} />
        )}
        {activeFeature === 'free-mode' && (
          <FreeMode onGenerate={handleNewResult} initialImage={initialImage} />
        )}
      </div>

      <div className="flex flex-1 flex-col relative overflow-hidden bg-slate-50 dark:bg-slate-900">
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
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {gen.model} • {gen.resolution}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 transition-colors">
                      <RefreshCw className={`h-4 w-4 ${gen.status === 'pending' ? 'animate-spin' : ''}`} />
                    </button>
                    <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 transition-colors">
                      <Edit2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="relative p-5">
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed pr-8">
                    "{gen.prompt}"
                  </p>
                  {gen.requestId && (
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                      Fal request: {gen.requestId}
                    </p>
                  )}
                  {gen.error && (
                    <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                      {gen.error}
                    </p>
                  )}
                  <button className="absolute right-5 top-5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
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
                        src={gen.videoUrl} 
                        controls 
                        className="h-full w-full object-contain bg-black"
                        poster={gen.sourceImage}
                      />
                    ) : gen.sourceImage ? (
                      <img src={gen.sourceImage} alt="Source" className="h-full w-full object-cover opacity-70" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-500">
                        <ImagePlus className="h-8 w-8" />
                      </div>
                    )}

                    {gen.status === 'pending' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white backdrop-blur-sm">
                        <RefreshCw className="mb-3 h-8 w-8 animate-spin" />
                        <p className="text-sm font-semibold">Generating video...</p>
                        <p className="mt-1 text-xs text-white/70">Do not click Generate again. Resume this job if status check fails.</p>
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
                    {gen.videoUrl && (
                      <a 
                        href={gen.videoUrl}
                        download={`video-${gen.id}.mp4`}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
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
    </div>
  );
};
