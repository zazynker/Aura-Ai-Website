import React, { useState, useRef } from 'react';
import {
  Settings,
  ChevronDown,
  ImagePlus,
  RefreshCw,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { VideoResult, generateFakeVideo } from '../../utils/video';

interface MotionControlProps {
  onGenerate: (result: VideoResult) => void;
  initialImage: string | null;
}

type DirectionMatch = 'video' | 'image';
type Resolution = '720p' | '1080p';

export const MotionControl: React.FC<MotionControlProps> = ({ onGenerate, initialImage }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(initialImage);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [directionMatch, setDirectionMatch] = useState<DirectionMatch>('video');
  const [motionPrompt, setMotionPrompt] = useState<string>('');

  // Settings state. The reference panel only exposes Mode + Number of Outputs.
  const [resolution, setResolution] = useState<Resolution>('720p');
  const [quantity, setQuantity] = useState<number>(1);
  const duration = 5;

  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
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

    setIsGenerating(true);

    try {
      const videoUrl = await generateFakeVideo(selectedImage, duration);

      const newResult: VideoResult = {
        id: `gen-${Date.now()}`,
        type: 'Motion Control',
        model: directionMatch === 'video' ? 'Motion Control · Video Orientation' : 'Motion Control · Image Orientation',
        resolution,
        prompt: motionPrompt,
        duration: `00:${duration.toString().padStart(2, '0')}`,
        aspectRatio: '16:9',
        timestamp: 'Just now',
        bgColor: 'bg-indigo-900/50',
        videoUrl,
        sourceImage: selectedImage,
      };

      onGenerate(newResult);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(URL.createObjectURL(file));
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedVideo(URL.createObjectURL(file));
    }
  };

  const isGenerateDisabled = isGenerating || !selectedImage || !selectedVideo || !motionPrompt.trim();

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
        {/* Source Media */}
        <div className="space-y-4">
          <div className="flex gap-4">
            {/* Motion Reference Video */}
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

            {/* Character Image */}
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

        {/* Motion Prompt */}
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
      </div>

      {/* Bottom Bar */}
      <div className="relative z-50 w-full shrink-0 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-4px_24px_rgba(0,0,0,0.05)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 dark:shadow-[0_-4px_24px_rgba(0,0,0,0.2)]">
        {/* Parameter Panel */}
        {isParamsOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-4 w-[calc(100%-32px)] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="space-y-5">
              {/* Mode */}
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

              {/* Number of Outputs */}
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
                <span>Applying Motion...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-white" />
                <span>36 Generate</span>
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
};
