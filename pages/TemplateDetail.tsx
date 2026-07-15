import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Share,
  Play,
  Pause,
  Maximize2,
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  Wand2,
  Film,
  Mic,
  X
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { startWorkflow } from '../components/workflow/workflowManager';
import { useStore } from '../context/StoreContext';

// Mock Data
const MOCK_TEMPLATE = {
  id: 'template-1',
  name: 'Minimal Product Story',
  usageCount: 128,
  author: {
    name: 'Alex Design',
    avatar: 'https://i.pravatar.cc/150?u=alex',
  },
  description: 'Turn a simple product photo into a polished promotional story with consistent scenes and motion.',
  finalResult: {
    type: 'video',
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&q=80',
  },
  steps: [
    {
      id: 'step-1',
      name: 'Main Object Preparation',
      featureUsed: {
        name: 'Replace Product',
        icon: Layers,
      },
      materials: [
        {
          id: 'm1',
          name: 'Original Product',
          type: 'image',
          permission: 'preview',
          url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80',
        },
      ],
      prompt: 'A modern minimalist product shot, clean background, soft studio lighting, high resolution.',
      results: [
        {
          id: 'r1',
          type: 'image',
          url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80',
        }
      ]
    },
    {
      id: 'step-2',
      name: 'Background Generation',
      featureUsed: {
        name: 'Image to Image',
        icon: Wand2,
      },
      materials: [],
      prompt: 'A clean bright room with natural sunlight, minimalist aesthetic, subtle plant shadows on the wall.',
      results: [
        {
          id: 'r2',
          type: 'image',
          url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
        }
      ]
    },
    {
      id: 'step-3',
      name: 'Motion Application',
      featureUsed: {
        name: 'Motion Control',
        icon: Film,
      },
      materials: [],
      prompt: 'Smooth slow pan from left to right, focusing on the product, cinematic depth of field.',
      results: [
        {
          id: 'r3',
          type: 'video',
          url: 'https://www.w3schools.com/html/mov_bbb.mp4',
          thumbnail: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&q=80',
        }
      ]
    },
    {
      id: 'step-4',
      name: 'Voiceover & Lip Sync',
      featureUsed: {
        name: 'Lip Sync',
        icon: Mic,
      },
      materials: [
        {
          id: 'm2',
          name: 'Promotional_Voiceover.mp3',
          type: 'audio',
          permission: 'download',
          url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        }
      ],
      prompt: '',
      results: []
    }
  ]
};

export const TemplateDetail = () => {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const { user, saveBrowsingState } = useStore();
  const [activeStep, setActiveStep] = useState<string>(MOCK_TEMPLATE.steps[0].id);
  const [modalContent, setModalContent] = useState<{ type: string; url: string } | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && !(document as any).webkitIsFullScreen) {
        setModalContent(null);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const toggleAudio = (id: string, url: string) => {
    if (playingAudioId === id) {
      audioRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const newAudio = new Audio(url);
      newAudio.onended = () => setPlayingAudioId(null);
      newAudio.play().catch(console.error);
      audioRef.current = newAudio;
      setPlayingAudioId(id);
    }
  };

  const handleUseTemplate = () => {
    if (!user) {
      saveBrowsingState({ 
        intendedDestination: '/'
      });
      navigate('/login');
      return;
    }
    startWorkflow();
  };

  const handleCopyPrompt = (prompt: string, id: string) => {
    navigator.clipboard.writeText(prompt);
    setCopiedPromptId(id);
    setTimeout(() => setCopiedPromptId(null), 2000);
  };

  const getMaterialIcon = (type: string) => {
    switch (type) {
      case 'image': return <ImageIcon className="w-5 h-5 text-blue-500" />;
      case 'video': return <VideoIcon className="w-5 h-5 text-purple-500" />;
      case 'audio': return <Music className="w-5 h-5 text-amber-500" />;
      default: return <ImageIcon className="w-5 h-5 text-slate-500" />;
    }
  };

  return (
    <div className="min-h-screen pt-20 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Template Details</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Review the workflow and materials</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" className="gap-2">
            <Share className="w-4 h-4" />
            Share
          </Button>
          <Button variant="gradient" onClick={handleUseTemplate}>
            Use this template
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Final Result & Info */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-white/10">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Final Result</h2>
            
            {/* Display Window (3:4 ratio) */}
            <div 
              className="relative aspect-[3/4] bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden group cursor-pointer"
              onClick={(e) => {
                if (MOCK_TEMPLATE.finalResult.type === 'video') {
                  const videoEl = e.currentTarget.querySelector('video');
                  if (videoEl) {
                    // Reset to beginning, unmute (if it was muted for preview)
                    videoEl.currentTime = 0;
                    videoEl.muted = false;
                    videoEl.play();
                    
                    if (videoEl.requestFullscreen) {
                      videoEl.requestFullscreen();
                    } else if ((videoEl as any).webkitRequestFullscreen) {
                      (videoEl as any).webkitRequestFullscreen();
                    } else if ((videoEl as any).msRequestFullscreen) {
                      (videoEl as any).msRequestFullscreen();
                    }
                  }
                } else {
                  setModalContent({ type: MOCK_TEMPLATE.finalResult.type, url: MOCK_TEMPLATE.finalResult.url });
                }
              }}
            >
              {MOCK_TEMPLATE.finalResult.type === 'video' ? (
                <>
                  <video 
                    src={MOCK_TEMPLATE.finalResult.url} 
                    className="w-full h-full object-cover"
                    autoPlay 
                    muted 
                    loop 
                    playsInline
                    onFullscreenChange={(e) => {
                      const videoEl = e.target as HTMLVideoElement;
                      if (!document.fullscreenElement && !(document as any).webkitIsFullScreen) {
                        videoEl.pause();
                        videoEl.muted = true;
                        videoEl.play(); // resume muted preview
                      }
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                    <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-lg group-hover:scale-110 transition-transform">
                      <Play className="w-5 h-5 text-white ml-1" fill="currentColor" />
                    </div>
                  </div>
                </>
              ) : (
                <img 
                  src={MOCK_TEMPLATE.finalResult.url} 
                  alt="Final Result" 
                  className="w-full h-full object-cover"
                />
              )}
              
              {/* Hover overlay for zoom */}
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-md rounded-lg px-3 py-1.5 flex items-center gap-2 border border-white/10">
                <Maximize2 className="w-4 h-4 text-white" />
                <span className="text-xs font-medium text-white">View larger</span>
              </div>
            </div>

            {/* Basic Info */}
            <div className="mt-6 space-y-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{MOCK_TEMPLATE.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Used {MOCK_TEMPLATE.usageCount} times</p>
              </div>

              <div className="flex items-center gap-3 py-3 border-y border-slate-200 dark:border-white/10">
                <img 
                  src={MOCK_TEMPLATE.author.avatar} 
                  alt={MOCK_TEMPLATE.author.name}
                  className="w-10 h-10 rounded-full border border-slate-200 dark:border-white/10"
                />
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Created by</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{MOCK_TEMPLATE.author.name}</p>
                </div>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                {MOCK_TEMPLATE.description}
              </p>
            </div>
          </div>
        </div>

        {/* Middle Column: Workflow Steps */}
        <div className="lg:col-span-8">
          <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-white/10">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">How this template was made</h2>
            
            <div className="space-y-4">
              {MOCK_TEMPLATE.steps.map((step, index) => {
                const isExpanded = activeStep === step.id;
                const FeatureIcon = step.featureUsed.icon;

                return (
                  <div 
                    key={step.id}
                    className={`border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden transition-all duration-300 ${isExpanded ? 'bg-white dark:bg-slate-800/50 shadow-sm' : 'bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  >
                    {/* Step Header (Clickable) */}
                    <div 
                      className="p-4 flex items-center justify-between cursor-pointer select-none"
                      onClick={() => setActiveStep(isExpanded ? '' : step.id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-semibold text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <h3 className="font-medium text-slate-900 dark:text-white">{step.name}</h3>
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 dark:text-slate-400">
                            <FeatureIcon className="w-3.5 h-3.5" />
                            <span>{step.featureUsed.name}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-slate-400">
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </div>
                    </div>

                    {/* Step Content (Expanded) */}
                    {isExpanded && (
                      <div className="p-4 pt-0 border-t border-slate-100 dark:border-white/5 mt-2 space-y-6">
                        
                        {/* Feature Used (Prominent) */}
                        <div className="pt-4">
                          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Feature I Used</h4>
                          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-lg text-sm font-medium border border-purple-100 dark:border-purple-800/30">
                            <FeatureIcon className="w-4 h-4" />
                            {step.featureUsed.name}
                          </div>
                        </div>

                        {/* Materials Uploaded */}
                        {step.materials.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Materials I Uploaded</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {step.materials.map(material => (
                                <div key={material.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/5">
                                  <div className="flex items-center gap-3 overflow-hidden">
                                    <div 
                                      className="w-10 h-10 rounded-md bg-slate-200 dark:bg-slate-800 flex-shrink-0 flex items-center justify-center overflow-hidden cursor-pointer border border-slate-300 dark:border-slate-700"
                                      onClick={() => {
                                        if (material.type !== 'audio' && material.url !== '#') {
                                          setModalContent({ type: material.type, url: material.url });
                                        }
                                      }}
                                    >
                                      {material.type === 'image' && material.url !== '#' ? (
                                        <img src={material.url} alt={material.name} className="w-full h-full object-cover" />
                                      ) : (
                                        getMaterialIcon(material.type)
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{material.name}</p>
                                      <p className="text-xs text-slate-500 capitalize">{material.type}</p>
                                    </div>
                                  </div>
                                  <div className="flex-shrink-0 ml-3">
                                    {material.permission === 'preview' ? (
                                      <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-md">
                                        Preview only
                                      </span>
                                    ) : material.type === 'audio' ? (
                                      <Button 
                                        variant="secondary" 
                                        size="sm" 
                                        className="h-8 gap-1.5 px-3"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleAudio(material.id, material.url);
                                        }}
                                      >
                                        {playingAudioId === material.id ? (
                                          <Pause className="w-3.5 h-3.5" />
                                        ) : (
                                          <Play className="w-3.5 h-3.5" />
                                        )}
                                        <span className="text-xs">
                                          {playingAudioId === material.id ? 'Pause' : 'Play'}
                                        </span>
                                      </Button>
                                    ) : (
                                      <Button variant="secondary" size="sm" className="h-8 gap-1.5 px-3">
                                        <Download className="w-3.5 h-3.5" />
                                        <span className="text-xs">Download</span>
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Prompt & Settings */}
                        {step.prompt && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Prompt & Settings I Set</h4>
                              <button 
                                onClick={() => handleCopyPrompt(step.prompt, step.id)}
                                className="flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                              >
                                {copiedPromptId === step.id ? (
                                  <><Check className="w-3.5 h-3.5" /> Copied</>
                                ) : (
                                  <><Copy className="w-3.5 h-3.5" /> Copy Prompt</>
                                )}
                              </button>
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-white/5 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono">
                              {step.prompt}
                            </div>
                          </div>
                        )}

                        {/* Results from This Step */}
                        {step.results.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Results from This Step</h4>
                            <div className="flex flex-wrap gap-3">
                              {step.results.map(result => (
                                <div 
                                  key={result.id}
                                  className="relative w-24 h-24 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 cursor-pointer group"
                                  onClick={() => setModalContent({ type: result.type, url: result.url })}
                                >
                                  {result.type === 'video' ? (
                                    <>
                                      <img src={result.thumbnail || result.url} alt="Result" className="w-full h-full object-cover" />
                                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                        <Play className="w-6 h-6 text-white ml-0.5" fill="currentColor" />
                                      </div>
                                    </>
                                  ) : (
                                    <img src={result.url} alt="Result" className="w-full h-full object-cover" />
                                  )}
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                    <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Full-screen media viewer overlay */}
      {modalContent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200">
          <button 
            onClick={() => setModalContent(null)}
            className="absolute top-4 right-4 md:top-6 md:right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white z-10"
            aria-label="Close fullscreen view"
          >
            <X className="w-8 h-8" />
          </button>
          
          <div className="w-full h-full flex items-center justify-center p-4">
            {modalContent.type === 'video' ? (
              <video 
                src={modalContent.url} 
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                controls 
                autoPlay
                ref={(el) => {
                  if (el && !document.fullscreenElement) {
                    el.play().catch(console.error);
                    if (el.requestFullscreen) {
                      el.requestFullscreen().catch(console.error);
                    } else if ((el as any).webkitRequestFullscreen) {
                      (el as any).webkitRequestFullscreen();
                    } else if ((el as any).msRequestFullscreen) {
                      (el as any).msRequestFullscreen();
                    }
                  }
                }}
              />
            ) : modalContent.type === 'image' ? (
              <img 
                src={modalContent.url} 
                alt="Enlarged view" 
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

