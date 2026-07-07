import React, { useState } from 'react';
import { ChevronDown, ImageIcon, Move, Mic, Wand2, Check } from 'lucide-react';

export type FeatureType = 'image-to-video' | 'motion-control' | 'lip-sync' | 'free-mode';

interface FeatureSwitcherProps {
  activeFeature: FeatureType;
  onChange: (feature: FeatureType) => void;
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

export const FeatureSwitcher: React.FC<FeatureSwitcherProps> = ({ activeFeature, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const active = features.find(f => f.id === activeFeature) || features[0];

  return (
    <div className="relative">
      <label className="mb-2 block text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
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
