import React, { useEffect, useRef, useState } from 'react';
import {
  Settings,
  ChevronDown,
  RefreshCw,
  Plus,
  X,
  Sparkles
} from 'lucide-react';
import { VideoResult, generateFakeVideo } from '../../utils/video';
import { FreeModePromptEditor } from './FreeModePromptEditor';

interface FreeModeProps {
  onGenerate: (result: VideoResult) => void;
  initialImage?: string | null;
}

interface Asset {
  id: string;
  url: string;
  type: 'video' | 'image';
  file: File;
  name: string;
}

type FreeModeResolution = '720p' | '1080p' | '4k';
type FreeModeRatio = 'auto' | '9:16' | '1:1' | '16:9';

export const FreeMode: React.FC<FreeModeProps> = ({ onGenerate, initialImage }) => {
  const [prompt, setPrompt] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);

  const [resolution, setResolution] = useState<FreeModeResolution>('720p');
  const [duration, setDuration] = useState<number>(5);
  const [ratio, setRatio] = useState<FreeModeRatio>('16:9');
  const [outputCount, setOutputCount] = useState<number>(1);

  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const paramsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isParamsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (paramsPanelRef.current?.contains(target)) return;
      if (paramsButtonRef.current?.contains(target)) return;
      setIsParamsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsParamsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isParamsOpen]);

  const handleGenerate = async () => {
    if (!prompt) {
      alert('Please enter a generation prompt.');
      return;
    }

    setIsGenerating(true);

    try {
      const sourceUrl = assets.length > 0
        ? assets[0].url
        : (initialImage || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&q=80');
      const videoUrl = await generateFakeVideo(sourceUrl, duration);

      const newResult: VideoResult = {
        id: `gen-${Date.now()}`,
        type: 'Free Mode',
        model: 'Custom Pipeline',
        resolution,
        prompt,
        duration: `00:${duration.toString().padStart(2, '0')}`,
        aspectRatio: ratio === 'auto' ? 'Auto' : ratio,
        timestamp: 'Just now',
        bgColor: 'bg-amber-900/50',
        videoUrl,
        sourceImage: sourceUrl
      };

      for (let i = 0; i < outputCount; i += 1) {
        onGenerate({
          ...newResult,
          id: outputCount === 1 ? newResult.id : `${newResult.id}-${i + 1}`
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newAssets = files.map((file, i) => ({
      id: Math.random().toString(36).substr(2, 9),
      url: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
      file,
      name: file.type.startsWith('video/') ? `Video ${assets.length + i + 1}` : `Image ${assets.length + i + 1}`
    }));

    setAssets([...assets, ...newAssets]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAsset = (id: string) => {
    setAssets(assets.filter(a => a.id !== id));
  };

  const settingSummary = `${resolution} · ${duration}s · ${ratio === 'auto' ? 'Auto' : ratio} · ${outputCount}`;

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar flex flex-col">
        {/* Editor Area */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex-1 min-h-[250px] relative rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 flex flex-col focus-within:ring-1 focus-within:ring-amber-500 transition-shadow">
            <FreeModePromptEditor
              prompt={prompt}
              onChange={setPrompt}
              assets={assets}
            />

            {/* Assets Strip */}
            <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 p-3 flex gap-3 overflow-x-auto no-scrollbar items-center rounded-b-xl z-10 relative">
              {assets.map((asset, index) => (
                <div key={asset.id} className="relative group shrink-0 h-16 w-16 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800">
                  {asset.type === 'video' ? (
                    <video src={asset.url} className="h-full w-full object-cover" />
                  ) : (
                    <img src={asset.url} alt={`Asset ${index + 1}`} className="h-full w-full object-cover" />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button onClick={() => removeAsset(asset.id)} className="p-1 rounded-full bg-black/60 text-white hover:bg-black">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="absolute top-1 left-1 bg-black/60 rounded px-1 text-[8px] font-bold text-white uppercase">
                    {asset.type}
                  </div>
                </div>
              ))}

              <button
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 h-16 w-16 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-amber-500 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span className="text-[9px] font-medium uppercase">Add</span>
              </button>
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed px-1">
            Free mode supports complex compositing. Upload images or videos, then reference them in your prompt using the <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-amber-600 dark:text-amber-400">@</code> symbol.
          </p>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="relative z-50 w-full shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-4 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.2)]">
        {/* Parameter Panel */}
        {isParamsOpen && (
          <div
            ref={paramsPanelRef}
            className="absolute bottom-[calc(100%+8px)] left-4 z-50 w-[calc(100%-32px)] rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="mb-4 flex flex-col gap-5">
              {/* Mode */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Resolution
                </label>
                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/50">
                  {(['720p', '1080p', '4k'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setResolution(item)}
                      className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        resolution === item
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {item === '4k' ? '4K' : item}
                      {item !== '720p' && (
                        <span className="absolute -right-1.5 -top-1.5 rounded bg-gradient-to-r from-pink-400 to-purple-500 px-1 text-[8px] font-bold text-white shadow-sm">
                          PRO
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
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
                    onChange={(event) => setDuration(Number(event.target.value))}
                    aria-label="Video length"
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 dark:bg-slate-700 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
                  />
                  <span className="text-xs font-medium text-slate-400">15s</span>
                </div>
              </div>

              {/* Ratio */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Ratio
                </label>
                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/50">
                  {([
                    { value: 'auto', label: 'Auto', icon: '▣' },
                    { value: '9:16', label: '9:16', icon: '▯' },
                    { value: '1:1', label: '1:1', icon: '□' },
                    { value: '16:9', label: '16:9', icon: '▭' }
                  ] as const).map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setRatio(item.value)}
                      className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-md py-2 text-xs font-medium transition-all ${
                        ratio === item.value
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      <span className="text-base leading-none opacity-80">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Output */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Generation Count
                </label>
                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/50">
                  {[1, 2, 3, 4].map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setOutputCount(item)}
                      className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        outputCount === item
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {item}
                      {item > 1 && (
                        <span className="absolute -right-1.5 -top-1.5 rounded bg-gradient-to-r from-pink-400 to-purple-500 px-1 text-[8px] font-bold text-white shadow-sm">
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
            ref={paramsButtonRef}
            onClick={() => setIsParamsOpen(prev => !prev)}
            className="flex h-11 min-w-[92px] items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Settings className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="max-w-[108px] truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                {settingSummary}
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isParamsOpen ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 text-sm font-semibold text-white shadow-md hover:from-amber-600 hover:to-orange-600 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-white" />
                <span>Processing...</span>
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
