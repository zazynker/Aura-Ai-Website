import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Upload, Loader2, Sparkles, Layers, Maximize2, Trash2, Edit2, X, Lock, Wand2, Clock, Heart, ExternalLink, ChevronDown, Settings2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { mockTemplates } from '../data/mockData';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Generation, Template } from '../types';
import { generateImages } from '../utils/generateService';

export const Modify = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, addGenerations, addToast, generations, collections, saveBrowsingState, browsing, saveModifySession } = useStore();
  const MODIFY_SESSION_ID = 'modify-session';

  // Initialize from session if available
  const session = browsing.modifySession;

  // Check if we're coming from Template gallery or Dashboard with an initial image
  const navigationState = location.state as { 
    initialImage?: string; 
    initialImageSource?: { templateId: string; templateName: string };
  } | null;

  // --- State ---
  // Image Selection
  const [hasSelectedImage, setHasSelectedImage] = useState(
    navigationState?.initialImage ? true : (session?.hasSelectedImage || false)
  );
  const [currentImage, setCurrentImage] = useState<string>(
    navigationState?.initialImage || session?.currentImage || ''
  );
  const [originalUploadedImage, setOriginalUploadedImage] = useState<string>(
    navigationState?.initialImage || session?.originalUploadedImage || ''
  );
  
  // Track current image source (for proper labeling when generating)
  const [currentImageSource, setCurrentImageSource] = useState<{ templateId: string; templateName: string }>(
    navigationState?.initialImageSource || 
    session?.currentImageSource || 
    { templateId: MODIFY_SESSION_ID, templateName: 'User Upload' }
  );

  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  
  // History Tab State (Sidebar)
  const [historyTab, setHistoryTab] = useState<'current' | 'all'>('current');

  // Modals
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [imagePickerTab, setImagePickerTab] = useState<'session' | 'all' | 'upload' | 'collection'>('session');

  // Generation Configuration - DEFAULT TO 4
  const [outputCount, setOutputCount] = useState(4);
  const [quality, setQuality] = useState<'Standard' | 'High' | 'Ultra'>('Standard');
  
  // Generation Process State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generatedResults, setGeneratedResults] = useState<string[]>(session?.generatedResults || []);
  const [showResults, setShowResults] = useState(session?.showResults || false);
  const [generationContext, setGenerationContext] = useState<string>(''); 

  // UI State
  const [showLightbox, setShowLightbox] = useState(false);
  // Replace Product is DEFAULT OPEN when image is selected
  const [activeTool, setActiveTool] = useState<string | null>(hasSelectedImage ? 'replace' : null);
  
  // Replace Product Advanced Options
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [extraBlend, setExtraBlend] = useState(true); // Default ON
  const [productSizePercent, setProductSizePercent] = useState<string>(''); // Empty = no adjustment
  
  // Inputs
  const [prompt, setPrompt] = useState(() => {
    // 从localStorage读取上次的describe
    const saved = localStorage.getItem('lazora_describe_prompt');
    return saved || '';
  });
  const [describeHistory, setDescribeHistory] = useState<string[]>(() => {
    const saved = localStorage.getItem('lazora_describe_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [showDescribeHistory, setShowDescribeHistory] = useState(false);
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [modifyReferenceFile, setModifyReferenceFile] = useState<File | null>(null);
  const [selectedRatio, setSelectedRatio] = useState('Square');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // --- Logic: History ---
  const history = useMemo(() => {
    // Show images from current source (template or upload)
    const sourceId = currentImageSource.templateId;
    
    // Filter generations by current source
    const sourceGenerations = generations
        .filter(g => g.templateId === sourceId)
        .sort((a, b) => b.createdAt - a.createdAt);
    
    // Add original image at the end
    if (originalUploadedImage) {
        const originalItem: Generation = {
            id: 'original',
            userId: user?.id || 'system',
            templateId: sourceId,
            templateName: currentImageSource.templateName,
            imageUrl: originalUploadedImage,
            createdAt: 0,
            creditsUsed: 0,
            prompt: 'Original',
            isOriginal: true
        };
        return [...sourceGenerations, originalItem];
    }
    
    return sourceGenerations;
  }, [originalUploadedImage, generations, user, currentImageSource]);

  // --- Effects ---
  useEffect(() => {
    if (!user) {
      saveBrowsingState({ intendedDestination: '/modify' });
      navigate('/login');
    }
  }, [user]);

  // Auto-open Replace tool when image is selected
  useEffect(() => {
    if (hasSelectedImage && activeTool === null) {
      setActiveTool('replace');
    }
  }, [hasSelectedImage]);

  // Clear navigation state after using it (so refresh doesn't re-apply)
  useEffect(() => {
      if (navigationState?.initialImage) {
          // Replace current history entry to remove the state
          window.history.replaceState({}, document.title);
      }
  }, []); // Run only once on mount

  // Persist Session
  useEffect(() => {
    if (hasSelectedImage) {
        saveModifySession({
            hasSelectedImage,
            currentImage,
            originalUploadedImage,
            generatedResults,
            showResults,
            currentImageSource
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSelectedImage, currentImage, originalUploadedImage, generatedResults, showResults, currentImageSource]);

  if (!user) return null;

  // --- Logic: Session & Navigation ---
  
  const resetSession = () => {
    setHasSelectedImage(false);
    setCurrentImage('');
    setOriginalUploadedImage('');
    setGeneratedResults([]);
    setShowResults(false);
    setCurrentImageSource({ templateId: MODIFY_SESSION_ID, templateName: 'User Upload' });
    saveModifySession(null);
  };

  const handleChangeImage = () => {
    setImagePickerTab('session');
    setShowImagePicker(true);
  };

  const handleAllHistoryClick = (gen: Generation) => {
    setCurrentImage(gen.imageUrl);
    setCurrentImageSource({ 
        templateId: gen.templateId, 
        templateName: gen.templateName || 'Template' 
    });
    setHasSelectedImage(true);
    
    // Update original if possible
    const t = mockTemplates.find(tmp => tmp.id === gen.templateId);
    if (t) {
        setOriginalUploadedImage(t.imageUrl);
    }
  };

  // --- Logic: Image Selection ---
  const handleLocalUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const imageUrl = URL.createObjectURL(e.target.files[0]);
      setCurrentImage(imageUrl);
      setOriginalUploadedImage(imageUrl);
      setCurrentImageSource({ templateId: MODIFY_SESSION_ID, templateName: 'User Upload' });
      setHasSelectedImage(true);
    }
  };

  const handleSelectFromHistory = (imgUrl: string) => {
    setCurrentImage(imgUrl);
    // If selecting from current history list, context implies we are staying in same source
    // No need to change source or original here usually
    setHasSelectedImage(true);
  };

  const handleImagePickerSelect = (imageUrl: string) => {
    setCurrentImage(imageUrl);
    // If coming from image picker select (Session tab), it's likely Modify Session
    setCurrentImageSource({ templateId: MODIFY_SESSION_ID, templateName: 'User Upload' });
    setHasSelectedImage(true);
    setShowImagePicker(false);
  };

  const handleImagePickerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const imageUrl = URL.createObjectURL(e.target.files[0]);
      setCurrentImage(imageUrl);
      setOriginalUploadedImage(imageUrl);
      setCurrentImageSource({ templateId: MODIFY_SESSION_ID, templateName: 'User Upload' });
      setHasSelectedImage(true);
      setShowImagePicker(false);
    }
  };

  const handleImagePickerHistoryClick = (gen: Generation) => {
    setCurrentImage(gen.imageUrl);
    setCurrentImageSource({ templateId: gen.templateId, templateName: gen.templateName || 'Template' });
    setHasSelectedImage(true);
    setShowImagePicker(false);
    
    const t = mockTemplates.find(tmp => tmp.id === gen.templateId);
    if (t) {
        setOriginalUploadedImage(t.imageUrl);
    }
  };

  // --- Logic: Generation (Using Real Gemini API) ---
  const saveDescribeToHistory = (text: string) => {
    if (!text.trim()) return;
    const newHistory = [text, ...describeHistory.filter(h => h !== text)].slice(0, 3);
    setDescribeHistory(newHistory);
    localStorage.setItem('lazora_describe_history', JSON.stringify(newHistory));
    localStorage.setItem('lazora_describe_prompt', text);
  };

  const runGeneration = async (toolName: string, promptText: string) => {
    if (!user) { navigate('/login'); return; }
    if (user.credits < outputCount) { addToast('error', 'Not enough credits'); navigate('/pricing'); return; }

    // Save describe to history when generating with Replace tool
    if (toolName === 'Replace' && promptText.trim()) {
      saveDescribeToHistory(promptText);
    }

    // Validation - For Replace, only require uploaded file (prompt is optional)
    if (toolName === 'Replace' && !uploadedFile) {
       addToast('error', 'Please upload a product image');
       return;
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

    // Build the full prompt based on tool type
    let fullPrompt = '';
    let baseImageUrl: string | undefined = currentImage || undefined;  // The scene/model image
    let productImageUrl: string | undefined = undefined;  // The product to insert
    
    if (toolName === 'Replace') {
      // For Replace: send BOTH the scene image AND the product image
      // Order in API: scene image FIRST, product image SECOND (matches Google AI Studio)
      if (uploadedFile) {
        // Convert uploaded product file to base64 data URL
        const reader = new FileReader();
        productImageUrl = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(uploadedFile);
        });
        
        // Build the prompt based on options
        let promptParts: string[] = [];
        
        // Base replacement instruction
        if (promptText && promptText.trim()) {
          // User provided material description
          promptParts.push(`Replace the product in Image 1 with ${promptText.trim()} from Image 2`);
        } else {
          // No description - use simple default
          promptParts.push(`Replace the product in Image 1 with the product from Image 2`);
        }
        
        // Add size adjustment if specified (10-300%, skip if 100)
        if (productSizePercent && productSizePercent.trim()) {
          const percent = parseInt(productSizePercent);
          if (percent >= 10 && percent <= 300 && percent !== 100) {
            if (percent < 100) {
              promptParts.push(`Scale the replacement product down to approximately ${percent}% of the original product's size`);
            } else {
              promptParts.push(`Scale the replacement product up to approximately ${percent}% of the original product's size`);
            }
          }
        }
        
        // Add blend instruction if enabled
        if (extraBlend) {
          promptParts.push(`Blend the light, shadow and color of the product naturally with the background`);
        }
        
        fullPrompt = promptParts.join('. ') + '.';
      } else {
        // This shouldn't happen due to validation above, but just in case
        addToast('error', 'Please upload a product image');
        setIsGenerating(false);
        return;
      }
    } else if (toolName === 'Add Text') {
      fullPrompt = `Add the text "${promptText}" to this image`;
    } else if (toolName === 'Modify') {
      // Modify can optionally have a reference image
      if (modifyReferenceFile) {
        // Convert reference file to base64
        const reader = new FileReader();
        productImageUrl = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(modifyReferenceFile);
        });
        fullPrompt = `Modify Image 1 based on the style/reference from Image 2: ${promptText}`;
      } else {
        // Text-only modify
        fullPrompt = promptText;
      }
    } else if (toolName === 'Enhance') {
      fullPrompt = 'Enhance this image: improve quality, lighting and colors';
    } else if (toolName === 'Ratio') {
      fullPrompt = `Edit this image: Extend or crop this image to fit a ${promptText} aspect ratio while maintaining the visual style and content.`;
    } else {
      fullPrompt = promptText || `Apply ${toolName} effect to this image.`;
    }

    console.log('=== Starting AI Generation ===');
    console.log('Tool:', toolName);
    console.log('Full Prompt:', fullPrompt);
    console.log('Has base image:', !!baseImageUrl);
    console.log('Has product image:', !!productImageUrl);
    console.log('Output count:', outputCount);
    console.log('Extra Blend:', extraBlend);
    console.log('Size Percent:', productSizePercent);

    // Start progress animation
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + 1, 90));
    }, 300);

    try {
      // Call the real Gemini API with the selected number of images
      const result = await generateImages({
        prompt: fullPrompt,
        imageUrl: baseImageUrl,           // The scene/model image
        productImageUrl: productImageUrl, // The product to insert (for Replace)
        numberOfImages: outputCount,      // Generate multiple images in parallel
      });

      clearInterval(progressInterval);

      if (!result.success || !result.images || result.images.length === 0) {
        console.error('Generation failed:', result.error);
        setIsGenerating(false);
        setProgress(0);
        addToast('error', result.error || 'Generation failed. Please try again.');
        return;
      }

      console.log('=== Generation Successful ===');
      console.log('Generated images:', result.images.length);
      setProgress(100);

      // Process the generated images
      const newImages = result.images;

      const newGenerations: Generation[] = newImages.map(imgUrl => ({
          id: `gen_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          userId: user?.id || '',
          templateId: currentImageSource.templateId,
          templateName: currentImageSource.templateName,
          imageUrl: imgUrl,
          createdAt: Date.now(),
          creditsUsed: 1,
          prompt: promptText || toolName || 'AI Generation',
          isOriginal: false
      }));

      addGenerations(newGenerations);

      setTimeout(() => {
          setIsGenerating(false);
          setGeneratedResults(newImages);
          setCurrentImage(newImages[0]);
          setShowResults(true);
          setProgress(0);
          addToast('success', `Generated ${newImages.length} image(s) with AI!`);
      }, 300);

    } catch (err) {
      console.error('Generation exception:', err);
      clearInterval(progressInterval);
      setIsGenerating(false);
      setProgress(0);
      addToast('error', err instanceof Error ? err.message : 'Generation failed. Please try again.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0]);
    }
  };

  const handleDownload = () => {
    addToast('success', 'Image Downloaded!');
  };

  // --- UI Components ---
  const ImageCountSelector = () => (
      <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Variations
            </label>
            <span className="text-[10px] text-slate-400">{outputCount} images</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map(num => (
                  <button
                      key={num}
                      onClick={() => setOutputCount(num)}
                      className={`py-2 text-xs font-medium rounded-lg border transition-all ${
                          outputCount === num
                              ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-900/20'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                  >
                      {num}
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
  ];

  return (
    <div className="min-h-screen pt-20 px-4 md:px-6 h-screen flex flex-col overflow-hidden relative bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      
      <div className="flex-1 flex gap-6 h-full pb-6">
            {/* LEFT COLUMN: History */}
            <div className="hidden lg:flex flex-col w-64 glass-panel rounded-2xl p-4 h-full overflow-hidden mt-8 md:mt-0">
                {/* History Tabs */}
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg mb-4 border border-slate-200 dark:border-white/5">
                    <button
                    onClick={() => setHistoryTab('current')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                        historyTab === 'current'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                    >
                    Current
                    </button>
                    <button
                    onClick={() => setHistoryTab('all')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                        historyTab === 'all'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                    >
                    All History
                    </button>
                </div>

                <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-4 uppercase tracking-wider pl-1 flex items-center gap-2 truncate">
                    <Layers className="w-4 h-4 shrink-0" /> 
                    {historyTab === 'current' ? 'Session' : 'All History'}
                </h3>
                
                {historyTab === 'current' ? (
                    // CURRENT SOURCE HISTORY VIEW
                    <>
                    {history.length > 0 ? (
                        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                            {history.map((gen) => (
                            <div
                                key={gen.id}
                                onClick={() => handleSelectFromHistory(gen.imageUrl)}
                                className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                                currentImage === gen.imageUrl
                                    ? 'border-purple-500 ring-2 ring-purple-500/20'
                                    : 'border-transparent hover:border-purple-500/50'
                                }`}
                            >
                                <img
                                src={gen.imageUrl}
                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                alt="History item"
                                loading="lazy"
                                />
                                {gen.isOriginal && (
                                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-[10px] text-white font-medium border border-white/10">
                                    Original
                                    </div>
                                )}
                            </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-4">
                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
                            <Layers className="w-8 h-8 text-slate-400 dark:text-white/20" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white">No history for this source</p>
                            <p className="text-xs text-slate-500 mt-1">Generate some images first</p>
                        </div>
                        </div>
                    )}
                    </>
                ) : (
                    // ALL HISTORY VIEW
                    <>
                    {generations.length > 0 ? (
                        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                            {[...generations].sort((a, b) => b.createdAt - a.createdAt).map((gen) => (
                                <div
                                    key={gen.id}
                                    onClick={() => handleAllHistoryClick(gen)}
                                    className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                                    currentImage === gen.imageUrl
                                        ? 'border-purple-500 ring-2 ring-purple-500/20'
                                        : 'border-transparent hover:border-purple-500/50'
                                    }`}
                                >
                                    <img
                                    src={gen.imageUrl}
                                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                    alt="History item"
                                    loading="lazy"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-4">
                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
                            <Clock className="w-8 h-8 text-slate-400 dark:text-white/20" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white">No history yet</p>
                            <p className="text-xs text-slate-500 mt-1">Your generated images will appear here</p>
                        </div>
                        </div>
                    )}
                    </>
                )}
            </div>

            {/* CENTER COLUMN: Preview */}
            <div className="flex-1 glass-panel rounded-2xl relative overflow-hidden flex items-center justify-center bg-slate-100 dark:bg-slate-800/50 mt-8 md:mt-0">
                {!hasSelectedImage ? (
                    // --- NO IMAGE STATE ---
                    <div className="flex flex-col items-center justify-center gap-6 p-8 text-center">
                         <div className="w-20 h-20 rounded-full bg-slate-200 dark:bg-white/5 flex items-center justify-center">
                            <Wand2 className="w-10 h-10 text-slate-400 dark:text-white/30" />
                         </div>
                         <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Start a new session</h2>
                            <p className="text-sm text-slate-500 mt-2">Upload an image or select from history</p>
                         </div>
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-2xl">
                            {/* 1. Local Upload */}
                            <div className="relative group cursor-pointer h-40">
                                <input type="file" accept="image/*" onChange={handleLocalUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                                <div className="h-full rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10 group-hover:border-purple-500/50 group-hover:bg-purple-50/50 dark:group-hover:bg-purple-500/5 transition-all flex flex-col items-center justify-center text-center gap-3">
                                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <Upload className="w-6 h-6 text-slate-400 group-hover:text-purple-500" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Upload</p>
                                        <p className="text-[10px] text-slate-500 mt-1">Local File</p>
                                    </div>
                                </div>
                            </div>

                            {/* 2. From History */}
                            <button onClick={() => { setImagePickerTab('all'); setShowImagePicker(true); }} className="group h-40 rounded-2xl border border-slate-200 dark:border-white/10 hover:border-purple-500/50 hover:bg-purple-50/50 dark:hover:bg-purple-500/5 transition-all flex flex-col items-center justify-center text-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Clock className="w-6 h-6 text-slate-400 group-hover:text-purple-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">History</p>
                                    <p className="text-[10px] text-slate-500 mt-1">{generations.length} items</p>
                                </div>
                            </button>

                            {/* 3. From Collections */}
                            <button onClick={() => { setImagePickerTab('collection'); setShowImagePicker(true); }} className="group h-40 rounded-2xl border border-slate-200 dark:border-white/10 hover:border-purple-500/50 hover:bg-purple-50/50 dark:hover:bg-purple-500/5 transition-all flex flex-col items-center justify-center text-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Heart className="w-6 h-6 text-slate-400 group-hover:text-purple-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Collection</p>
                                    <p className="text-[10px] text-slate-500 mt-1">{collections.length} packs</p>
                                </div>
                            </button>
                         </div>
                    </div>
                ) : (
                    // --- IMAGE PREVIEW STATE ---
                    <>
                        {/* Top Action Buttons */}
                        {hasSelectedImage && !isGenerating && (
                            <>
                                <div className="absolute top-4 left-4 z-20">
                                    <button
                                        onClick={handleChangeImage}
                                        className="px-3 py-2 rounded-xl glass-panel flex items-center gap-2 hover:bg-white dark:hover:bg-white/20 transition-all bg-white/80 dark:bg-black/40 text-slate-700 dark:text-white text-sm font-medium border border-slate-200 dark:border-white/10 shadow-sm"
                                    >
                                        <Upload className="w-4 h-4" />
                                        Change Image
                                    </button>
                                </div>
                                <div className="absolute top-4 right-4 z-20">
                                    <button
                                        onClick={handleDownload}
                                        className="px-3 py-2 rounded-xl glass-panel flex items-center gap-2 hover:bg-white dark:hover:bg-white/20 transition-all bg-white/80 dark:bg-black/40 text-slate-700 dark:text-white text-sm font-medium border border-slate-200 dark:border-white/10 shadow-sm"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                        Download
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Progress Overlay */}
                        {isGenerating && (
                        <div className="absolute inset-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
                            <div className="w-64 space-y-4">
                                <div className="flex justify-between text-xs font-medium uppercase tracking-wider text-slate-900 dark:text-white">
                                    <span className="flex items-center gap-2"><Sparkles className="w-3 h-3 animate-pulse text-purple-500 dark:text-purple-400"/> Generating {outputCount} images</span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-300 dark:border-white/5">
                                    <div 
                                        className="h-full bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 transition-all duration-75 ease-linear"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                <p className="text-center text-xs text-slate-500 dark:text-slate-400 animate-pulse">Creating {outputCount} variations...</p>
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

                        {imageDimensions.width > 0 && (
                            <span className="absolute bottom-4 right-4 z-10 text-xs text-slate-200 font-mono bg-black/60 backdrop-blur-md px-2 py-1 rounded border border-white/10">
                                {imageDimensions.width} x {imageDimensions.height}
                            </span>
                        )}

                        <button 
                            onClick={() => setShowLightbox(true)}
                            className="absolute bottom-4 left-4 z-10 p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors backdrop-blur-md border border-white/10"
                        >
                            <Maximize2 className="w-4 h-4" />
                        </button>
                    </>
                )}

                {/* Results Tray */}
                <div className={`absolute bottom-0 left-4 right-4 glass-panel border border-slate-500/20 dark:border-white/10 p-6 rounded-t-2xl transition-transform duration-500 ease-out z-40 shadow-2xl bg-white/60 dark:bg-slate-900/70 backdrop-blur-2xl ${showResults ? 'translate-y-0' : 'translate-y-[120%]'}`}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-500 dark:text-purple-400" /> 
                        Generated Results 
                        <span className="text-sm font-normal text-slate-500 ml-2">Saved to session history</span>
                        </h3>
                        <button onClick={() => setShowResults(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400 hover:text-slate-900 dark:hover:text-white" /></button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {generatedResults.map((img, idx) => (
                            <div key={idx} className="space-y-2 group">
                                <div className={`aspect-square rounded-xl overflow-hidden border relative cursor-pointer ${currentImage === img ? 'border-purple-500 ring-2 ring-purple-500/20' : 'border-slate-200 dark:border-white/10'}`} onClick={() => setCurrentImage(img)}>
                                    <img src={img} className="w-full h-full object-cover transition-transform group-hover:scale-105" alt={`Result ${idx}`} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* RIGHT COLUMN: Tools */}
            <div className="w-full md:w-80 lg:w-96 flex flex-col gap-4 overflow-y-auto pb-20 px-3 pt-2 custom-scrollbar relative">
                
                {/* Overlay when no image is selected */}
                {!hasSelectedImage && (
                    <div className="absolute inset-0 z-20 bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center rounded-2xl">
                        <div className="glass-panel px-6 py-4 rounded-xl shadow-xl bg-white/80 dark:bg-slate-900/80">
                            <p className="font-semibold text-slate-900 dark:text-white text-sm">Select an image to enable tools</p>
                        </div>
                    </div>
                )}

                {/* 1. REPLACE PRODUCT Tool - DEFAULT OPEN */}
                <div className={`glass-panel rounded-2xl p-1 transition-all duration-300 ${activeTool === 'replace' ? 'ring-1 ring-purple-500/50 bg-white dark:bg-slate-800/50' : ''}`}>
                    <button 
                        disabled={!hasSelectedImage}
                        onClick={() => setActiveTool(activeTool === 'replace' ? null : 'replace')}
                        className="w-full p-4 flex items-center justify-between text-left disabled:opacity-50"
                    >
                        <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                            <Sparkles className="w-5 h-5 text-purple-500 dark:text-purple-400" /> 
                            Quick Replace
                        </span>
                        {activeTool === 'replace' ? <X className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
                    </button>
                    
                    {activeTool === 'replace' && (
                        <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2">
                            {/* Product Upload */}
                            <div className="border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl p-3 transition-colors hover:border-purple-500/30 hover:bg-white dark:hover:bg-white/5 relative group">
                                <input type="file" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" accept="image/png, image/jpeg, image/webp" />
                                {!uploadedFile ? (
                                    <div className="flex flex-col items-center gap-2 py-3">
                                        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:bg-purple-500/10 transition-colors">
                                        <Upload className="w-5 h-5 text-slate-400 group-hover:text-purple-400" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Your product photo</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">White background works best</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200 dark:border-white/10">
                                            <img src={URL.createObjectURL(uploadedFile)} className="w-full h-full object-cover" alt="upload" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{uploadedFile.name}</p>
                                            <p className="text-xs text-slate-500">{(uploadedFile.size / 1024).toFixed(0)} KB</p>
                                        </div>
                                        <button onClick={(e) => { e.preventDefault(); setUploadedFile(null); }} className="p-2 hover:bg-red-500/10 rounded-full z-20 group/del">
                                            <Trash2 className="w-4 h-4 text-slate-500 group-hover/del:text-red-400"/>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Variations */}
                            <ImageCountSelector />

                            {/* Advanced Options - Collapsible */}
                            <div className="space-y-2">
                                <button 
                                    onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                                    className="w-full flex items-center justify-between"
                                >
                                    <span className="text-sm text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-2">
                                        <Settings2 className="w-4 h-4 text-purple-500" />
                                        Advanced options
                                    </span>
                                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`} />
                                </button>
                                
                                {showAdvancedOptions && (
                                    <div className="space-y-4 animate-in slide-in-from-top-2 pt-2">
                                        {/* Product Description with History */}
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-1.5">
                                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                                    Describe your product
                                                </label>
                                                <div className="relative group/tip">
                                                    <svg className="w-3.5 h-3.5 text-amber-500 cursor-help" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/></svg>
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all whitespace-nowrap z-50">Improves replacement accuracy</div>
                                                </div>
                                            </div>
                                            <div className="relative">
                                                <textarea 
                                                    value={prompt}
                                                    onChange={(e) => setPrompt(e.target.value)}
                                                    onFocus={() => setShowDescribeHistory(true)}
                                                    onBlur={() => setTimeout(() => setShowDescribeHistory(false), 200)}
                                                    placeholder="a frosted glass bottle with white dropper and gold cap"
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 focus:outline-none resize-none h-16"
                                                />
                                                {/* History Dropdown */}
                                                {showDescribeHistory && describeHistory.length > 0 && (
                                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                                                        <p className="px-3 py-1.5 text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-white/5">Recent</p>
                                                        {describeHistory.map((h, i) => (
                                                            <button
                                                                key={i}
                                                                onMouseDown={() => setPrompt(h)}
                                                                className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 truncate"
                                                            >
                                                                {h}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Extra Blend Toggle */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Extra Blend</p>
                                                <div className="relative group/tip">
                                                    <svg className="w-3.5 h-3.5 text-amber-500 cursor-help" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/></svg>
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all whitespace-nowrap z-50">Harmonize product lighting with scene</div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setExtraBlend(!extraBlend)}
                                                className={`relative w-11 h-6 rounded-full transition-colors ${
                                                    extraBlend ? 'bg-purple-600' : 'bg-slate-300 dark:bg-slate-600'
                                                }`}
                                            >
                                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                                    extraBlend ? 'translate-x-6' : 'translate-x-1'
                                                }`} />
                                            </button>
                                        </div>

                                        {/* Size Adjustment */}
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-1.5">
                                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                                    Resize product
                                                </label>
                                                <div className="relative group/tip">
                                                    <svg className="w-3.5 h-3.5 text-amber-500 cursor-help" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/></svg>
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all whitespace-nowrap z-50">50% = half size, 200% = double size</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input 
                                                    type="number"
                                                    value={productSizePercent}
                                                    onChange={(e) => setProductSizePercent(e.target.value)}
                                                    onBlur={(e) => {
                                                        const val = e.target.value;
                                                        if (val === '') return;
                                                        const num = parseInt(val);
                                                        if (isNaN(num) || num < 10) {
                                                            setProductSizePercent('10');
                                                        } else if (num > 300) {
                                                            setProductSizePercent('300');
                                                        }
                                                    }}
                                                    placeholder="100"
                                                    min="10"
                                                    max="300"
                                                    className="w-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-1 focus:ring-purple-500/50 focus:outline-none"
                                                />
                                                <span className="text-xs text-slate-400">% (10-300)</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            {/* Generate Button */}
                            <Button 
                                variant="gradient" 
                                className="w-full" 
                                onClick={() => runGeneration('Replace', prompt)} 
                                disabled={isGenerating || !uploadedFile}
                            >
                                {isGenerating ? (
                                    <Loader2 className="w-4 h-4 animate-spin mr-2"/>
                                ) : (
                                    <Sparkles className="w-4 h-4 mr-2" />
                                )}
                                {uploadedFile ? 'Generate Magic' : 'Upload product first'}
                            </Button>

                            {/* More Control CTA - Only show when Advanced options is open */}
                            {showAdvancedOptions && (
                                <div className="pt-3 border-t border-slate-200 dark:border-white/5">
                                    <button 
                                        onClick={() => setActiveTool('modify')}
                                        className="w-full flex flex-col items-center justify-center gap-0.5 py-2 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <Wand2 className="w-3.5 h-3.5" />
                                            Need more control?
                                        </span>
                                        <span>Try Modify with reference image →</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 2. MODIFY Tool */}
                <div className={`glass-panel rounded-2xl transition-all duration-300 ${activeTool === 'modify' ? 'ring-1 ring-purple-500/50 bg-white dark:bg-slate-800/50' : ''}`}>
                    <button 
                        disabled={!hasSelectedImage}
                        onClick={() => setActiveTool(activeTool === 'modify' ? null : 'modify')}
                        className="w-full p-4 flex items-center justify-between text-left disabled:opacity-50"
                    >
                        <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                            <Edit2 className="w-5 h-5 text-purple-500 dark:text-purple-400" /> 
                            Modify Content
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${activeTool === 'modify' ? 'rotate-180' : ''}`}/>
                    </button>
                    {activeTool === 'modify' && (
                        <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2">
                            {/* Tip */}
                            <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 rounded-lg">
                                💡 Describe changes in text, or upload a reference image for AI to follow.
                            </p>

                            {/* Prompt */}
                            <div className="space-y-1.5">
                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Describe the changes</label>
                                <textarea 
                                    value={modifyPrompt}
                                    onChange={(e) => setModifyPrompt(e.target.value)}
                                    rows={3}
                                    placeholder="e.g., Add soft morning light, change background to beach..." 
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-purple-500/50 resize-none"
                                />
                            </div>

                            {/* Reference Image Upload (Optional) */}
                            <div className="space-y-1.5">
                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                                    Reference image
                                    <span className="text-slate-400">(optional)</span>
                                </label>
                                <div className="border border-dashed border-slate-200 dark:border-white/10 rounded-lg p-2 transition-colors hover:border-purple-500/30 relative group">
                                    <input 
                                        type="file" 
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) {
                                                setModifyReferenceFile(e.target.files[0]);
                                            }
                                        }} 
                                        className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                                        accept="image/png, image/jpeg, image/webp" 
                                    />
                                    {!modifyReferenceFile ? (
                                        <div className="flex items-center gap-3 py-1">
                                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:bg-purple-500/10">
                                                <Upload className="w-4 h-4 text-slate-400 group-hover:text-purple-400" />
                                            </div>
                                            <p className="text-xs text-slate-500">Upload a style or scene reference</p>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                                <img src={URL.createObjectURL(modifyReferenceFile)} className="w-full h-full object-cover" alt="ref" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{modifyReferenceFile.name}</p>
                                            </div>
                                            <button 
                                                onClick={(e) => { e.preventDefault(); setModifyReferenceFile(null); }} 
                                                className="p-1.5 hover:bg-red-500/10 rounded-full z-20"
                                            >
                                                <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-400"/>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <ImageCountSelector />
                            <Button size="sm" variant="gradient" className="w-full" disabled={isGenerating || !modifyPrompt.trim()} onClick={() => runGeneration('Modify', modifyPrompt)}>
                                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Sparkles className="w-4 h-4 mr-2" />}
                                Generate Changes
                            </Button>
                        </div>
                    )}
                </div>

                {/* 3. RATIO Tool */}
                <div className={`glass-panel rounded-2xl transition-all duration-300 ${activeTool === 'ratio' ? 'ring-1 ring-pink-500/50 bg-white dark:bg-slate-800/50' : ''}`}>
                    <button 
                        disabled={!hasSelectedImage}
                        onClick={() => setActiveTool(activeTool === 'ratio' ? null : 'ratio')}
                        className="w-full p-4 flex items-center justify-between text-left disabled:opacity-50"
                    >
                        <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                            <Layers className="w-5 h-5 text-pink-500 dark:text-pink-400" /> 
                            Change Ratio
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${activeTool === 'ratio' ? 'rotate-180' : ''}`}/>
                    </button>
                    {activeTool === 'ratio' && (
                        <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2">
                            <div className="grid grid-cols-5 gap-2">
                                {ratioOptions.map(r => (
                                    <button 
                                        key={r.label} 
                                        onClick={() => setSelectedRatio(r.name)} 
                                        className="flex flex-col items-center gap-1 group"
                                    >
                                        <div className={`w-full ${r.aspect} max-h-12 border-2 rounded transition-all duration-300 ${selectedRatio === r.name ? 'border-transparent bg-gradient-to-br from-purple-500 to-pink-500' : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 group-hover:border-pink-500'}`}></div>
                                        <span className={`text-[10px] font-medium ${selectedRatio === r.name ? 'text-pink-500 dark:text-pink-400' : 'text-slate-500 dark:text-slate-400'}`}>{r.label}</span>
                                    </button>
                                ))}
                            </div>
                            <ImageCountSelector />
                            <Button size="sm" variant="gradient" className="w-full" disabled={isGenerating} onClick={() => runGeneration('Ratio', selectedRatio)}>
                                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Sparkles className="w-4 h-4 mr-2" />}
                                Update Ratio
                            </Button>
                        </div>
                    )}
                </div>

                {/* 4. ENHANCE Tool */}
                <div className={`glass-panel rounded-2xl transition-all duration-300 ${activeTool === 'enhance' ? 'ring-1 ring-pink-500/50 bg-white dark:bg-slate-800/50' : ''}`}>
                    <button 
                        disabled={!hasSelectedImage}
                        onClick={() => setActiveTool(activeTool === 'enhance' ? null : 'enhance')}
                        className="w-full p-4 flex items-center justify-between text-left disabled:opacity-50"
                    >
                        <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                            <Wand2 className="w-5 h-5 text-pink-500 dark:text-pink-400" /> 
                            Enhance
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${activeTool === 'enhance' ? 'rotate-180' : ''}`}/>
                    </button>
                    {activeTool === 'enhance' && (
                        <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2">
                            <p className="text-xs text-slate-500 dark:text-slate-400">Upscale resolution and improve details.</p>
                            <ImageCountSelector />
                            <Button size="sm" variant="gradient" className="w-full" disabled={isGenerating} onClick={() => runGeneration('Enhance', 'High Resolution Upscale')}>
                                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Sparkles className="w-4 h-4 mr-2" />}
                                Enhance Image
                            </Button>
                        </div>
                    )}
                </div>
            </div>
          </div>

      {/* Unified Image Picker Modal */}
      <Modal isOpen={showImagePicker} onClose={() => setShowImagePicker(false)} title="Change Image">
        <div className="space-y-4">
            {/* Tabs */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-white/5">
            <button
                onClick={() => setImagePickerTab('session')}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                imagePickerTab === 'session'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
                Session
            </button>
            <button
                onClick={() => setImagePickerTab('all')}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                imagePickerTab === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
                History
            </button>
            <button
                onClick={() => setImagePickerTab('collection')}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                imagePickerTab === 'collection'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
                Collection
            </button>
            <button
                onClick={() => setImagePickerTab('upload')}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                imagePickerTab === 'upload'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
                Upload
            </button>
            </div>

            {/* Tab Content */}
            {imagePickerTab === 'session' && (
            <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                {history.length > 0 ? (
                history.map((gen) => (
                    <div
                    key={gen.id}
                    onClick={() => handleImagePickerSelect(gen.imageUrl)}
                    className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                        currentImage === gen.imageUrl
                        ? 'border-purple-500 ring-2 ring-purple-500/20'
                        : 'border-transparent hover:border-purple-500'
                    }`}
                    >
                    <img src={gen.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                    {gen.isOriginal && (
                        <div className="absolute top-1 left-1 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] text-white font-medium border border-white/10">
                        Original
                        </div>
                    )}
                    </div>
                ))
                ) : (
                <div className="col-span-3 text-center py-8 text-slate-500">
                    <p>No session history yet.</p>
                </div>
                )}
            </div>
            )}

            {imagePickerTab === 'all' && (
            <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                {generations.length > 0 ? (
                [...generations].sort((a, b) => b.createdAt - a.createdAt).map((gen) => {
                    const isModify = gen.templateId === MODIFY_SESSION_ID;
                    return (
                    <div
                        key={gen.id}
                        onClick={() => handleImagePickerHistoryClick(gen)}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all group ${
                        isModify
                            ? currentImage === gen.imageUrl
                            ? 'border-purple-500 ring-2 ring-purple-500/20'
                            : 'border-transparent hover:border-purple-500'
                            : 'border-transparent hover:border-blue-400'
                        }`}
                    >
                        <img src={gen.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                        <div className={`absolute top-1 left-1 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                        isModify
                            ? 'bg-purple-600/80 text-white border-purple-400/30'
                            : 'bg-black/60 text-white border-white/10'
                        }`}>
                        {isModify ? 'Upload' : (gen.templateName || 'Template')}
                        </div>
                        {!isModify && (
                        <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/20 transition-colors flex items-center justify-center">
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-[10px] text-white flex items-center gap-1 border border-white/10">
                            <ExternalLink className="w-3 h-3" /> Open
                            </div>
                        </div>
                        )}
                    </div>
                    );
                })
                ) : (
                <div className="col-span-3 text-center py-8 text-slate-500">
                    <p>No history yet.</p>
                </div>
                )}
            </div>
            )}

            {imagePickerTab === 'collection' && (
                <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                    {collections.length > 0 ? collections.map(col => (
                        <div key={col.id} className="space-y-2">
                            <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                                <Layers className="w-4 h-4 text-purple-500"/> {col.name}
                            </h4>
                            <div className="grid grid-cols-4 gap-2">
                                {col.imageIds.length > 0 ? col.imageIds.map(templateId => {
                                    const template = mockTemplates.find(t => t.id === templateId);
                                    if (!template) return null;
                                    
                                    const isProUser = user?.plan === 'Pro' || user?.plan === 'Enterprise';
                                    const isLocked = template.isPro && !isProUser;
                                    
                                    return (
                                        <div 
                                            key={templateId}
                                            onClick={() => {
                                                if (isLocked) {
                                                    addToast('error', 'Pro templates require a Pro subscription');
                                                    return;
                                                }
                                                setCurrentImage(template.imageUrl);
                                                setOriginalUploadedImage(template.imageUrl);
                                                setCurrentImageSource({ templateId: template.id, templateName: template.name });
                                                setHasSelectedImage(true);
                                                setShowImagePicker(false);
                                            }}
                                            className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all group ${
                                                isLocked 
                                                    ? 'opacity-50 cursor-not-allowed border-slate-300 dark:border-white/10' 
                                                    : currentImage === template.imageUrl
                                                        ? 'border-purple-500 ring-2 ring-purple-500/20'
                                                        : 'border-transparent hover:border-purple-500'
                                            }`}
                                        >
                                            <img src={template.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                                            {isLocked && (
                                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                    <Lock className="w-5 h-5 text-white" />
                                                </div>
                                            )}
                                            {template.isPro && (
                                                <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-gradient-to-r from-purple-600 to-pink-600">
                                                    <span className="text-[8px] font-bold text-white">PRO</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                }) : (
                                    <p className="col-span-4 text-xs text-slate-500 italic">Empty collection</p>
                                )}
                            </div>
                        </div>
                    )) : (
                        <div className="text-center py-8 text-slate-500">
                            <p>No collections found.</p>
                            <p className="text-xs mt-1">Add templates to collections from the home page.</p>
                        </div>
                    )}
                </div>
            )}

            {imagePickerTab === 'upload' && (
            <div className="p-4">
                <div className="relative group cursor-pointer">
                <input
                    type="file"
                    accept="image/*"
                    onChange={handleImagePickerUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                <div className="h-48 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10 group-hover:border-purple-500/50 group-hover:bg-purple-50/50 dark:group-hover:bg-purple-500/5 transition-all flex flex-col items-center justify-center text-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-slate-400 group-hover:text-purple-500" />
                    </div>
                    <div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">Upload New Image</p>
                    <p className="text-xs text-slate-500 mt-1">Click or drag and drop</p>
                    </div>
                </div>
                </div>
            </div>
            )}
        </div>
      </Modal>

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