import React, { useState, useRef, useEffect } from 'react';
import { 
  Settings, ChevronDown, History, ArrowRightLeft, ImagePlus, 
  Image as ImageIcon, RefreshCw, Sparkles 
} from 'lucide-react';
import { VideoResult } from '../../utils/video';
import { generateVideo } from '../../utils/generateService';
import { supabase } from '../../utils/supabase';

interface ImageToVideoProps {
  onGenerate: (result: VideoResult) => void;
  initialImage: string | null;
}

export const ImageToVideo: React.FC<ImageToVideoProps> = ({ onGenerate, initialImage }) => {
  const [prompt, setPrompt] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(initialImage);
  const [selectedEndImage, setSelectedEndImage] = useState<string | null>(null);
  const [resolution, setResolution] = useState<'720p' | '1080p'>('1080p');
  const [duration, setDuration] = useState<number>(3);
  const [generationCount, setGenerationCount] = useState<number>(1);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endFileInputRef = useRef<HTMLInputElement>(null);
  const [startImageFile, setStartImageFile] = useState<File | null>(null);
  const [endImageFile, setEndImageFile] = useState<File | null>(null);

  useEffect(() => {
    if (initialImage) {
      setSelectedImage(initialImage);
    }
  }, [initialImage]);

  const handleGenerate = async () => {
    if (!selectedImage) {
      alert("Please upload a first frame image.");
      return;
    }
    if (!prompt) {
      alert("Please enter a prompt.");
      return;
    }
    
    setIsGenerating(true);
    
    try {
      // Step 1: Upload image(s) to Supabase Storage to get public URL
      let startImageUrl = selectedImage;
      let endImageUrl: string | undefined;

      // If it's a blob URL, we need to upload the file
      if (startImageFile && selectedImage.startsWith('blob:')) {
        const timestamp = Date.now();
        const filePath = `video-inputs/${timestamp}-start.${startImageFile.name.split('.').pop()}`;
        const { error: uploadError } = await supabase.storage
          .from('generations')
          .upload(filePath, startImageFile, { contentType: startImageFile.type });
        
        if (uploadError) {
          alert('Failed to upload image. Please try again.');
          console.error('Upload error:', uploadError);
          return;
        }
        
        const { data: urlData } = supabase.storage
          .from('generations')
          .getPublicUrl(filePath);
        startImageUrl = urlData.publicUrl;
      }

      if (endImageFile && selectedEndImage?.startsWith('blob:')) {
        const timestamp = Date.now();
        const filePath = `video-inputs/${timestamp}-end.${endImageFile.name.split('.').pop()}`;
        const { error: uploadError } = await supabase.storage
          .from('generations')
          .upload(filePath, endImageFile, { contentType: endImageFile.type });
        
        if (uploadError) {
          console.error('End frame upload error:', uploadError);
          // Non-critical, continue without end frame
        } else {
          const { data: urlData } = supabase.storage
            .from('generations')
            .getPublicUrl(filePath);
          endImageUrl = urlData.publicUrl;
        }
      }

      // Step 2: Call real API
      const result = await generateVideo({
        mode: 'image_to_video',
        prompt,
        startImageUrl,
        endImageUrl,
        duration,
        resolution,
      });

      if (!result.success || !result.videoUrl) {
        alert(result.error || 'Video generation failed. Please try again.');
        return;
      }

      // Step 3: Create result for feed
      const newResult: VideoResult = {
        id: `gen-${Date.now()}`,
        type: 'Image to Video',
        model: 'Kling 3.0',
        resolution: resolution,
        prompt: prompt,
        duration: `00:${(result.duration || duration).toString().padStart(2, '0')}`,
        aspectRatio: '16:9',
        timestamp: 'Just now',
        bgColor: 'bg-slate-900/50',
        videoUrl: result.videoUrl,
        sourceImage: startImageUrl
      };
      
      onGenerate(newResult);
    } catch (error) {
      console.error('Video generation error:', error);
      alert('Video generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEndFrame = false) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      if (isEndFrame) {
        setSelectedEndImage(url);
        setEndImageFile(file);
      } else {
        setSelectedImage(url);
        setStartImageFile(file);
      }
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
        {/* Source Media Zone */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Source Media</label>
          </div>
          
          <div className="flex items-center gap-3">
            {/* First Frame */}
            <div 
              className="group relative flex h-32 flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800 transition-all"
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedImage ? (
                <img src={selectedImage} alt="First frame" className="h-full w-full object-cover" />
              ) : (
                <>
                  <ImagePlus className="mb-2 h-6 w-6 text-slate-400 group-hover:text-purple-500 transition-colors" />
                  <span className="text-xs font-medium text-slate-500">First frame</span>
                </>
              )}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={(e) => handleImageUpload(e, false)} 
                className="hidden" 
                accept="image/*" 
              />
            </div>

            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 shadow-sm shrink-0">
              <ArrowRightLeft className="h-4 w-4 text-slate-400" />
            </div>

            {/* End Frame */}
            <div 
              className="group relative flex h-32 flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800 transition-all"
              onClick={() => endFileInputRef.current?.click()}
            >
              {selectedEndImage ? (
                <img src={selectedEndImage} alt="End frame" className="h-full w-full object-cover" />
              ) : (
                <>
                  <ImageIcon className="mb-2 h-6 w-6 text-slate-400 group-hover:text-purple-500 transition-colors" />
                  <span className="text-xs font-medium text-slate-500">End frame (opt)</span>
                </>
              )}
              <input 
                type="file" 
                ref={endFileInputRef} 
                onChange={(e) => handleImageUpload(e, true)} 
                className="hidden" 
                accept="image/*" 
              />
            </div>
          </div>
        </div>

        {/* Prompt Zone */}
        <div className="space-y-2">
          <label className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Prompt</label>
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the video you want to generate. Be specific about camera movement, lighting, and action..."
              className="min-h-[120px] w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 text-sm outline-none placeholder:text-slate-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 dark:focus:border-purple-500"
            />
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="relative z-50 w-full shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-4 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.2)]">
        {/* Folded Parameters Panel */}
        {isParamsOpen && (
          <div className="absolute bottom-[calc(100%+8px)] left-4 w-[calc(100%-32px)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-2xl">
            <div className="mb-4 flex flex-col gap-5">
              {/* Resolution */}
              <div>
                <label className="mb-2 block text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Resolution</label>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 p-0.5 dark:bg-slate-800/50">
                  {['720p', '1080p'].map((res) => (
                    <button
                      key={res}
                      onClick={() => setResolution(res as any)}
                      className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        resolution === res 
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' 
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {res}
                      {res !== '720p' && (
                        <span className="absolute -top-1.5 -right-1.5 rounded bg-gradient-to-r from-pink-400 to-purple-500 px-1 text-[8px] font-bold text-white shadow-sm">PRO</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration Slider */}
              <div>
                <label className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
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
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 dark:bg-slate-700 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
                  />
                  <span className="text-xs font-medium text-slate-400">15s</span>
                </div>
              </div>

              {/* Generation Count */}
              <div>
                <label className="mb-2 block text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">Generation Count</label>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 p-0.5 dark:bg-slate-800/50">
                  {[1, 2, 3, 4].map((count) => (
                    <button
                      key={count}
                      onClick={() => setGenerationCount(count)}
                      className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        generationCount === count 
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' 
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {count}
                      {count > 1 && (
                        <span className="absolute -top-1.5 -right-1.5 rounded bg-gradient-to-r from-pink-400 to-purple-500 px-1 text-[8px] font-bold text-white shadow-sm">PRO</span>
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
            className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Settings className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {resolution} · {duration}s · {generationCount}
            </span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isParamsOpen ? 'rotate-180' : ''}`} />
          </button>
          <button 
            onClick={handleGenerate}
            disabled={isGenerating || !selectedImage}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-4 text-sm font-semibold text-white shadow-md hover:from-purple-700 hover:to-pink-700 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-white" />
                <span>Generating...</span>
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
