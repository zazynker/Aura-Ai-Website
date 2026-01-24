import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, Loader2, Sparkles, Layers, Maximize2, Trash2, Edit2, X, Lock, Wand2, Type } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { mockTemplates } from '../data/mockData';
import { Button } from '../components/ui/Button';
import { Generation } from '../types';

export const TemplateDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, addGenerations, addToast, generations } = useStore();
  const template = mockTemplates.find(t => t.id === id);
  
  // State
  const [currentImage, setCurrentImage] = useState<string>('');
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  
  // Generation Configuration
  const [outputCount, setOutputCount] = useState(2);
  const [quality, setQuality] = useState<'Standard' | 'High' | 'Ultra'>('Standard');
  
  // Generation Process State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generatedResults, setGeneratedResults] = useState<string[]>([]); // For the bottom tray
  const [showResults, setShowResults] = useState(false);
  const [generationContext, setGenerationContext] = useState<string>(''); 

  // UI State
  const [showLightbox, setShowLightbox] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  // Inputs
  const [prompt, setPrompt] = useState('');
  const [textPrompt, setTextPrompt] = useState('');
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [selectedRatio, setSelectedRatio] = useState('Square');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // --- 1. History Logic (Derived State) ---
  // Calculates history on every render based on Global Store + Current Template
  const history = useMemo(() => {
    if (!template) return [];
    
    const originalItem: Generation = {
        id: 'original',
        templateId: template.id,
        templateName: template.name,
        imageUrl: template.imageUrl,
        createdAt: 0,
        creditsUsed: 0,
        prompt: 'Original Template',
        isOriginal: true
    };
    
    // Get generations for THIS template from global store
    // Sort by newest first (created later = higher timestamp)
    const templateGens = generations
        .filter(g => g.templateId === template.id)
        .sort((a, b) => b.createdAt - a.createdAt);
    
    // Combined history: Generated Images (Newest First) -> Original Image (Last)
    return [...templateGens, originalItem];
  }, [template, generations]);

  // --- 2. Initialization ---
  useEffect(() => {
    if (!template) {
      addToast('error', 'Template not found');
      navigate('/');
      return;
    }

    // Pro Check
    const isProUser = user?.plan === 'Pro' || user?.plan === 'Enterprise';
    if (template.isPro && !isProUser) {
        setIsLocked(true);
    }

    // Set Initial Image to Original if not set
    if (!currentImage) {
        setCurrentImage(template.imageUrl);
        // Initialize dimensions with template defaults to avoid 0x0 jump if possible
        setImageDimensions({ width: template.width, height: template.height });
    }
    
  }, [template, user, navigate, addToast, currentImage]);

  const handleBack = () => {
    navigate(-1);
  };

  // --- 3. Unified Generation Engine ---
  const runGeneration = (toolName: string, promptText: string) => {
    if (isLocked) return;
    if (!user) { navigate('/login'); return; }
    if (user.credits < outputCount) { addToast('error', 'Not enough credits'); navigate('/pricing'); return; }

    if (toolName === 'Replace' && !uploadedFile && !promptText) {
       if (!promptText && !uploadedFile) {
          addToast('error', 'Please upload a product or enter a prompt');
          return;
       }
    }

    if (toolName === 'Add Text' && !promptText.trim()) {
        addToast('error', 'Please enter text to add');
        return;
    }

    if (toolName === 'Modify' && !promptText.trim()) {
        addToast('error', 'Please describe the changes');
        return;
    }

    setIsGenerating(true);
    setShowResults(false);
    setProgress(0);
    setGenerationContext(promptText || toolName);

    // Simulation Timer
    const duration = 2000; 
    const intervalTime = 50;
    const steps = duration / intervalTime;
    let currentStep = 0;

    const timer = setInterval(() => {
        currentStep++;
        const newProgress = Math.min((currentStep / steps) * 100, 99);
        setProgress(newProgress);

        if (currentStep >= steps) {
            clearInterval(timer);
            finalizeGeneration(toolName, promptText);
        }
    }, intervalTime);
  };

  const finalizeGeneration = (toolName: string, promptText: string) => {
      setProgress(100);
      
      // Create Mock Images
      const newImages = Array.from({ length: outputCount }).map((_, i) => 
        `https://picsum.photos/1024/1024?random=${Date.now() + i}`
      );

      // Create Generation Objects
      const newGenerations: Generation[] = newImages.map(imgUrl => ({
          id: `gen_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          templateId: template!.id,
          templateName: template!.name,
          imageUrl: imgUrl,
          createdAt: Date.now(),
          creditsUsed: 1,
          prompt: promptText || toolName || 'AI Generation',
          isOriginal: false
      }));

      // --- CRITICAL: Batch Update to Store ---
      // This ensures all images appear in History immediately
      addGenerations(newGenerations);

      setTimeout(() => {
          setIsGenerating(false);
          setGeneratedResults(newImages); // Update bottom tray
          setCurrentImage(newImages[0]); // Switch main view to the first new image
          setShowResults(true); // Show the tray
          setProgress(0);
          addToast('success', `Generated ${outputCount} images!`);
      }, 300);
  };

  const handleSelectResult = (imgUrl: string) => {
    setCurrentImage(imgUrl);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0]);
    }
  };

  const handleDownload = () => {
    if (!user) {
        addToast('error', 'Please log in to download images');
        navigate('/login');
        return;
    }
    // Simulation of download
    addToast('success', 'Image Downloaded!');
  };

  // --- UI Components ---
  const ImageCountSelector = () => (
      <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-400 font-medium ml-1 flex items-center gap-2">
                <Layers className="w-3 h-3" /> Variations
            </label>
            <span className="text-[10px] text-slate-500">{outputCount} images</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map(num => (
                  <button
                      key={num}
                      onClick={() => setOutputCount(num)}
                      className={`py-2 text-xs font-medium rounded-lg border transition-all ${
                          outputCount === num
                              ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-900/20'
                              : 'bg-slate-800 border-white/5 text-slate-400 hover:bg-slate-700 hover:text-white'
                      }`}
                  >
                      {num}
                  </button>
              ))}
          </div>
      </div>
  );

  const QualitySelector = () => (
      <div className="space-y-2 mb-4">
         <label className="text-xs text-slate-400 font-medium ml-1 flex items-center gap-2">
            <Sparkles className="w-3 h-3" /> Quality
         </label>
         <div className="flex bg-slate-950 p-1 rounded-lg border border-white/5">
            {['Standard', 'High', 'Ultra'].map(q => (
                <button
                    key={q}
                    onClick={() => setQuality(q as any)}
                    className={`flex-1 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                        quality === q 
                        ? 'bg-slate-800 text-white shadow-sm border border-white/10' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                >
                    {q}
                </button>
            ))}
         </div>
      </div>
  );

  const ratioOptions = [
    { label: '1:1', name: 'Square', aspect: 'aspect-square' },
    { label: '3:4', name: 'Portrait', aspect: 'aspect-[3/4]' },
    { label: '9:16', name: 'Story', aspect: 'aspect-[9/16]' },
    { label: '16:9', name: 'Landscape', aspect: 'aspect-[16/9]' },
    { label: '2:3', name: 'Pinterest', aspect: 'aspect-[2/3]' },
    { label: '4:5', name: 'Poster', aspect: 'aspect-[4/5]' },
    { label: '3:2', name: 'Photo', aspect: 'aspect-[3/2]' },
  ];

  if (!template) return null;

  return (
    <div className="min-h-screen pt-20 px-4 md:px-6 h-screen flex flex-col overflow-hidden relative bg-slate-900">
      
      {/* Fixed Back Button */}
      <div className="fixed top-[20px] left-[20px] z-50">
        <button 
          onClick={handleBack}
          className="w-10 h-10 rounded-full glass-panel border border-white/20 flex items-center justify-center hover:bg-white/10 group transition-all shadow-lg backdrop-blur-md"
        >
          <ArrowLeft className="w-5 h-5 text-slate-300 group-hover:text-white" />
        </button>
      </div>

      {/* Pro Lock Overlay */}
      {isLocked && (
          <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-md flex items-center justify-center">
              <div className="glass-panel p-8 rounded-2xl max-w-md text-center border border-purple-500/30 shadow-2xl shadow-purple-900/40 animate-in zoom-in-95 duration-300">
                  <div className="w-16 h-16 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center mb-6">
                      <Lock className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">Pro Template Locked</h2>
                  <p className="text-slate-400 mb-8">This premium template is available exclusively for Pro members. Upgrade to access full editing features.</p>
                  <div className="flex gap-4">
                      <Button variant="secondary" onClick={handleBack} className="flex-1">Go Back</Button>
                      <Button variant="gradient" onClick={() => navigate('/pricing')} className="flex-1">Upgrade Now</Button>
                  </div>
              </div>
          </div>
      )}

      <div className="flex-1 flex gap-6 h-full pb-6">
        
        {/* LEFT COLUMN: History */}
        <div className="hidden lg:flex flex-col w-64 glass-panel rounded-2xl p-4 border-white/5 h-full overflow-hidden mt-8 md:mt-0 bg-slate-900/50">
          <h3 className="text-xs font-bold text-slate-400 mb-4 uppercase tracking-wider pl-1 mt-2 flex items-center gap-2">
            <Layers className="w-4 h-4" /> History
          </h3>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
            {history.map((gen, idx) => (
                <div 
                    key={gen.id} 
                    onClick={() => setCurrentImage(gen.imageUrl)}
                    className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all shrink-0 ${currentImage === gen.imageUrl ? 'border-purple-500 ring-2 ring-purple-500/20 shadow-lg shadow-purple-900/20' : 'border-transparent hover:border-white/20'}`}
                >
                    <img src={gen.imageUrl} className="w-full h-full object-cover" loading="lazy" alt="history" />
                    {gen.isOriginal && (
                        <div className="absolute top-1 left-1 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] text-white font-medium border border-white/10">Original</div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[10px] text-white truncate">{gen.prompt}</p>
                    </div>
                </div>
            ))}
          </div>
        </div>

        {/* MIDDLE COLUMN: Preview & Results */}
        <div className="flex-1 relative flex flex-col min-w-0">
            <div className="flex-1 relative rounded-2xl overflow-hidden bg-slate-950 border border-white/5 flex items-center justify-center group shadow-2xl">
                 
                 {/* Generation Progress Overlay */}
                 {isGenerating && (
                   <div className="absolute inset-0 z-30 bg-slate-900/70 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
                      <div className="w-64 space-y-4">
                        <div className="flex justify-between text-xs text-white font-medium uppercase tracking-wider">
                           <span className="flex items-center gap-2"><Sparkles className="w-3 h-3 animate-pulse text-purple-400"/> Generating</span>
                           <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                            <div 
                               className="h-full bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 transition-all duration-75 ease-linear"
                               style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="text-center text-xs text-slate-400 animate-pulse">Creating {outputCount} variations...</p>
                      </div>
                   </div>
                 )}

                 <img 
                    src={currentImage} 
                    className="max-h-full max-w-full object-contain transition-all duration-500"
                    alt="Main preview"
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                    }}
                 />
                 
                 <div className="absolute top-4 left-4">
                     <div className="glass-panel px-3 py-1.5 rounded-lg flex items-center gap-2 bg-black/40 backdrop-blur-md border border-white/10">
                         <span className="font-semibold text-white text-sm">{template.name}</span>
                         {template.isPro && <span className="text-[10px] bg-gradient-to-r from-yellow-500 to-orange-500 text-black font-bold px-1.5 rounded">PRO</span>}
                     </div>
                 </div>
                 
                 {imageDimensions.width > 0 && (
                   <div className="absolute bottom-4 right-4 z-10">
                       <span className="text-xs text-slate-400 font-mono bg-black/60 backdrop-blur-md px-2 py-1 rounded border border-white/10">
                         {imageDimensions.width} x {imageDimensions.height}
                       </span>
                   </div>
                 )}

                 <button 
                    onClick={() => setShowLightbox(true)}
                    className="absolute top-4 right-4 w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-white hover:bg-white hover:text-black transition-all hover:scale-105 z-20"
                 >
                     <Maximize2 className="w-5 h-5" />
                 </button>
            </div>

            {/* Results Slide-up Panel */}
            <div className={`absolute bottom-0 left-4 right-4 glass-panel border border-white/10 p-6 rounded-t-2xl transition-transform duration-500 ease-out z-40 shadow-2xl bg-slate-900/40 backdrop-blur-2xl ${showResults ? 'translate-y-0' : 'translate-y-[120%]'}`}>
                <div className="flex items-center justify-between mb-4">
                     <h3 className="text-lg font-bold text-white flex items-center gap-2">
                       <Sparkles className="w-5 h-5 text-purple-400" /> 
                       Generated Results 
                       <span className="text-sm font-normal text-slate-500 ml-2">Already saved to history</span>
                     </h3>
                     <button onClick={() => setShowResults(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400 hover:text-white" /></button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {generatedResults.map((img, idx) => (
                        <div key={idx} className="space-y-2 group">
                            <div className={`aspect-square rounded-xl overflow-hidden border relative cursor-pointer ${currentImage === img ? 'border-purple-500 ring-2 ring-purple-500/20' : 'border-white/10'}`} onClick={() => handleSelectResult(img)}>
                                <img src={img} className="w-full h-full object-cover transition-transform group-hover:scale-105" alt={`Result ${idx}`} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* RIGHT COLUMN: Tools */}
        <div className="w-full md:w-80 lg:w-96 flex flex-col gap-4 overflow-y-auto pb-20 px-3 pt-2 custom-scrollbar">
            
            {/* 1. REPLACE PRODUCT Tool */}
            <div className={`glass-panel rounded-2xl p-1 transition-all duration-300 bg-slate-900/50 ${activeTool === 'replace' ? 'ring-1 ring-purple-500/50 bg-slate-800/50' : ''}`}>
                <button 
                    disabled={isLocked}
                    onClick={() => setActiveTool(activeTool === 'replace' ? null : 'replace')}
                    className="w-full p-4 flex items-center justify-between text-left disabled:opacity-50"
                >
                    <span className="font-semibold text-white flex items-center gap-3"><Upload className="w-5 h-5 text-purple-400" /> Replace Product</span>
                    {activeTool === 'replace' ? <X className="w-4 h-4 text-slate-400"/> : <ArrowLeft className="w-4 h-4 -rotate-90 text-slate-400"/>}
                </button>
                
                {activeTool === 'replace' && (
                    <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2">
                        <div className="space-y-2">
                            <label className="text-xs text-slate-400 font-medium ml-1">Context Prompt</label>
                            <textarea 
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="E.g. On a marble table with sunlight..."
                                className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-slate-600 focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 focus:outline-none resize-none h-20"
                            />
                            <div className="flex flex-wrap gap-2">
                                {['Minimal Studio', 'Nature Outdoor', 'Dark Luxury'].map(tag => (
                                    <button key={tag} onClick={() => setPrompt(tag)} className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 transition-colors">{tag}</button>
                                ))}
                            </div>
                        </div>

                        <div className="border-2 border-dashed border-white/10 rounded-xl p-4 transition-colors hover:border-purple-500/30 hover:bg-white/5 relative group">
                             <input type="file" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" accept="image/png, image/jpeg" />
                             {!uploadedFile ? (
                                 <div className="flex flex-col items-center gap-2 py-4">
                                     <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-purple-500/10 transition-colors">
                                       <Upload className="w-5 h-5 text-slate-400 group-hover:text-purple-400" />
                                     </div>
                                     <p className="text-xs text-slate-400 text-center">Drag & drop product image</p>
                                 </div>
                             ) : (
                                 <div className="flex items-center gap-3">
                                     <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden border border-white/10"><img src={URL.createObjectURL(uploadedFile)} className="w-full h-full object-cover" alt="upload" /></div>
                                     <div className="flex-1 min-w-0">
                                         <p className="text-sm font-medium text-white truncate">{uploadedFile.name}</p>
                                         <p className="text-xs text-slate-500">{(uploadedFile.size / 1024).toFixed(0)} KB</p>
                                     </div>
                                     <button onClick={(e) => { e.preventDefault(); setUploadedFile(null); }} className="p-2 hover:bg-red-500/10 rounded-full z-20 group/del"><Trash2 className="w-4 h-4 text-slate-500 group-hover/del:text-red-400"/></button>
                                 </div>
                             )}
                        </div>
                        
                        <div className="pt-2 border-t border-white/5">
                            <QualitySelector />
                            <ImageCountSelector />
                        </div>
                        
                        <Button variant="gradient" className="w-full" onClick={() => runGeneration('Replace', prompt)} disabled={isGenerating}>
                          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Sparkles className="w-4 h-4 mr-2" />}
                          Generate Magic
                        </Button>
                    </div>
                )}
            </div>

            {/* 2. Interactive Tool Grid */}
            <div className="grid grid-cols-2 gap-3">
                 
                 {/* ADD TEXT Tool (Replaced Angle) */}
                 <div className={`col-span-1 glass-panel rounded-xl transition-all duration-300 bg-slate-900/50 ${activeTool === 'text' ? 'col-span-2 ring-1 ring-purple-500/50 bg-slate-800/50' : ''}`}>
                     <button disabled={isLocked} onClick={() => setActiveTool(activeTool === 'text' ? null : 'text')} className="w-full p-4 flex flex-col items-center justify-center gap-2 hover:bg-white/5 transition-colors disabled:opacity-50">
                         <Type className={`w-6 h-6 transition-colors ${activeTool === 'text' ? 'text-purple-400' : 'text-slate-400'}`} />
                         <span className="text-xs font-medium text-slate-300">Add Text</span>
                     </button>
                     {activeTool === 'text' && (
                         <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 space-y-4 border-t border-white/5 mt-2 pt-4">
                             <textarea 
                                value={textPrompt}
                                onChange={(e) => setTextPrompt(e.target.value)}
                                rows={3}
                                placeholder="Type the text you want to add to the image..." 
                                className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50 resize-none"
                             />
                             <ImageCountSelector />
                             <Button size="sm" variant="gradient" className="w-full" disabled={isGenerating} onClick={() => runGeneration('Add Text', textPrompt)}>✨ Generate with Text</Button>
                         </div>
                     )}
                 </div>

                 {/* MODIFY Tool */}
                 <div className={`col-span-1 glass-panel rounded-xl transition-all duration-300 bg-slate-900/50 ${activeTool === 'modify' ? 'col-span-2 ring-1 ring-blue-500/50 bg-slate-800/50' : ''}`}>
                     <button disabled={isLocked} onClick={() => setActiveTool(activeTool === 'modify' ? null : 'modify')} className="w-full p-4 flex flex-col items-center justify-center gap-2 hover:bg-white/5 transition-colors disabled:opacity-50">
                         <Edit2 className={`w-6 h-6 transition-colors ${activeTool === 'modify' ? 'text-blue-400' : 'text-slate-400'}`} />
                         <span className="text-xs font-medium text-slate-300">Modify Content</span>
                     </button>
                     {activeTool === 'modify' && (
                         <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 space-y-4 border-t border-white/5 mt-2 pt-4">
                             <textarea 
                                value={modifyPrompt}
                                onChange={(e) => setModifyPrompt(e.target.value)}
                                rows={5}
                                placeholder="E.g. add flowers, make it winter..." 
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 resize-none"
                             />
                             <QualitySelector />
                             <ImageCountSelector />
                             <Button size="sm" variant="gradient" className="w-full from-blue-600 to-cyan-600" disabled={isGenerating} onClick={() => runGeneration('Modify', modifyPrompt)}>Generate Changes</Button>
                         </div>
                     )}
                 </div>

                 {/* RATIO Tool */}
                 <div className={`col-span-1 glass-panel rounded-xl transition-all duration-300 bg-slate-900/50 ${activeTool === 'ratio' ? 'col-span-2 ring-1 ring-pink-500/50 bg-slate-800/50' : ''}`}>
                     <button disabled={isLocked} onClick={() => setActiveTool(activeTool === 'ratio' ? null : 'ratio')} className="w-full p-4 flex flex-col items-center justify-center gap-2 hover:bg-white/5 transition-colors disabled:opacity-50">
                         <Layers className={`w-6 h-6 transition-colors ${activeTool === 'ratio' ? 'text-pink-400' : 'text-slate-400'}`} />
                         <span className="text-xs font-medium text-slate-300">Change Ratio</span>
                     </button>
                     {activeTool === 'ratio' && (
                         <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 space-y-4 border-t border-white/5 mt-2 pt-4">
                             <div className="grid grid-cols-4 gap-2">
                                 {ratioOptions.map(r => (
                                     <button 
                                        key={r.label} 
                                        onClick={() => { setSelectedRatio(r.name); runGeneration('Ratio', r.name); }} 
                                        className="flex flex-col items-center gap-1 group"
                                     >
                                         <div className={`w-full ${r.aspect} border-2 rounded transition-all duration-300 ${selectedRatio === r.name ? 'border-transparent bg-gradient-to-br from-purple-500 to-pink-500' : 'border-slate-600 bg-slate-800 group-hover:border-pink-500'}`}></div>
                                         <div className="text-center">
                                            <span className={`block text-[10px] font-bold ${selectedRatio === r.name ? 'text-pink-400' : 'text-slate-300'}`}>{r.label}</span>
                                            <span className="block text-[8px] text-slate-500 uppercase">{r.name}</span>
                                         </div>
                                     </button>
                                 ))}
                             </div>
                             <ImageCountSelector />
                         </div>
                     )}
                 </div>

                 {/* ENHANCE Tool */}
                 <div className={`col-span-1 glass-panel rounded-xl transition-all duration-300 bg-slate-900/50 ${activeTool === 'enhance' ? 'col-span-2 ring-1 ring-yellow-500/50 bg-slate-800/50' : ''}`}>
                     <button disabled={isLocked} onClick={() => setActiveTool(activeTool === 'enhance' ? null : 'enhance')} className="w-full p-4 flex flex-col items-center justify-center gap-2 hover:bg-white/5 transition-colors disabled:opacity-50">
                         <Wand2 className={`w-6 h-6 transition-colors ${activeTool === 'enhance' ? 'text-yellow-400' : 'text-slate-400'}`} />
                         <span className="text-xs font-medium text-slate-300">Enhance</span>
                     </button>
                     {activeTool === 'enhance' && (
                         <div className="px-4 pb-4 pt-0 animate-in slide-in-from-top-2 space-y-4 border-t border-white/5 mt-2 pt-4">
                             <p className="text-xs text-slate-400">Upscale resolution and improve lighting details.</p>
                             <QualitySelector />
                             <ImageCountSelector />
                             <Button size="sm" variant="gradient" className="w-full from-yellow-600 to-orange-600" disabled={isGenerating} onClick={() => runGeneration('Enhance', 'High Resolution Upscale')}>Enhance Image</Button>
                         </div>
                     )}
                 </div>
            </div>

            {/* Download */}
            <Button variant="secondary" disabled={isLocked} className="w-full bg-white/5 hover:bg-white/10 border-white/10 text-white" onClick={handleDownload}>
                {isLocked ? '🔒 Pro Only' : 'Download High Res'}
            </Button>
        </div>
      </div>

      {/* Fullscreen Lightbox */}
      {showLightbox && (
          <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-xl flex items-center justify-center animate-in fade-in duration-200" onClick={() => setShowLightbox(false)}>
              <div className="absolute top-6 right-6 z-50">
                  <button className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" onClick={() => setShowLightbox(false)}>
                      <X className="w-6 h-6" />
                  </button>
              </div>
              <img src={currentImage} className="max-w-[95%] max-h-[95vh] object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} alt="Lightbox" />
          </div>
      )}
    </div>
  );
};