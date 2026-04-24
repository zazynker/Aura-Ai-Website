import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Upload, Loader2, Sparkles, Layers, Maximize2, Trash2, Edit2, X, Lock, Wand2, Clock, Heart, ExternalLink, ChevronDown, Settings2, Type, Plus, ArrowUp, Download } from 'lucide-react';
import { useStore, estimateCredits, calculateCreditsFromTokens, Resolution } from '../context/StoreContext';
import { supabase } from '../utils/supabase';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Generation, Template } from '../types';
import { generateImages } from '../utils/generateService';
import { uploadUserImage, validateFile } from '../utils/uploadService';

// 将同一批生成的图片分组
const groupGenerations = (gens: Generation[]): (Generation | Generation[])[] => {
    const groups: { [key: string]: Generation[] } = {};
    const result: (Generation | Generation[])[] = [];
    
    gens.forEach(gen => {
        if (gen.groupId) {
            if (!groups[gen.groupId]) {
                groups[gen.groupId] = [];
                result.push(groups[gen.groupId]);
            }
            groups[gen.groupId].push(gen);
        } else {
            result.push(gen);
        }
    });
    return result;
};

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
  // Default template for new users entering Modify page without an image
  const DEFAULT_TEMPLATE_URL = 'https://qdbixebjariupvcvsqff.supabase.co/storage/v1/object/public/templates/full/cos_out_han_cas_0039.png';
  const DEFAULT_TEMPLATE_SOURCE = { templateId: 'default-welcome', templateName: 'Welcome Template' };

  // Image Selection - always show an image (default template if nothing else)
  const [hasSelectedImage, setHasSelectedImage] = useState(true);
  const [currentImage, setCurrentImage] = useState<string>(
    navigationState?.initialImage || session?.currentImage || DEFAULT_TEMPLATE_URL
  );
  const [originalUploadedImage, setOriginalUploadedImage] = useState<string>(
    navigationState?.initialImage || session?.originalUploadedImage || DEFAULT_TEMPLATE_URL
  );
  
  // Track current image source (for proper labeling when generating)
  const [currentImageSource, setCurrentImageSource] = useState<{ templateId: string; templateName: string }>(
    navigationState?.initialImageSource || 
    session?.currentImageSource || 
    DEFAULT_TEMPLATE_SOURCE
  );

  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  
  // History Tab State (Sidebar)
  const [historyTab, setHistoryTab] = useState<'current' | 'all'>('current');

  // Modals
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [imagePickerTab, setImagePickerTab] = useState<'all' | 'upload' | 'collection'>('upload');

  // Generation Configuration - DEFAULT TO 4
  const [outputCount, setOutputCount] = useState(4);
  const [quality, setQuality] = useState<'Standard' | 'High' | 'Ultra'>('Standard');
  
  // Generation Process State
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generatedResults, setGeneratedResults] = useState<string[]>(session?.generatedResults || []);
  const [showResults, setShowResults] = useState(session?.showResults || false);
  const [generationContext, setGenerationContext] = useState<string>(''); 

  // UI State
  const [showLightbox, setShowLightbox] = useState(false);
  // Replace Product is DEFAULT OPEN when image is selected
  const [activeTool, setActiveTool] = useState<string | null>(hasSelectedImage ? 'replace' : null);
  const [selectedGroup, setSelectedGroup] = useState<Generation[] | null>(null);
  
  // Replace Product Advanced Options
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [extraBlend, setExtraBlend] = useState(true); // Default ON
  const [productSizePercent, setProductSizePercent] = useState<string>(''); // Empty = no adjustment
  
  // Inputs
  // prompt 初始为空，但保留 describeHistory（Recent 记录）
  const [prompt, setPrompt] = useState('');
  const [describeHistory, setDescribeHistory] = useState<string[]>(() => {
    const saved = localStorage.getItem('lazora_describe_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [showDescribeHistory, setShowDescribeHistory] = useState(false);
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [modifyReferenceFile, setModifyReferenceFile] = useState<File | null>(null);
  const [selectedRatio, setSelectedRatio] = useState('Square');
  const [ratioPrompt, setRatioPrompt] = useState(''); // Prompt for expanded areas in ratio change
  const [selectedResolution, setSelectedResolution] = useState('2K'); // Default to 2K
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // Text to Image State
  const [t2iPrompt, setT2iPrompt] = useState('');
  const [t2iFiles, setT2iFiles] = useState<File[]>([]);
  const [t2iRatio, setT2iRatio] = useState('1:1');
  const [t2iSize, setT2iSize] = useState('1K');
  const [t2iOutputCount, setT2iOutputCount] = useState(4);
  const [openDropdown, setOpenDropdown] = useState<'count' | 'ratio' | 'size' | null>(null);

  // Templates cache for collections (fetched from Supabase)
  const [templatesCache, setTemplatesCache] = useState<Map<string, Template>>(new Map());

  // Fetch templates for collections when image picker opens
  const fetchCollectionTemplates = useCallback(async () => {
    const allTemplateIds = collections.flatMap(c => c.imageIds);
    const uncachedIds = allTemplateIds.filter(tid => !templatesCache.has(tid));
    
    if (uncachedIds.length === 0) return;
    
    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .in('id', uncachedIds);
    
    if (!error && data) {
      const newCache = new Map(templatesCache);
      data.forEach(t => {
        newCache.set(t.id, {
          id: t.id,
          name: t.display_name || t.name,
          imageUrl: t.image_url,
          thumbUrl: t.thumb_url,
          category: t.category,
          tags: t.tags || [],
          isPro: t.is_pro || false,
          scene: t.scene,
          model: t.model,
          mood: t.mood,
          holiday: t.holiday
        });
      });
      setTemplatesCache(newCache);
    }
  }, [collections, templatesCache]);

  useEffect(() => {
    if (showImagePicker && imagePickerTab === 'collection') {
      fetchCollectionTemplates();
    }
  }, [showImagePicker, imagePickerTab, fetchCollectionTemplates]);

  // Fetch original template image when coming from Dashboard History
  useEffect(() => {
    const fetchOriginalTemplateImage = async () => {
      // Only fetch if we have a template source (not user upload) and navigation state exists
      if (navigationState?.initialImageSource && 
          navigationState.initialImageSource.templateId !== MODIFY_SESSION_ID) {
        
        const templateId = navigationState.initialImageSource.templateId;
        
        const { data, error } = await supabase
          .from('templates')
          .select('image_url')
          .eq('id', templateId)
          .single();
        
        if (!error && data) {
          // Set the original template image (not the generated one)
          setOriginalUploadedImage(data.image_url);
        }
      }
    };
    
    fetchOriginalTemplateImage();
  }, []); // Run only once on mount

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
    setImagePickerTab('upload');
    setShowImagePicker(true);
  };

  const handleAllHistoryClick = (gen: Generation) => {
    setCurrentImage(gen.imageUrl);
    setCurrentImageSource({ 
        templateId: gen.templateId, 
        templateName: gen.templateName || 'Template' 
    });
    setHasSelectedImage(true);
    
    // Update original - use the generation's image or fetch from cache
    const cachedTemplate = templatesCache.get(gen.templateId);
    if (cachedTemplate) {
        setOriginalUploadedImage(cachedTemplate.imageUrl);
    } else {
        // If not in cache, use the generation's image itself
        setOriginalUploadedImage(gen.imageUrl);
    }
  };

  const handleGroupClick = (group: Generation[]) => {
    setSelectedGroup(group);
    setShowResults(true);
  };

  // --- Logic: Image Selection ---
  const handleLocalUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Validate file size (10MB)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        addToast('error', `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`);
        e.target.value = '';
        return;
      }
      
      // Validate file type
      const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        addToast('error', 'Invalid file type. Please upload PNG, JPG, or WebP images only.');
        e.target.value = '';
        return;
      }
      
      const imageUrl = URL.createObjectURL(file);
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
      const file = e.target.files[0];
      
      // Validate file size (10MB)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        addToast('error', `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`);
        e.target.value = '';
        return;
      }
      
      // Validate file type
      const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        addToast('error', 'Invalid file type. Please upload PNG, JPG, or WebP images only.');
        e.target.value = '';
        return;
      }
      
      const imageUrl = URL.createObjectURL(file);
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
    
    // Update original - use cache or generation's own image
    const cachedTemplate = templatesCache.get(gen.templateId);
    if (cachedTemplate) {
        setOriginalUploadedImage(cachedTemplate.imageUrl);
    } else {
        setOriginalUploadedImage(gen.imageUrl);
    }
  };

  // --- Helper: Upload file to Supabase and get URL ---
  const uploadFileToSupabase = async (file: File): Promise<string | null> => {
    // Validate file first
    const validationError = validateFile(file);
    if (validationError) {
      addToast('error', validationError.message);
      return null;
    }

    setIsUploading(true);
    try {
      const result = await uploadUserImage(user!.id, file);
      if (!result.success) {
        addToast('error', result.error || 'Failed to upload image. Please try again.');
        return null;
      }
      return result.url || null;
    } catch (err) {
      console.error('Upload error:', err);
      addToast('error', 'Failed to upload image. Please check your connection.');
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // --- Logic: Generation (Using Real Gemini API) ---
  const saveDescribeToHistory = (text: string) => {
    if (!text.trim()) return;
    const newHistory = [text, ...describeHistory.filter(h => h !== text)].slice(0, 3);
    setDescribeHistory(newHistory);
    localStorage.setItem('lazora_describe_history', JSON.stringify(newHistory));
    // 不再保存当前 prompt，只保存 history
  };

  const runGeneration = async (toolName: string, promptText: string) => {
    if (!user) { navigate('/login'); return; }
    
        
    // Determine resolution for credit estimation
    // For Upscale, use the target resolution; for other tools, default to 1K
    let resolution: Resolution = '1K';
    if (toolName === 'Upscale') {
      resolution = promptText as Resolution; // '1K', '2K', or '4K'
    }
    
    // Pre-check: estimate credits needed (actual amount will be based on real token usage)
    const estimatedCredits = estimateCredits(resolution, outputCount);
    if (user.credits < estimatedCredits) { 
      addToast('error', `Not enough credits. Need ~${estimatedCredits}, have ${user.credits}`); 
      navigate('/pricing'); 
      return; 
    }

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
    
    // === FIX: If baseImageUrl is a local URL (blob: or data:), we need to upload it first ===
    if (baseImageUrl && (baseImageUrl.startsWith('blob:') || baseImageUrl.startsWith('data:'))) {
      console.log('Base image is local URL (blob/data), need to upload first...');
      try {
        setIsUploading(true);
        
        let file: File;
        if (baseImageUrl.startsWith('blob:')) {
          // Fetch blob and convert to File
          const response = await fetch(baseImageUrl);
          const blob = await response.blob();
          file = new File([blob], `upload_${Date.now()}.png`, { type: blob.type || 'image/png' });
        } else {
          // Convert base64 data URL to File
          const response = await fetch(baseImageUrl);
          const blob = await response.blob();
          const mimeMatch = baseImageUrl.match(/^data:([^;]+);/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
          const ext = mimeType.split('/')[1] || 'png';
          file = new File([blob], `upload_${Date.now()}.${ext}`, { type: mimeType });
        }
        
        const uploadedUrl = await uploadFileToSupabase(file);
        if (!uploadedUrl) {
          setIsGenerating(false);
          setIsUploading(false);
          return; // Error already shown
        }
        baseImageUrl = uploadedUrl;
        console.log('Uploaded base image to Supabase:', uploadedUrl);
        setIsUploading(false);
      } catch (err) {
        console.error('Failed to upload base image:', err);
        addToast('error', 'Failed to upload image. Please try again.');
        setIsGenerating(false);
        setIsUploading(false);
        return;
      }
    }
    
    if (toolName === 'Replace') {
      // For Replace: send BOTH the scene image AND the product image
      // Order in API: scene image FIRST, product image SECOND (matches Google AI Studio)
      if (uploadedFile) {
        // === KEY FIX: Upload to Supabase first, then use URL ===
        const uploadedUrl = await uploadFileToSupabase(uploadedFile);
        if (!uploadedUrl) {
          setIsGenerating(false);
          return; // Error already shown by uploadFileToSupabase
        }
        productImageUrl = uploadedUrl;
        
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
        // === KEY FIX: Upload reference image to Supabase first ===
        const uploadedUrl = await uploadFileToSupabase(modifyReferenceFile);
        if (!uploadedUrl) {
          setIsGenerating(false);
          return; // Error already shown by uploadFileToSupabase
        }
        productImageUrl = uploadedUrl;
        fullPrompt = `Modify Image 1 based on the style/reference from Image 2: ${promptText}`;
      } else {
        // Text-only modify
        fullPrompt = promptText;
      }
    } else if (toolName === 'Enhance') {
      fullPrompt = 'Enhance this image: improve quality, lighting and colors';
    } else if (toolName === 'Upscale') {
      // promptText contains the target resolution (1K, 2K, 4K)
      // Important: We need to maintain the original aspect ratio
      fullPrompt = `Upscale this image to higher resolution. Recreate every detail exactly as it appears - same composition, same colors, same lighting, same content. Do not change the aspect ratio. Only increase the quality and resolution.`;
    } else if (toolName === 'Ratio') {
      // promptText contains the ratio name (e.g., "Square", "Portrait")
      const ratioMap: Record<string, string> = {
        'Square': '1:1',
        'Standard': '4:3',
        'Portrait': '3:4',
        'Photo': '3:2',
        'Pinterest': '2:3',
        'Landscape': '16:9',
        'Story': '9:16'
      };
      const targetRatio = ratioMap[promptText] || '1:1';
      
      // Build prompt with optional user description for expanded areas
      if (ratioPrompt && ratioPrompt.trim()) {
        fullPrompt = `Extend this image to fit a ${targetRatio} aspect ratio. For the newly expanded areas, fill with: ${ratioPrompt.trim()}. Maintain the original content and visual style seamlessly.`;
      } else {
        fullPrompt = `Extend this image to fit a ${targetRatio} aspect ratio. Seamlessly continue the existing background, style, and atmosphere into the expanded areas. Maintain the original content exactly as it appears.`;
      }
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
      // Determine image size based on tool
      let targetImageSize: '512' | '1K' | '2K' | '4K' = '1K'; // Default
      let targetAspectRatio: string | undefined = undefined;
      
      if (toolName === 'Upscale') {
        targetImageSize = promptText as '1K' | '2K' | '4K';
        
        // Get current image dimensions directly from the DOM to ensure accuracy
        const mainImg = document.querySelector('img[alt="Main preview"]') as HTMLImageElement;
        const imgWidth = mainImg?.naturalWidth || imageDimensions.width;
        const imgHeight = mainImg?.naturalHeight || imageDimensions.height;
        
        if (imgWidth > 0 && imgHeight > 0) {
          const ratio = imgWidth / imgHeight;
          // Map to closest supported Gemini ratio
          // Supported: 1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9
          if (ratio >= 2.2) targetAspectRatio = '21:9';       // ~2.33
          else if (ratio >= 1.7) targetAspectRatio = '16:9';  // ~1.78
          else if (ratio >= 1.4) targetAspectRatio = '3:2';   // 1.5
          else if (ratio >= 1.2) targetAspectRatio = '4:3';   // ~1.33
          else if (ratio >= 0.95) targetAspectRatio = '1:1';  // 1.0
          else if (ratio >= 0.8) targetAspectRatio = '4:5';   // 0.8
          else if (ratio >= 0.7) targetAspectRatio = '3:4';   // ~0.75
          else if (ratio >= 0.6) targetAspectRatio = '2:3';   // ~0.67
          else targetAspectRatio = '9:16';                     // ~0.56
          console.log('Upscale - Original dimensions:', imgWidth, 'x', imgHeight, 'Ratio:', ratio.toFixed(2), '→', targetAspectRatio);
        }
      } else if (toolName === 'Ratio') {
        // Set target aspect ratio for Ratio tool
        const ratioMap: Record<string, string> = {
          'Square': '1:1',
          'Standard': '4:3',
          'Portrait': '3:4',
          'Photo': '3:2',
          'Pinterest': '2:3',
          'Landscape': '16:9',
          'Story': '9:16'
        };
        targetAspectRatio = ratioMap[promptText] || '1:1';
        console.log('Ratio tool - Target ratio:', targetAspectRatio);
      }
      
      // Call the real Gemini API with the selected number of images
      const result = await generateImages({
        prompt: fullPrompt,
        imageUrl: baseImageUrl,           // The scene/model image
        productImageUrl: productImageUrl, // The product to insert (for Replace)
        numberOfImages: outputCount,      // Generate multiple images in parallel
        imageSize: targetImageSize,       // Resolution setting
        aspectRatio: targetAspectRatio,   // Target aspect ratio
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
      console.log('Image size:', result.imageSize);
      setProgress(100);

      // Process the generated images
      const newImages = result.images;
      const groupId = `group_${Date.now()}`;

      // 为 Ratio 工具生成更好的 prompt 显示
      let displayPrompt = promptText || toolName || 'AI Generation';
      if (toolName === 'Ratio') {
        const ratioLabelMap: Record<string, string> = {
          'Square': '1:1',
          'Standard': '4:3',
          'Portrait': '3:4',
          'Photo': '3:2',
          'Pinterest': '2:3',
          'Landscape': '16:9',
          'Story': '9:16'
        };
        displayPrompt = `Ratio: ${ratioLabelMap[promptText] || promptText}`;
      } else if (toolName === 'Upscale') {
        displayPrompt = `Upscale to ${promptText}`;
      }

      // Calculate credits based on ACTUAL token consumption from API
      const tokensUsed = result.tokensUsed || 0;
      const totalCreditsUsed = calculateCreditsFromTokens(tokensUsed);
      const creditsPerImage = newImages.length > 0 ? Math.ceil(totalCreditsUsed / newImages.length) : 0;
      
      console.log('=== Credit Calculation ===');
      console.log('Tokens used:', tokensUsed);
      console.log('Total credits:', totalCreditsUsed);
      console.log('Credits per image:', creditsPerImage);

      const newGenerations = newImages.map(imgUrl => ({
        userId: user?.id || '',
        templateId: currentImageSource.templateId,
        templateName: currentImageSource.templateName,
        imageUrl: imgUrl,
        creditsUsed: creditsPerImage,
        prompt: displayPrompt,
    }));

    await addGenerations(newGenerations, result.newCredits);

      setTimeout(() => {
          setIsGenerating(false);
          setGeneratedResults(newImages);
          setSelectedGroup(null);
          setCurrentImage(newImages[0]);
          setShowResults(true);
          setProgress(0);
          addToast('success', `Generated ${newImages.length} image(s)! Used ${totalCreditsUsed} credits.`);
      }, 300);

    } catch (err) {
      console.error('Generation exception:', err);
      clearInterval(progressInterval);
      setIsGenerating(false);
      setProgress(0);
      addToast('error', err instanceof Error ? err.message : 'Generation failed. Please try again.');
    }
  };

  // --- Text to Image Generation ---
  const runTextToImage = async () => {
    if (!user) { navigate('/login'); return; }
    
   
    // Pre-check: estimate credits needed
    const t2iResolution = t2iSize as Resolution;
    const estimatedCredits = estimateCredits(t2iResolution, t2iOutputCount);
    if (user.credits < estimatedCredits) { 
      addToast('error', `Not enough credits. Need ~${estimatedCredits}, have ${user.credits}`); 
      navigate('/pricing'); 
      return; 
    }

    if (!t2iPrompt.trim()) {
      addToast('error', 'Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    setShowResults(false);
    setProgress(0);

    // Progress animation
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + Math.random() * 8, 90));
    }, 500);

    try {
      // Upload reference images if any
      let referenceImageUrls: string[] = [];
      if (t2iFiles.length > 0) {
        setIsUploading(true);
        for (const file of t2iFiles) {
          const result = await uploadUserImage(user.id, file);
          if (result.url) {
            referenceImageUrls.push(result.url);
          }
        }
        setIsUploading(false);
      }

      // Build the prompt
      let fullPrompt = t2iPrompt.trim();
      if (referenceImageUrls.length > 0) {
        fullPrompt = `Generate an image based on this description: ${t2iPrompt.trim()}. Use the provided reference images for style, composition, or content guidance.`;
      }

      console.log('=== Text to Image Generation ===');
      console.log('Prompt:', fullPrompt);
      console.log('Reference images:', referenceImageUrls.length);
      console.log('Ratio:', t2iRatio);
      console.log('Size:', t2iSize);
      console.log('Output count:', t2iOutputCount);

      // Call API - for T2I, we pass reference images as the base image if available
      const result = await generateImages({
        prompt: fullPrompt,
        imageUrl: referenceImageUrls[0], // First reference as base
        productImageUrl: referenceImageUrls[1], // Second reference if available
        numberOfImages: t2iOutputCount,
        imageSize: t2iSize as '1K' | '2K' | '4K',
        aspectRatio: t2iRatio,
      });

      clearInterval(progressInterval);

      if (!result.success || !result.images || result.images.length === 0) {
        console.error('T2I generation failed:', result.error);
        setIsGenerating(false);
        setProgress(0);
        addToast('error', result.error || 'Generation failed. Please try again.');
        return;
      }

      console.log('=== T2I Generation Successful ===');
      console.log('Generated images:', result.images.length);
      setProgress(100);

      const newImages = result.images;
      const sourceId = 'text-to-image'; // Fixed ID for Generated category filtering
      const sourceName = 'Text to Image';
      const groupId = `group_${Date.now()}`;

      // Update source
      setCurrentImageSource({ templateId: sourceId, templateName: sourceName });
      setOriginalUploadedImage(newImages[0]);

      // Calculate credits based on ACTUAL token consumption from API
      const tokensUsed = result.tokensUsed || 0;
      const totalCreditsUsed = calculateCreditsFromTokens(tokensUsed);
      const creditsPerImage = newImages.length > 0 ? Math.ceil(totalCreditsUsed / newImages.length) : 0;
      
      console.log('=== T2I Credit Calculation ===');
      console.log('Tokens used:', tokensUsed);
      console.log('Total credits:', totalCreditsUsed);
      console.log('Credits per image:', creditsPerImage);

      // Create Generation records
      const newGenerations = newImages.map(imgUrl => ({
        userId: user?.id || '',
        templateId: sourceId,
        templateName: sourceName,
        imageUrl: imgUrl,
        creditsUsed: creditsPerImage,
        prompt: t2iPrompt || 'Text to Image',
    }));

    await addGenerations(newGenerations, result.newCredits);

      setTimeout(() => {
        setIsGenerating(false);
        setGeneratedResults(newImages);
        setSelectedGroup(null);
        setCurrentImage(newImages[0]);
        setHasSelectedImage(true);
        setActiveTool(null); // Close T2I panel after success
        setShowResults(true);
        setProgress(0);
        addToast('success', `Generated ${newImages.length} image(s)! Used ${totalCreditsUsed} credits.`);
      }, 300);

    } catch (err) {
      console.error('T2I generation exception:', err);
      clearInterval(progressInterval);
      setIsGenerating(false);
      setIsUploading(false);
      setProgress(0);
      addToast('error', err instanceof Error ? err.message : 'Generation failed. Please try again.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('=== Product image input onChange triggered ===');
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      console.log('File selected:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
      
      // 检查文件大小 (10MB)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        const errorMsg = `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB. Please compress your image first.`;
        console.error('Validation failed:', errorMsg);
        addToast('error', errorMsg);
        e.target.value = ''; // 清空 input
        return;
      }
      
      // 检查文件类型
      const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        const errorMsg = 'Invalid file type. Please upload PNG, JPG, or WebP images only.';
        console.error('Validation failed:', errorMsg);
        addToast('error', errorMsg);
        e.target.value = '';
        return;
      }
      
      console.log('Validation passed, setting product file');
      setUploadedFile(file);
      addToast('success', 'Product image ready');
    }
  };

  // Validate and filter files for T2I reference images
  const validateAndFilterFiles = (files: File[]): File[] => {
    const maxSize = 10 * 1024 * 1024;
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    const validFiles: File[] = [];
    
    for (const file of files) {
      if (file.size > maxSize) {
        addToast('error', `${file.name} is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`);
        continue;
      }
      if (!validTypes.includes(file.type)) {
        addToast('error', `${file.name} has invalid type. Use PNG, JPG, or WebP.`);
        continue;
      }
      validFiles.push(file);
    }
    
    return validFiles;
  };

  const handleDownload = async () => {
    try {
      // Fetch the image as blob to handle cross-origin
      const response = await fetch(currentImage);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      // Create temporary link and trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = `lazora-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up blob URL
      window.URL.revokeObjectURL(url);
      
      addToast('success', 'Image Downloaded!');
    } catch (error) {
      console.error('Download failed:', error);
      addToast('error', 'Download failed. Please try again.');
    }
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
    { label: '1:1', name: 'Square', width: 32, height: 32 },
    { label: '4:3', name: 'Standard', width: 32, height: 24 },
    { label: '3:4', name: 'Portrait', width: 24, height: 32 },
    { label: '3:2', name: 'Photo', width: 32, height: 21 },
    { label: '2:3', name: 'Pinterest', width: 21, height: 32 },
    { label: '16:9', name: 'Landscape', width: 32, height: 18 },
    { label: '9:16', name: 'Story', width: 18, height: 32 },
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
                    {activeTool === 'text2img' ? (
                        <>
                            <Type className="w-4 h-4 shrink-0 text-orange-500" /> 
                            Text to Image
                        </>
                    ) : (
                        <>
                            <Layers className="w-4 h-4 shrink-0" /> 
                            {historyTab === 'current' ? 'Session' : 'All History'}
                        </>
                    )}
                </h3>
                
                {historyTab === 'current' ? (
                    // CURRENT SOURCE HISTORY VIEW
                    <>
                    {history.length > 0 ? (
                        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                            {groupGenerations(history).map((item, idx) => {
                                if (Array.isArray(item)) {
                                    // 分组显示
                                    const group = item;
                                    const isSelected = group.some(g => currentImage === g.imageUrl);
                                    return (
                                        <div 
                                            key={`group_${idx}`} 
                                            onClick={() => handleGroupClick(group)}
                                            className="relative aspect-square cursor-pointer group shrink-0"
                                        >
                                            {/* 堆叠效果 */}
                                            <div className="absolute inset-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transform translate-y-1.5 translate-x-1.5 opacity-60"></div>
                                            <div className="absolute inset-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transform translate-y-0.5 translate-x-0.5 opacity-80"></div>
                                            <div className={`absolute inset-0 rounded-xl overflow-hidden border-2 transition-all z-10 ${
                                                isSelected
                                                ? 'border-purple-500 ring-2 ring-purple-500/20' 
                                                : 'border-transparent group-hover:border-purple-500/50'
                                            }`}>
                                                <img src={group[0].imageUrl} className="w-full h-full object-cover" loading="lazy" alt="history group" />
                                                {/* 数量徽章 */}
                                                <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] text-white font-medium border border-white/10 flex items-center gap-1">
                                                    <Layers className="w-3 h-3" /> {group.length}
                                                </div>
                                                {/* Hover 显示 prompt */}
                                                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <p className="text-[10px] text-white truncate">{group[0].prompt}</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                } else {
                                    // 单张显示
                                    const gen = item;
                                    return (
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
                                            {/* Hover 显示 prompt */}
                                            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                                <p className="text-[10px] text-white truncate">{gen.prompt}</p>
                                            </div>
                                        </div>
                                    );
                                }
                            })}
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
            <div className="flex-1 glass-panel rounded-2xl relative overflow-hidden flex items-center justify-center mt-8 md:mt-0 bg-white dark:bg-slate-900">
                {activeTool === 'text2img' ? (
                    // --- TEXT TO IMAGE STATE ---
                    <>
                        <div className="h-full w-full animate-in zoom-in-95 duration-300">
                            <div className="min-h-full w-full flex items-center justify-center p-4 sm:p-8">
                                <div className="w-full max-w-2xl space-y-6">
                                    <div className="text-center space-y-2">
                                        <h2 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
                                            <Sparkles className="w-8 h-8 text-orange-500" />
                                            Text to Image
                                        </h2>
                                        <p className="text-slate-500 dark:text-slate-400">Generate a completely new image from your imagination</p>
                                    </div>

                                    <div className="rounded-2xl bg-white dark:bg-slate-900 flex flex-col border border-slate-200 dark:border-white/10 shadow-sm p-4">
                                        {/* Top section: Upload + Prompt */}
                                        <div className="flex flex-col md:flex-row mb-4">
                                            {/* Left: Upload (max 3) */}
                                            <div className="flex gap-2 mb-4 md:mb-0 md:mr-4 shrink-0 group/stack relative">
                                                {t2iFiles.length === 0 ? (
                                                    <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-orange-500/50 hover:bg-orange-50/50 dark:hover:bg-orange-900/20 transition-colors relative cursor-pointer bg-slate-50/50 dark:bg-slate-950/50">
                                                        <input 
                                                            type="file" 
                                                            multiple
                                                            accept="image/png, image/jpeg, image/webp"
                                                            onChange={(e) => {
                                                                if (e.target.files) {
                                                                    const validFiles = validateAndFilterFiles(Array.from(e.target.files));
                                                                    if (validFiles.length > 0) {
                                                                        setT2iFiles(prev => [...prev, ...validFiles].slice(0, 3));
                                                                    }
                                                                    e.target.value = '';
                                                                }
                                                            }}
                                                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                                        />
                                                        <Plus className="w-6 h-6 text-slate-400 group-hover:text-orange-500" />
                                                    </div>
                                                ) : (
                                                    <div className="flex relative">
                                                        {/* First image container */}
                                                        <div className="relative z-30 shrink-0">
                                                            <div className="w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-sm">
                                                                <img src={URL.createObjectURL(t2iFiles[0])} className="w-full h-full object-cover" alt="reference" />
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        setT2iFiles(prev => prev.filter((_, i) => i !== 0));
                                                                    }}
                                                                    className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-red-500 text-white rounded-full opacity-0 group-hover/stack:opacity-100 transition-opacity z-40"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                            {/* Add button */}
                                                            {t2iFiles.length < 3 && (
                                                                <div className="absolute -bottom-2 -right-2 w-7 h-7 bg-white dark:bg-slate-800 rounded-full shadow-md border border-slate-200 dark:border-white/10 flex items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 z-50 transition-transform hover:scale-110">
                                                                    <input 
                                                                        type="file" 
                                                                        multiple
                                                                        accept="image/png, image/jpeg, image/webp"
                                                                        onChange={(e) => {
                                                                            if (e.target.files) {
                                                                                const validFiles = validateAndFilterFiles(Array.from(e.target.files));
                                                                                if (validFiles.length > 0) {
                                                                                    setT2iFiles(prev => [...prev, ...validFiles].slice(0, 3));
                                                                                }
                                                                                e.target.value = '';
                                                                            }
                                                                        }}
                                                                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                                                    />
                                                                    <Plus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        
                                                        {/* Stacked images */}
                                                        {t2iFiles.slice(1).map((file, idx) => {
                                                            const actualIdx = idx + 1;
                                                            return (
                                                                <div 
                                                                    key={actualIdx} 
                                                                    className={`w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-sm transition-all duration-300 ease-out absolute top-0 left-0 shrink-0
                                                                        ${actualIdx === 1 ? 'z-20 translate-x-2 translate-y-2 group-hover/stack:relative group-hover/stack:translate-x-0 group-hover/stack:translate-y-0 group-hover/stack:ml-2' : ''}
                                                                        ${actualIdx === 2 ? 'z-10 translate-x-4 translate-y-4 group-hover/stack:relative group-hover/stack:translate-x-0 group-hover/stack:translate-y-0 group-hover/stack:ml-2' : ''}
                                                                    `}
                                                                >
                                                                    <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" alt="reference" />
                                                                    <button 
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            setT2iFiles(prev => prev.filter((_, i) => i !== actualIdx));
                                                                        }}
                                                                        className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-red-500 text-white rounded-full opacity-0 group-hover/stack:opacity-100 transition-opacity z-40"
                                                                    >
                                                                        <X className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Right: Prompt */}
                                            <div className="flex-1">
                                                <textarea 
                                                    value={t2iPrompt}
                                                    onChange={(e) => setT2iPrompt(e.target.value)}
                                                    placeholder="Describe the image you want to generate in detail..."
                                                    className="w-full h-full min-h-[96px] bg-transparent border-none focus:ring-0 focus:outline-none text-slate-900 dark:text-white resize-none placeholder-slate-400 p-2"
                                                />
                                            </div>
                                        </div>

                                        {/* Bottom section: Settings & Generate */}
                                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 relative">
                                            {/* Invisible overlay to close dropdowns */}
                                            {openDropdown && (
                                                <div 
                                                    className="fixed inset-0 z-40" 
                                                    onClick={() => setOpenDropdown(null)}
                                                />
                                            )}
                                            <div className="flex flex-wrap items-center gap-3 relative z-50">
                                                {/* Quantity Dropdown */}
                                                <div className="relative">
                                                    <button 
                                                        onClick={() => setOpenDropdown(openDropdown === 'count' ? null : 'count')}
                                                        className="flex items-center gap-2 px-3 h-9 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-white/5 shadow-sm text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                                    >
                                                        <span>Variations: {t2iOutputCount}</span>
                                                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openDropdown === 'count' ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    {openDropdown === 'count' && (
                                                        <div className="absolute top-full left-0 mt-2 w-32 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-50 animate-in fade-in slide-in-from-top-2 p-1">
                                                            <div className="flex flex-col max-h-48 overflow-y-auto rounded-lg custom-scrollbar">
                                                                {[1, 2, 3, 4].map(num => (
                                                                    <button
                                                                        key={num}
                                                                        onClick={() => { setT2iOutputCount(num); setOpenDropdown(null); }}
                                                                        className={`px-3 py-2 text-sm text-left rounded-md transition-colors ${t2iOutputCount === num ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 font-medium' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                                                    >
                                                                        {num} Image{num > 1 ? 's' : ''}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Ratio Dropdown */}
                                                <div className="relative">
                                                    <button 
                                                        onClick={() => setOpenDropdown(openDropdown === 'ratio' ? null : 'ratio')}
                                                        className="flex items-center gap-2 px-3 h-9 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-white/5 shadow-sm text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                                    >
                                                        <span>Ratio: {t2iRatio}</span>
                                                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openDropdown === 'ratio' ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    {openDropdown === 'ratio' && (
                                                        <div className="absolute top-full left-0 mt-2 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-50 animate-in fade-in slide-in-from-top-2 p-1">
                                                            <div className="grid grid-cols-2 gap-1">
                                                                {['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'].map(ratio => (
                                                                    <button
                                                                        key={ratio}
                                                                        onClick={() => { setT2iRatio(ratio); setOpenDropdown(null); }}
                                                                        className={`px-3 py-2 text-sm text-center rounded-md transition-colors ${ratio === '1:1' ? 'col-span-2' : ''} ${t2iRatio === ratio ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 font-medium' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                                                    >
                                                                        {ratio}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Size Dropdown */}
                                                <div className="relative">
                                                    <button 
                                                        onClick={() => setOpenDropdown(openDropdown === 'size' ? null : 'size')}
                                                        className="flex items-center gap-2 px-3 h-9 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-white/5 shadow-sm text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                                    >
                                                        <span>Size: {t2iSize}</span>
                                                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openDropdown === 'size' ? 'rotate-180' : ''}`} />
                                                    </button>
                                                    {openDropdown === 'size' && (
                                                        <div className="absolute top-full left-0 mt-2 w-32 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-50 animate-in fade-in slide-in-from-top-2 p-1">
                                                            <div className="flex flex-col max-h-48 overflow-y-auto rounded-lg custom-scrollbar">
                                                                {['1K', '2K', '4K'].map(size => (
                                                                    <button
                                                                        key={size}
                                                                        onClick={() => { setT2iSize(size); setOpenDropdown(null); }}
                                                                        className={`px-3 py-2 text-sm text-left rounded-md transition-colors ${t2iSize === size ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 font-medium' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                                                    >
                                                                        {size}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <button 
                                                className="w-full sm:w-auto h-10 px-6 rounded-xl shadow-lg shadow-orange-900/20 shrink-0 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-none flex items-center justify-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                onClick={runTextToImage} 
                                                disabled={isGenerating || isUploading || !t2iPrompt.trim()}
                                            >
                                                {isGenerating || isUploading ? <Loader2 className="w-5 h-5 animate-spin"/> : <ArrowUp className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                            
                        {/* Progress Overlay for T2I - Pink spinning style */}
                        {(isGenerating || isUploading) && (
                            <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                                <div className="relative w-24 h-24">
                                    <Loader2 className="w-24 h-24 text-purple-500 animate-spin" />
                                    <Sparkles className="absolute inset-0 m-auto w-10 h-10 text-white animate-pulse" />
                                </div>
                                <p className="text-white font-semibold text-lg">
                                    {isUploading ? 'Uploading images...' : 'Generating your magic...'}
                                </p>
                                {isGenerating && (
                                    <div className="w-48 h-2 bg-white/20 rounded-full overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300" style={{ width: `${progress}%` }}/>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                ) : !hasSelectedImage ? (
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
                                <input type="file" accept="image/png, image/jpeg, image/webp" onChange={handleLocalUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
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

                            {/* 2. History */}
                            <div 
                                onClick={() => { setImagePickerTab('all'); setShowImagePicker(true); }} 
                                className="h-40 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10 hover:border-purple-500/50 hover:bg-purple-50/50 dark:hover:bg-purple-500/5 transition-all flex flex-col items-center justify-center text-center gap-3 cursor-pointer group"
                            >
                                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Clock className="w-6 h-6 text-slate-400 group-hover:text-purple-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">History</p>
                                    <p className="text-[10px] text-slate-500 mt-1">{generations.length} items</p>
                                </div>
                            </div>

                            {/* 3. Collections */}
                            <div 
                                onClick={() => { setImagePickerTab('collection'); setShowImagePicker(true); }} 
                                className="h-40 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10 hover:border-purple-500/50 hover:bg-purple-50/50 dark:hover:bg-purple-500/5 transition-all flex flex-col items-center justify-center text-center gap-3 cursor-pointer group"
                            >
                                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Heart className="w-6 h-6 text-slate-400 group-hover:text-purple-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Collections</p>
                                    <p className="text-[10px] text-slate-500 mt-1">{collections.length} collections</p>
                                </div>
                            </div>
                         </div>
                    </div>
                ) : (
                    // --- IMAGE SELECTED STATE ---
                    <>
                        {/* Toolbar */}
                        <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between">
                            <button 
                                onClick={handleChangeImage}
                                className="glass-panel px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-white hover:bg-white dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-white/10"
                            >
                                <Upload className="w-4 h-4" /> Change Image
                            </button>
                            <button 
                                onClick={handleDownload}
                                className="glass-panel px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-white hover:bg-white dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-white/10"
                            >
                                <Download className="w-4 h-4" /> Download
                            </button>
                        </div>

                        {/* Loading Overlay */}
                        {(isGenerating || isUploading) && (
                            <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                                <div className="relative w-24 h-24">
                                    <Loader2 className="w-24 h-24 text-purple-500 animate-spin" />
                                    <Sparkles className="absolute inset-0 m-auto w-10 h-10 text-white animate-pulse" />
                                </div>
                                <p className="text-white font-semibold text-lg">
                                    {isUploading ? 'Uploading image...' : 'Generating your magic...'}
                                </p>
                                {isGenerating && (
                                    <div className="w-48 h-2 bg-white/20 rounded-full overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300" style={{ width: `${progress}%` }}/>
                                    </div>
                                )}
                            </div>
                        )}

                        <img 
                            src={currentImage} 
                            className="max-w-full max-h-full object-contain shadow-2xl"
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
                        {selectedGroup ? 'Generation Group' : 'Generated Results'}
                        </h3>
                        <button onClick={() => { setShowResults(false); setSelectedGroup(null); }} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400 hover:text-slate-900 dark:hover:text-white" /></button>
                    </div>
                    {/* 显示 prompt */}
                    {selectedGroup && selectedGroup[0]?.prompt && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 truncate">{selectedGroup[0].prompt}</p>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {(selectedGroup || generatedResults.map((url, i) => ({ imageUrl: url, id: `res-${i}` }))).map((item, idx) => {
                            const imgUrl = typeof item === 'string' ? item : item.imageUrl;
                            return (
                                <div key={idx} className="space-y-2 group">
                                    <div className={`aspect-square rounded-xl overflow-hidden border-2 relative cursor-pointer transition-all ${currentImage === imgUrl ? 'border-purple-500 ring-2 ring-purple-500/20' : 'border-slate-200 dark:border-white/10 hover:border-purple-500/50'}`} onClick={() => setCurrentImage(imgUrl)}>
                                        <img src={imgUrl} className="w-full h-full object-cover transition-transform group-hover:scale-105" alt={`Result ${idx}`} />
                                    </div>
                                </div>
                            );
                        })}
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
                                            <p className="text-[10px] text-slate-400 mt-0.5">PNG, JPG, WebP • Max 10MB</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200 dark:border-white/10">
                                            <img src={URL.createObjectURL(uploadedFile)} className="w-full h-full object-cover" alt="upload" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{uploadedFile.name}</p>
                                            <p className="text-xs text-slate-500">{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB</p>
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
                                                    placeholder="e.g., a white serum bottle with gold cap"
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
                                disabled={isGenerating || isUploading || !uploadedFile}
                            >
                                {isGenerating || isUploading ? (
                                    <Loader2 className="w-4 h-4 animate-spin mr-2"/>
                                ) : (
                                    <Sparkles className="w-4 h-4 mr-2" />
                                )}
                                {isUploading ? 'Uploading...' : uploadedFile ? 'Generate Magic' : 'Upload product first'}
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
                            {/* Describe Changes */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-1.5">
                                    <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                        Describe the changes
                                    </label>
                                    <div className="relative group/tip">
                                        <svg className="w-3.5 h-3.5 text-amber-500 cursor-help" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/></svg>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all whitespace-nowrap z-50">Describe what you want to change</div>
                                    </div>
                                </div>
                                <textarea 
                                    value={modifyPrompt}
                                    onChange={(e) => setModifyPrompt(e.target.value)}
                                    placeholder="e.g., remove the necklace and earrings"
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 focus:outline-none resize-none h-20"
                                />
                            </div>

                            {/* Reference Image (Optional) */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-1.5">
                                    <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                        Reference image (optional)
                                    </label>
                                    <div className="relative group/tip">
                                        <svg className="w-3.5 h-3.5 text-amber-500 cursor-help" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/></svg>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all whitespace-nowrap z-50">Upload an image for AI to reference</div>
                                    </div>
                                </div>
                                <div className="border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl p-3 transition-colors hover:border-purple-500/30 hover:bg-white dark:hover:bg-white/5 relative group">
                                    <input 
                                        type="file" 
                                        onChange={(e) => {
                                            console.log('=== Reference image input onChange triggered ===');
                                            if (e.target.files && e.target.files[0]) {
                                                const file = e.target.files[0];
                                                console.log('File selected:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
                                                
                                                // 检查文件大小 (10MB)
                                                const maxSize = 10 * 1024 * 1024;
                                                if (file.size > maxSize) {
                                                    const errorMsg = `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB. Please compress your image first.`;
                                                    console.error('Validation failed:', errorMsg);
                                                    addToast('error', errorMsg);
                                                    e.target.value = ''; // 清空 input
                                                    return;
                                                }
                                                
                                                // 检查文件类型
                                                const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
                                                if (!validTypes.includes(file.type)) {
                                                    const errorMsg = 'Invalid file type. Please upload PNG, JPG, or WebP images only.';
                                                    console.error('Validation failed:', errorMsg);
                                                    addToast('error', errorMsg);
                                                    e.target.value = '';
                                                    return;
                                                }
                                                
                                                console.log('Validation passed, setting reference file');
                                                setModifyReferenceFile(file);
                                                addToast('success', 'Reference image uploaded successfully');
                                            }
                                        }} 
                                        className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                                        accept="image/png, image/jpeg, image/webp" 
                                    />
                                    {!modifyReferenceFile ? (
                                        <div className="flex flex-col items-center gap-2 py-3">
                                            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:bg-purple-500/10 transition-colors">
                                                <Upload className="w-5 h-5 text-slate-400 group-hover:text-purple-400" />
                                            </div>
                                            <div className="text-center">
                                                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Click to upload reference</p>
                                                <p className="text-[10px] text-slate-400 mt-0.5">PNG, JPG, WebP • Max 10MB</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200 dark:border-white/10">
                                                <img src={URL.createObjectURL(modifyReferenceFile)} className="w-full h-full object-cover" alt="reference" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{modifyReferenceFile.name}</p>
                                                <p className="text-xs text-slate-500">{(modifyReferenceFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                            </div>
                                            <button 
                                                onClick={(e) => { e.preventDefault(); setModifyReferenceFile(null); }} 
                                                className="p-2 hover:bg-red-500/10 rounded-full z-20 group/del"
                                            >
                                                <Trash2 className="w-4 h-4 text-slate-500 group-hover/del:text-red-400"/>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <ImageCountSelector />
                            <Button size="sm" variant="gradient" className="w-full" disabled={isGenerating || isUploading || !modifyPrompt.trim()} onClick={() => runGeneration('Modify', modifyPrompt)}>
                                {isGenerating || isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Sparkles className="w-4 h-4 mr-2" />}
                                {isUploading ? 'Uploading...' : 'Generate Changes'}
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
                            {/* Ratio Selector */}
                            <div className="space-y-2">
                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Target aspect ratio</label>
                                <div className="grid grid-cols-7 gap-2">
                                    {ratioOptions.map(r => (
                                        <button 
                                            key={r.label} 
                                            onClick={() => setSelectedRatio(r.name)} 
                                            className="flex flex-col items-center gap-1.5 group"
                                        >
                                            <div className="h-10 flex items-end justify-center">
                                                <div 
                                                    style={{ width: r.width, height: r.height }}
                                                    className={`border-2 rounded transition-all duration-300 ${selectedRatio === r.name ? 'border-transparent bg-gradient-to-br from-purple-500 to-pink-500' : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 group-hover:border-pink-500'}`}
                                                />
                                            </div>
                                            <span className={`text-[10px] font-medium ${selectedRatio === r.name ? 'text-pink-500 dark:text-pink-400' : 'text-slate-500 dark:text-slate-400'}`}>{r.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Expanded Area Description */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-1.5">
                                    <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                        Describe expanded area
                                    </label>
                                    <span className="text-xs text-slate-400">(optional)</span>
                                    <div className="relative group/tip">
                                        <svg className="w-3.5 h-3.5 text-amber-500 cursor-help" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/></svg>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all whitespace-nowrap z-50">Tell AI what to fill in the new areas</div>
                                    </div>
                                </div>
                                <textarea 
                                    value={ratioPrompt}
                                    onChange={(e) => setRatioPrompt(e.target.value)}
                                    placeholder="Continue the same background style, blue sky with clouds, wooden floor extending..."
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 focus:outline-none resize-none h-20"
                                />
                            </div>

                            <ImageCountSelector />
                            <Button size="sm" variant="gradient" className="w-full" disabled={isGenerating || isUploading} onClick={() => runGeneration('Ratio', selectedRatio)}>
                                {isGenerating || isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Sparkles className="w-4 h-4 mr-2" />}
                                Update Ratio
                            </Button>
                        </div>
                    )}
                </div>

                {/* 4. ENHANCE / UPSCALE Tool */}
                <div className={`glass-panel rounded-2xl transition-all duration-300 ${activeTool === 'enhance' ? 'ring-1 ring-pink-500/50 bg-white dark:bg-slate-800/50' : ''}`}>
                    <button 
                        disabled={!hasSelectedImage}
                        onClick={() => setActiveTool(activeTool === 'enhance' ? null : 'enhance')}
                        className="w-full p-4 flex items-center justify-between text-left disabled:opacity-50"
                    >
                        <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                            <Wand2 className="w-5 h-5 text-pink-500 dark:text-pink-400" /> 
                            Upscale
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${activeTool === 'enhance' ? 'rotate-180' : ''}`}/>
                    </button>
                    {activeTool === 'enhance' && (
                        <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2">
                            {/* Resolution Selector */}
                            <div className="space-y-2">
                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Target Resolution</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {(() => {
                                        const isProUser = user?.plan === 'Pro' || user?.plan === 'Enterprise';
                                        return [
                                            { label: '1K', size: '1024×1024', value: '1K' },
                                            { label: '2K', size: '2048×2048', value: '2K' },
                                            { label: '4K', size: '4096×4096', value: '4K', isPro: true },
                                        ].map(res => {
                                            const isLocked = res.isPro && !isProUser;
                                            return (
                                                <button
                                                    key={res.value}
                                                    onClick={() => {
                                                        if (isLocked) {
                                                            addToast('error', '4K resolution requires Pro plan');
                                                            return;
                                                        }
                                                        setSelectedResolution(res.value);
                                                    }}
                                                    className={`relative py-2.5 text-xs font-medium rounded-lg border transition-all ${
                                                        isLocked
                                                            ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-white/5 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60'
                                                            : selectedResolution === res.value
                                                                ? 'bg-pink-600 border-pink-500 text-white shadow-lg shadow-pink-900/20'
                                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                                                    }`}
                                                >
                                                    <div>{res.label}</div>
                                                    <div className={`text-[9px] ${
                                                        isLocked
                                                            ? 'text-slate-400 dark:text-slate-500'
                                                            : selectedResolution === res.value 
                                                                ? 'text-pink-200' 
                                                                : 'text-slate-400'
                                                    }`}>
                                                        {res.size}
                                                    </div>
                                                    {res.isPro && (
                                                        <div className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded text-[7px] font-bold text-white ${
                                                            isLocked 
                                                                ? 'bg-slate-400 dark:bg-slate-600' 
                                                                : 'bg-gradient-to-r from-purple-600 to-pink-600'
                                                        }`}>
                                                            PRO
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                        });
                                    })()}
                                </div>
                                <p className="text-[10px] text-slate-400">
                                    {user?.plan === 'Pro' || user?.plan === 'Enterprise' 
                                        ? 'Max: 4096×4096 (4K)' 
                                        : 'Max: 2048×2048 (2K) · Upgrade to Pro for 4K'}
                                </p>
                            </div>

                            <ImageCountSelector />
                            <Button size="sm" variant="gradient" className="w-full" disabled={isGenerating || isUploading} onClick={() => runGeneration('Upscale', selectedResolution)}>
                                {isGenerating || isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Sparkles className="w-4 h-4 mr-2" />}
                                Upscale to {selectedResolution}
                            </Button>
                        </div>
                    )}
                </div>

                {/* 5. TEXT TO IMAGE Tool */}
                <div className={`glass-panel rounded-2xl transition-all duration-300 ${activeTool === 'text2img' ? 'ring-1 ring-orange-500/50 bg-white dark:bg-slate-800/50' : ''}`}>
                    <button 
                        onClick={() => {
                            setActiveTool(activeTool === 'text2img' ? null : 'text2img');
                            if (activeTool !== 'text2img') {
                                setT2iOutputCount(4); // Default to 4 when activating
                            }
                        }}
                        className="w-full p-4 flex items-center justify-between text-left"
                    >
                        <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                            <Type className="w-5 h-5 text-orange-500 dark:text-orange-400" /> 
                            Text to Image
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${activeTool === 'text2img' ? 'rotate-180' : ''}`}/>
                    </button>
                    {activeTool === 'text2img' && (
                        <div className="px-4 pb-4 space-y-3 animate-in slide-in-from-top-2">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Describe what you want to create. Add reference images if needed.
                            </p>
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
                onClick={() => setImagePickerTab('upload')}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                imagePickerTab === 'upload'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
                Upload
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
                onClick={() => { 
                  setShowImagePicker(false); 
                  setActiveTool('text2img');
                }}
                className="flex-1 py-2 text-xs font-medium rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
                Text to Image
            </button>
            </div>

            {/* Tab Content */}
            {imagePickerTab === 'all' && (
            <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar p-1">
                {generations.length > 0 ? (
                [...generations].sort((a, b) => b.createdAt - a.createdAt).map((gen) => {
                    const isModify = gen.templateId === MODIFY_SESSION_ID;
                    const isT2I = gen.templateId === 'text-to-image';
                    return (
                    <div
                        key={gen.id}
                        onClick={() => handleImagePickerHistoryClick(gen)}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all group ${
                        currentImage === gen.imageUrl
                            ? 'border-purple-500 ring-2 ring-purple-500/20'
                            : 'border-transparent hover:border-purple-500'
                        }`}
                    >
                        <img src={gen.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                        {/* Only show badge for Upload and Text to Image, not for templates */}
                        {(isModify || isT2I) && (
                        <div className={`absolute top-1 left-1 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                            isT2I
                            ? 'bg-pink-600/80 text-white border-pink-400/30'
                            : 'bg-purple-600/80 text-white border-purple-400/30'
                        }`}>
                            {isT2I ? 'Text to Image' : 'Upload'}
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
                                    const template = templatesCache.get(templateId);
                                    if (!template) {
                                      return (
                                        <div key={templateId} className="aspect-square rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
                                      );
                                    }
                                    
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
                    accept="image/png, image/jpeg, image/webp"
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