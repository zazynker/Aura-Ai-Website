import React, { useState } from 'react';
import { ChevronDown, ImageIcon, Move, Mic, Wand2, Check, Plus, ArrowUp, Trash2, Film } from 'lucide-react';
import {
  FakeVideoItem,
  getFakeVideoIndex,
  getFakeVideoQueue,
  resetFakeVideoQueue,
  saveFakeVideoIndex,
  saveFakeVideoQueue,
} from '../../utils/fakeVideoQueue';

export type FeatureType = 'image-to-video' | 'motion-control' | 'lip-sync' | 'free-mode';

interface FeatureSwitcherProps {
  activeFeature: FeatureType;
  onChange: (feature: FeatureType) => void;
  /** Admin only: unlocks the hidden fake-video demo queue on the "Creation Mode" label. */
  isAdmin?: boolean;
}

const features = [
  { 
    id: 'image-to-video' as FeatureType, 
    name: 'Image to Video', 
    description: 'Convert images to high-quality video', 
    icon: ImageIcon,
    color: 'from-purple-500 to-pink-500'
  },
  { 
    id: 'motion-control' as FeatureType, 
    name: 'Motion Control', 
    description: 'Control camera and subject movement', 
    icon: Move,
    color: 'from-blue-500 to-indigo-500'
  },
  { 
    id: 'lip-sync' as FeatureType, 
    name: 'Lip Sync', 
    description: 'Animate faces to match audio', 
    icon: Mic,
    color: 'from-emerald-500 to-teal-500'
  },
  /* { id: 'free-mode' as FeatureType, name: 'Free Mode', description: 'Full control over generation timeline', icon: Wand2, color: 'from-amber-500 to-orange-500' } */
];

export const FeatureSwitcher: React.FC<FeatureSwitcherProps> = ({ activeFeature, onChange, isAdmin }) => {
  const [isOpen, setIsOpen] = useState(false);
  const active = features.find(f => f.id === activeFeature) || features[0];

  // === Admin Fake Video Queue (demo only) ===
  const [showFakeQueue, setShowFakeQueue] = useState(false);
  const [fakeQueue, setFakeQueue] = useState<FakeVideoItem[]>(() => getFakeVideoQueue());
  const [fakeQueueIndex, setFakeQueueIndex] = useState<number>(() => getFakeVideoIndex());

  const updateQueue = (next: FakeVideoItem[]) => {
    setFakeQueue(next);
    saveFakeVideoQueue(next);
  };

  const handleAddVideos = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: FakeVideoItem[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      url: URL.createObjectURL(file),
      name: file.name,
    }));
    updateQueue([...fakeQueue, ...added]);
  };

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= fakeQueue.length) return;
    const arr = [...fakeQueue];
    [arr[from], arr[to]] = [arr[to], arr[from]];
    updateQueue(arr);
  };

  const removeItem = (id: string) => {
    const next = fakeQueue.filter((item) => item.id !== id);
    updateQueue(next);
    if (fakeQueueIndex > next.length) {
      setFakeQueueIndex(next.length);
      saveFakeVideoIndex(next.length);
    }
  };

  const handleReset = () => {
    resetFakeVideoQueue();
    setFakeQueueIndex(0);
  };

  const isExhausted = fakeQueue.length > 0 && fakeQueueIndex >= fakeQueue.length;

  return (
    <div className="relative">
      <label
        className="mb-2 block text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase"
        onClick={isAdmin ? () => {
          setShowFakeQueue((prev) => {
            const next = !prev;
            if (next) {
              // re-read in case another tab/page changed it
              setFakeQueue(getFakeVideoQueue());
              setFakeQueueIndex(getFakeVideoIndex());
            }
            return next;
          });
        } : undefined}
        style={isAdmin ? { cursor: 'default', userSelect: 'none' } : undefined}
      >
        Creation Mode
      </label>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${active.color} text-white shadow-sm`}>
            <active.icon className="h-5 w-5" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{active.name}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{active.description}</div>
          </div>
        </div>
        <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Admin Fake Video Queue Panel (demo only, never calls the real API) */}
      {showFakeQueue && isAdmin && (
        <div className="mt-3 rounded-xl border border-dashed border-purple-300 dark:border-purple-500/30 bg-purple-50/40 dark:bg-purple-500/5 p-3 space-y-3">
          <label className="relative flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-white/10 hover:border-purple-500/50 hover:bg-white/60 dark:hover:bg-purple-500/10 cursor-pointer transition-all text-xs font-medium text-slate-600 dark:text-slate-300">
            <Plus className="w-3.5 h-3.5" /> Add Video
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              multiple
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => {
                handleAddVideos(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          {fakeQueue.length > 0 ? (
            <div className="space-y-2">
              {fakeQueue.map((item, idx) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                    idx < fakeQueueIndex
                      ? 'border-slate-200 dark:border-white/5 opacity-40'
                      : idx === fakeQueueIndex
                        ? 'border-purple-500/50 bg-white/70 dark:bg-purple-500/10'
                        : 'border-slate-200 dark:border-white/10'
                  }`}
                >
                  <span className={`text-[10px] font-bold w-5 text-center shrink-0 ${
                    idx === fakeQueueIndex ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400'
                  }`}>#{idx + 1}</span>

                  <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 shrink-0 bg-black flex items-center justify-center">
                    <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  </div>

                  <span className="text-[10px] text-slate-500 dark:text-slate-400 flex-1 truncate" title={item.name}>
                    {item.name}
                  </span>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveItem(idx, idx - 1)}
                      disabled={idx === 0}
                      className="p-1 hover:bg-white dark:hover:bg-white/5 rounded disabled:opacity-20 transition-colors"
                    >
                      <ArrowUp className="w-3 h-3 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(idx, idx + 1)}
                      disabled={idx === fakeQueue.length - 1}
                      className="p-1 hover:bg-white dark:hover:bg-white/5 rounded disabled:opacity-20 transition-colors rotate-180"
                    >
                      <ArrowUp className="w-3 h-3 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="p-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center">
              <Film className="mx-auto mb-2 h-6 w-6 text-slate-300 dark:text-white/20" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">No items in queue</p>
              <p className="text-[10px] text-slate-400">Upload videos above</p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 dark:border-white/5 pt-2">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              Queue: {fakeQueue.length} items
            </span>
            {isExhausted && (
              <span className="text-[10px] font-medium text-red-500">Exhausted — Real API</span>
            )}
          </div>
          {fakeQueue.length > 0 && (
            <button
              type="button"
              onClick={handleReset}
              className="w-full py-1.5 text-[10px] font-medium text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/5 rounded-lg transition-colors"
            >
              Reset Queue
            </button>
          )}
        </div>
      )}

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 shadow-xl animate-in fade-in slide-in-from-top-2">
            {features.map((feature) => (
              <button
                key={feature.id}
                onClick={() => {
                  onChange(feature.id);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg p-3 transition-colors ${
                  activeFeature === feature.id 
                    ? 'bg-slate-50 dark:bg-slate-700/50' 
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${feature.color} text-white shadow-sm opacity-90`}>
                    <feature.icon className="h-4 w-4" />
                  </div>
                  <div className="text-left">
                    <div className={`text-sm font-medium ${activeFeature === feature.id ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>
                      {feature.name}
                    </div>
                  </div>
                </div>
                {activeFeature === feature.id && (
                  <Check className="h-4 w-4 text-purple-500" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
