import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutGrid, Clock, FolderHeart, Settings as SettingsIcon, Download, Trash2, Maximize2, X, Edit, Crown, Zap, Image as ImageIcon, TrendingUp, Plus, ArrowLeft, ExternalLink, Search, Layers, Loader2, Film, PlayCircle } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { isSupabaseConfigured } from '../config/env';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Generation, Collection, Template } from '../types';
import { supabase } from '../utils/supabase';
import { ensureGenerationThumbnail } from '../utils/generationThumbnail';
import {
  deleteCreatorTemplate,
  fetchCreatorTemplates,
  type CreatorTemplateCard,
} from '../utils/templateDashboardApi';

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

const isVideoGeneration = (gen: Generation): boolean => gen.mediaType === 'video' || Boolean(gen.videoUrl);

const getGenerationDisplayName = (gen: Generation): string => {
  if (isVideoGeneration(gen)) {
    if (gen.videoMode === 'lip_sync') return 'Lip Sync Video';
    if (gen.videoMode === 'motion_control') return 'Motion Control Video';
    if (gen.videoMode === 'image_to_video') return 'Image to Video';
    return gen.templateName || 'Video Generation';
  }
  if (gen.templateId === 'modify-session') return 'User Upload (Modify)';
  if (gen.templateId === 'text-to-image') return 'Text to Image';
  return gen.templateName || 'Image Generation';
};

const formatGenerationDuration = (seconds?: number) => {
  if (!seconds) return null;
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export const Dashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    user, 
    generations, 
    deleteGeneration, 
    addToast, 
    collections, 
    createCollection, 
    deleteCollection, 
    removeFromCollection,
    // New: loading states for pagination
    loadingGenerations,
    hasMoreGenerations,
    loadMoreGenerations,
    refreshGenerations
  } = useStore();
  
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'collections' | 'templates'>('overview');

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab && ['overview', 'history', 'collections', 'templates'].includes(tab)) {
      setActiveTab(tab as 'overview' | 'history' | 'collections' | 'templates');
    }
  }, [location.search]);
  const [selectedImage, setSelectedImage] = useState<Generation | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Generation[] | null>(null);
  const [generatedThumbnails, setGeneratedThumbnails] = useState<Record<string, string>>({});
  const generatedThumbnailsRef = useRef<Record<string, string>>({});
  const attemptedThumbnailsRef = useRef<Set<string>>(new Set());
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const queue = generations.filter((generation) => (
      !generation.thumbnailUrl &&
      !generatedThumbnailsRef.current[generation.id] &&
      !attemptedThumbnailsRef.current.has(generation.id) &&
      !generation.id.startsWith('session_')
    ));
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < queue.length) {
        const generation = queue[cursor++];
        attemptedThumbnailsRef.current.add(generation.id);
        const thumbnailUrl = await ensureGenerationThumbnail(generation);
        if (cancelled) continue;
        if (!thumbnailUrl) {
          setFailedThumbnails((current) => {
            const next = new Set(current);
            next.add(generation.id);
            return next;
          });
          continue;
        }
        generatedThumbnailsRef.current[generation.id] = thumbnailUrl;
        setGeneratedThumbnails((current) => ({ ...current, [generation.id]: thumbnailUrl }));
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      cancelled = true;
    };
  }, [generations]);

  const [myTemplates, setMyTemplates] = useState<CreatorTemplateCard[]>([]);
  const [loadingMyTemplates, setLoadingMyTemplates] = useState(false);
  const [myTemplatesError, setMyTemplatesError] = useState<string | null>(null);
  const [failedTemplateCovers, setFailedTemplateCovers] = useState<Set<string>>(new Set());
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState('');
  const [currentFeedbackTemplateId, setCurrentFeedbackTemplateId] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<CreatorTemplateCard | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState(false);

  const loadMyTemplates = useCallback(async () => {
    if (!user) return;
    setLoadingMyTemplates(true);
    setMyTemplatesError(null);
    try {
      setMyTemplates(await fetchCreatorTemplates(user.id));
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Could not load your templates.';
      setMyTemplatesError(message);
      addToast('error', message);
    } finally {
      setLoadingMyTemplates(false);
    }
  }, [user, addToast]);

  useEffect(() => {
    if (activeTab === 'templates' && user) void loadMyTemplates();
  }, [activeTab, user, loadMyTemplates]);

  // Filter and Search State
  const [sourceFilter, setSourceFilter] = useState<'all' | 'templates' | 'modify' | 'generated' | 'video'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Collections State
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  // 🔧 FIX: 添加防重复创建的状态
  const [isCreatingInProgress, setIsCreatingInProgress] = useState(false);

  // Delete State
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Infinite scroll ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // 🔧 FIX: 使用 useRef 存储 templates cache，避免无限循环
  // 原来用 useState 会导致每次更新 cache 都触发重新渲染和 useEffect
  const templatesCacheRef = useRef<Map<string, Template>>(new Map());
  const [templatesVersion, setTemplatesVersion] = useState(0); // 用于触发 UI 更新
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  
  // 🔧 FIX: 追踪正在获取的 template IDs，防止重复请求
  const fetchingIdsRef = useRef<Set<string>>(new Set());

  // 🔧 FIX: 重写 fetchTemplatesForCollection，移除对 cache 的依赖
  const fetchTemplatesForCollection = useCallback(async (templateIds: string[]) => {
    if (templateIds.length === 0) return;
    if (!isSupabaseConfigured()) return;
    
    // 过滤掉已缓存的和正在获取的
    const uncachedIds = templateIds.filter(id => 
      !templatesCacheRef.current.has(id) && !fetchingIdsRef.current.has(id)
    );
    
    if (uncachedIds.length === 0) return;
    
    // 标记这些 ID 正在获取中
    uncachedIds.forEach(id => fetchingIdsRef.current.add(id));
    
    setLoadingTemplates(true);
    try {
      const { data, error } = await supabase
        .from('templates')
        .select('*')
        .in('id', uncachedIds);
      
      if (error) {
        console.error('Error fetching templates:', error);
      } else if (data) {
        // 更新 ref（不会触发重新渲染）
        data.forEach(t => {
          templatesCacheRef.current.set(t.id, {
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
        // 触发一次 UI 更新
        setTemplatesVersion(v => v + 1);
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      // 清除正在获取的标记
      uncachedIds.forEach(id => fetchingIdsRef.current.delete(id));
      setLoadingTemplates(false);
    }
  }, []); // 🔧 FIX: 空依赖数组，函数引用不会变化

  // 🔧 FIX: 简化 useEffect，移除 fetchTemplatesForCollection 依赖
  useEffect(() => {
    if (activeTab === 'collections') {
      // Get all template IDs from all collections
      const allTemplateIds = collections.flatMap(c => c.imageIds);
      if (allTemplateIds.length > 0) {
        fetchTemplatesForCollection(allTemplateIds);
      }
    }
  }, [activeTab, collections]); // 🔧 FIX: 移除 fetchTemplatesForCollection 依赖

  // Infinite scroll observer
useEffect(() => {
  if (activeTab !== 'history') return;
  
  const observer = new IntersectionObserver(
    (entries) => {
      // 🔧 FIX: 只有当已有数据时才触发加载更多
      if (entries[0].isIntersecting && hasMoreGenerations && !loadingGenerations && generations.length > 0) {
        loadMoreGenerations();
      }
    },
    { threshold: 0.1 }
  );
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [activeTab, hasMoreGenerations, loadingGenerations, loadMoreGenerations]);

  // Refresh generations when switching to history tab
useEffect(() => {
  if (activeTab === 'history' && generations.length === 0 && !loadingGenerations) {
    refreshGenerations();
  }
}, [activeTab, loadingGenerations]);

  // Overview Data (Sorted by newest)
  const recentGenerations = useMemo(() => {
    return [...generations].sort((a, b) => b.createdAt - a.createdAt);
  }, [generations]);

  // History Data (Filtered & Sorted)
  const filteredGenerations = useMemo(() => {
    let filtered = [...generations];
    
    // Apply source filter
    if (sourceFilter === 'video') {
      filtered = filtered.filter(isVideoGeneration);
    } else if (sourceFilter === 'modify') {
      filtered = filtered.filter(g => !isVideoGeneration(g) && g.templateId === 'modify-session');
    } else if (sourceFilter === 'templates') {
      filtered = filtered.filter(g => !isVideoGeneration(g) && g.templateId !== 'modify-session' && g.templateId !== 'text-to-image');
    } else if (sourceFilter === 'generated') {
      filtered = filtered.filter(g => !isVideoGeneration(g) && g.templateId === 'text-to-image');
    }
    
    // Apply search filter (search by name, mode, or prompt)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(g => {
        const searchable = [
          getGenerationDisplayName(g),
          g.templateName || '',
          g.prompt || '',
          g.videoMode || '',
          isVideoGeneration(g) ? 'video' : 'image',
        ].join(' ').toLowerCase();
        return searchable.includes(query);
      });
    }
    
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [generations, sourceFilter, searchQuery]);

  if (!user) {
    navigate('/login');
    return null;
  }

  const handleDelete = (id: string) => {
    setItemToDelete(id);
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      setIsDeleting(true);
      await deleteGeneration(itemToDelete);
      // If the deleted image was open in lightbox, close it
      if (selectedImage?.id === itemToDelete) {
        setSelectedImage(null);
      }
      setItemToDelete(null);
      setIsDeleting(false);
    }
  };

  // 🔧 FIX: 添加防重复创建逻辑
  const handleCreateCollection = async () => {
     if (newCollectionName.trim() && !isCreatingInProgress) {
         setIsCreatingInProgress(true);  // 开始创建，禁用按钮
         try {
           await createCollection(newCollectionName.trim());
           setIsCreatingCollection(false);
           setNewCollectionName('');
         } catch (error) {
           console.error('Failed to create collection:', error);
           addToast('error', 'Failed to create collection');
         } finally {
           setIsCreatingInProgress(false);  // 创建完成，恢复按钮
         }
     }
  };

  const activeCollection = collections.find(c => c.id === activeCollectionId);

  // 🔧 FIX: 使用 ref 获取 cache 数据
  const getCollectionItems = (col: Collection): Template[] => {
      return col.imageIds
        .map(id => templatesCacheRef.current.get(id))
        .filter((t): t is Template => t !== undefined);
  };

  // Helper to direct user to correct editing environment
  const navigateToEdit = (gen: Generation) => {
    if (isVideoGeneration(gen)) {
      navigate('/video', {
        state: gen.imageUrl ? { initialImage: gen.imageUrl } : undefined,
      });
      return;
    }

    navigate('/modify', {
      state: {
        initialImage: gen.imageUrl,
        initialImageSource: { 
          templateId: gen.templateId, 
          templateName: gen.templateName || 'Image' 
        }
      }
    });
  };

  const renderGenerationMedia = (
    gen: Generation,
    className: string,
    controls = false,
    fullResolution = false,
  ) => {
    const thumbnailUrl = generatedThumbnails[gen.id] || gen.thumbnailUrl || '';
    if (isVideoGeneration(gen) && gen.videoUrl) {
      if (!controls) {
        return thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            className={className}
            loading="lazy"
            decoding="async"
            alt={getGenerationDisplayName(gen)}
          />
        ) : (
          <div className={`${className} flex items-center justify-center bg-slate-100 dark:bg-slate-800`}>
            {failedThumbnails.has(gen.id) ? (
              <Film className="w-8 h-8 text-slate-400 dark:text-slate-500" />
            ) : (
              <Loader2 className="w-7 h-7 animate-spin text-slate-300 dark:text-slate-600" />
            )}
          </div>
        );
      }
      return (
        <video
          src={gen.videoUrl}
          className={className}
          controls={controls}
          muted={!controls}
          playsInline
          preload="metadata"
          poster={thumbnailUrl || (gen.imageUrl && gen.imageUrl !== gen.videoUrl ? gen.imageUrl : undefined)}
        />
      );
    }

    const displayUrl = fullResolution ? gen.imageUrl : (thumbnailUrl || gen.imageUrl);
    if (!displayUrl) {
      return (
        <div className={`${className} flex items-center justify-center bg-slate-100 dark:bg-slate-800`}>
          {failedThumbnails.has(gen.id) ? (
            <ImageIcon className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          ) : (
            <Loader2 className="w-7 h-7 animate-spin text-slate-300 dark:text-slate-600" />
          )}
        </div>
      );
    }
    return (
      <img
        src={displayUrl}
        className={className}
        loading="lazy"
        decoding="async"
        alt={getGenerationDisplayName(gen)}
      />
    );
  };

  // Reusable Grid Item Component
  const GenerationCard: React.FC<{ gen: Generation; aspect?: string; onClick: () => void }> = ({ gen, aspect = "aspect-square", onClick }) => {
    const isVideo = isVideoGeneration(gen);

    return (
      <div 
          className={`group relative rounded-xl overflow-hidden cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/5 hover:border-purple-500/50 transition-all shadow-sm hover:shadow-xl hover:shadow-purple-900/20 ${aspect}`} 
          onClick={onClick}
      >
          {renderGenerationMedia(gen, 'w-full h-full object-cover transition-transform duration-700 group-hover:scale-110')}

          {isVideo && (
            <>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="rounded-full bg-black/45 p-3 text-white backdrop-blur-sm border border-white/15">
                  <PlayCircle className="w-8 h-8" />
                </div>
              </div>
              <div className="absolute top-2 left-2 z-20 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm flex items-center gap-1">
                <Film className="w-3 h-3" /> Video
              </div>
            </>
          )}

          {/* Hover Overlay with Actions */}
          <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-3 backdrop-blur-[2px] z-30">
              <Button size="sm" variant="gradient" onClick={(e) => { e.stopPropagation(); isVideo ? setSelectedImage(gen) : navigateToEdit(gen); }}>
                  {isVideo ? <PlayCircle className="w-3 h-3 mr-2" /> : <Edit className="w-3 h-3 mr-2" />} {isVideo ? 'Open Video' : 'Edit in Studio'}
              </Button>
              <div className="flex gap-2">
                  <button 
                    className="p-2 rounded-full bg-white/10 hover:bg-white text-white hover:text-black transition-all border border-white/10" 
                    onClick={(e) => { e.stopPropagation(); setSelectedImage(gen); }} 
                    title="View Details"
                  >
                      <Maximize2 className="w-4 h-4" />
                  </button>
                  <button 
                    className="p-2 rounded-full bg-white/10 hover:bg-red-500 text-white transition-all border border-white/10" 
                    onClick={(e) => { e.stopPropagation(); handleDelete(gen.id); }} 
                    title="Delete"
                  >
                      <Trash2 className="w-4 h-4" />
                  </button>
              </div>
          </div>

          {/* Bottom Info Bar */}
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent opacity-100 z-20 pointer-events-none">
              <div className="flex justify-between items-end gap-2">
                  <div className="min-w-0">
                     <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mb-0.5">{isVideo ? 'Video' : 'Created'}</p>
                     <p className="text-xs text-slate-200 font-medium truncate">{isVideo ? getGenerationDisplayName(gen) : new Date(gen.createdAt).toLocaleDateString()}</p>
                  </div>
                  {isVideo && gen.videoDuration && (
                    <span className="text-[10px] text-slate-200 bg-black/40 px-1.5 py-0.5 rounded">{formatGenerationDuration(gen.videoDuration)}</span>
                  )}
              </div>
          </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen pt-16 flex bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      {/* Sidebar */}
      <div className="w-64 fixed left-0 top-16 bottom-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-white/5 hidden md:flex flex-col p-4 transition-colors duration-300">
        <div className="space-y-1">
           {[
             { id: 'overview', icon: LayoutGrid, label: 'Overview' },
             { id: 'history', icon: Clock, label: 'History' },
             { id: 'collections', icon: FolderHeart, label: 'Collections' },
             { id: 'templates', icon: Layers, label: 'My Templates' },
           ].map(item => (
             <button
              key={item.id}
              onClick={() => { setActiveTab(item.id as any); setActiveCollectionId(null); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === item.id 
                  ? 'bg-slate-100 dark:bg-white text-slate-900 dark:text-slate-900 shadow-sm' 
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
              }`}
             >
               <item.icon className="w-4 h-4" />
               {item.label}
             </button>
           ))}
        </div>
        
        <div className="mt-auto">
           <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-all">
             <SettingsIcon className="w-4 h-4" /> Settings
           </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 md:ml-64 p-6 md:p-10">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 capitalize flex items-center gap-3">
            {activeCollectionId && activeTab === 'collections' ? (
                <>
                    <button onClick={() => setActiveCollectionId(null)} className="p-1 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full transition-colors">
                        <ArrowLeft className="w-6 h-6" />
                    </button>
                    {activeCollection?.name}
                </>
            ) : (
                activeTab
            )}
        </h2>

        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               {/* Plan Card */}
               <div 
               onClick={() => navigate('/subscription')}
                className="relative overflow-hidden group p-6 rounded-2xl border border-slate-200 dark:border-white/10 bg-gradient-to-br from-purple-50 to-white dark:from-purple-500/10 dark:via-slate-900/50 dark:to-slate-900 backdrop-blur-xl transition-all hover:border-purple-500/30 cursor-pointer"
                  >
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-2.5 bg-purple-100 dark:bg-purple-500/10 rounded-xl border border-purple-200 dark:border-purple-500/20">
                        <Crown className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                      </div>
                      <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-200 dark:border-purple-500/20">Active</span>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Current Plan</p>
                      <h3 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{user.plan}</h3>
                    </div>
                  </div>
                  <div className="absolute -right-6 -top-6 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl" />
               </div>

               {/* Credits Card */}
               <div className="relative overflow-hidden group p-6 rounded-2xl border border-slate-200 dark:border-white/10 bg-gradient-to-br from-blue-50 to-white dark:from-blue-500/10 dark:via-slate-900/50 dark:to-slate-900 backdrop-blur-xl transition-all hover:border-blue-500/30">
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-2.5 bg-blue-100 dark:bg-blue-500/10 rounded-xl border border-blue-200 dark:border-blue-500/20">
                        <Zap className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                      </div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50 px-2 py-1 rounded-lg border border-slate-200 dark:border-white/5">
                        {Math.round((user.credits / user.maxCredits) * 100)}% Left
                      </span>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Credits Remaining</p>
                      <div className="flex items-baseline gap-2">
                         <h3 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{user.credits}</h3>
                         <span className="text-sm text-slate-500 dark:text-slate-500 font-medium">/ {user.maxCredits}</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mt-4 overflow-hidden border border-slate-300 dark:border-white/5">
                         <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full" style={{ width: `${(user.credits / user.maxCredits) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                   <div className="absolute -right-6 -top-6 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
               </div>

               {/* Stats Card */}
               <div className="relative overflow-hidden group p-6 rounded-2xl border border-slate-200 dark:border-white/10 bg-gradient-to-br from-pink-50 to-white dark:from-pink-500/10 dark:via-slate-900/50 dark:to-slate-900 backdrop-blur-xl transition-all hover:border-pink-500/30">
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-2.5 bg-pink-100 dark:bg-pink-500/10 rounded-xl border border-pink-200 dark:border-pink-500/20">
                        <ImageIcon className="w-6 h-6 text-pink-600 dark:text-pink-400" />
                      </div>
                      <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium bg-emerald-100 dark:bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-500/20">
                         <TrendingUp className="w-3 h-3" /> +12 this week
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Total Creations</p>
                      <h3 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{generations.length}</h3>
                    </div>
                  </div>
                  <div className="absolute -right-6 -top-6 w-32 h-32 bg-pink-500/10 rounded-full blur-3xl" />
               </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Recent Generations</h3>
                 <button onClick={() => setActiveTab('history')} className="text-sm text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-300">View All</button>
              </div>
              
              {loadingGenerations && generations.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
              ) : recentGenerations.length === 0 ? (
                <div className="text-center py-16 glass-panel rounded-2xl border-dashed border-slate-300 dark:border-white/20 bg-white dark:bg-slate-900/20">
                  <p className="text-slate-500 mb-4">No generations yet.</p>
                  <Button variant="ghost" className="text-purple-500 dark:text-purple-400" onClick={() => navigate('/')}>Start Creating</Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                   {/* Show top 8 recent items (grouped) */}
                   {groupGenerations(recentGenerations).slice(0, 8).map((item, idx) => {
                     if (Array.isArray(item)) {
                       const group = item;
                       return (
                         <div 
                           key={`overview_group_${idx}`}
                           onClick={() => { setSelectedGroup(group); setSelectedImage(group[0]); }}
                           className="relative aspect-square cursor-pointer group"
                         >
                           <div className="absolute inset-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transform translate-y-1.5 translate-x-1.5 opacity-60"></div>
                           <div className="absolute inset-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transform translate-y-0.5 translate-x-0.5 opacity-80"></div>
                           <div className="absolute inset-0 rounded-xl overflow-hidden border-2 border-transparent group-hover:border-purple-500/50 transition-all z-10">
                             {renderGenerationMedia(group[0], 'w-full h-full object-cover')}
                             <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] text-white font-medium border border-white/10 flex items-center gap-1">
                               <Layers className="w-3 h-3" /> {group.length}
                             </div>
                             <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                               <p className="text-[10px] text-white truncate">{group[0].prompt}</p>
                             </div>
                           </div>
                         </div>
                       );
                     } else {
                       return (
                         <GenerationCard 
                           key={item.id} 
                           gen={item} 
                           onClick={() => isVideoGeneration(item) ? setSelectedImage(item) : navigateToEdit(item)} 
                         />
                       );
                     }
                   })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6 animate-in fade-in">
             {/* Filter and Search Bar */}
             <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                {/* Source Filter Buttons */}
                <div className="flex items-center gap-2">
                   <span className="text-sm text-slate-500 dark:text-slate-400">Source:</span>
                   <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-white/5">
                      {[
                        { id: 'all', label: 'All' },
                        { id: 'templates', label: 'Templates' },
                        { id: 'modify', label: 'Uploads' },
                        { id: 'generated', label: 'Generated' },
                        { id: 'video', label: 'Videos' }
                      ].map(filter => (
                        <button
                          key={filter.id}
                          onClick={() => setSourceFilter(filter.id as 'all' | 'templates' | 'modify' | 'generated' | 'video')}
                          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                            sourceFilter === filter.id
                              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {filter.label}
                        </button>
                      ))}
                   </div>
                </div>

                {/* Search Input */}
                <div className="relative w-full sm:w-64">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                   <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by name..."
                      className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg py-2 pl-9 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent"
                   />
                   {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        <X className="w-4 h-4" />
                      </button>
                   )}
                </div>
             </div>

             {/* Results Count */}
             <div className="text-sm text-slate-500 dark:text-slate-400">
                {filteredGenerations.length} {filteredGenerations.length === 1 ? 'result' : 'results'}
                {(sourceFilter !== 'all' || searchQuery) && (
                   <button
                      onClick={() => { setSourceFilter('all'); setSearchQuery(''); }}
                      className="ml-2 text-purple-500 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300"
                   >
                      Clear filters
                   </button>
                )}
             </div>

             {/* Grid of Images */}
             {loadingGenerations && generations.length === 0 ? (
               <div className="flex items-center justify-center py-20">
                 <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
               </div>
             ) : filteredGenerations.length > 0 ? (
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {groupGenerations(filteredGenerations).map((item, idx) => {
                    if (Array.isArray(item)) {
                      const group = item;
                      return (
                        <div 
                          key={`group_${idx}`}
                          onClick={() => { setSelectedGroup(group); setSelectedImage(group[0]); }}
                          className="relative aspect-square cursor-pointer group"
                        >
                          <div className="absolute inset-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transform translate-y-1.5 translate-x-1.5 opacity-60"></div>
                          <div className="absolute inset-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transform translate-y-0.5 translate-x-0.5 opacity-80"></div>
                          <div className="absolute inset-0 rounded-xl overflow-hidden border-2 border-transparent group-hover:border-purple-500/50 transition-all z-10">
                            {renderGenerationMedia(group[0], 'w-full h-full object-cover')}
                            <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] text-white font-medium border border-white/10 flex items-center gap-1">
                              <Layers className="w-3 h-3" /> {group.length}
                            </div>
                            <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-3 backdrop-blur-[2px]">
                              <Button size="sm" variant="gradient" onClick={(e) => { e.stopPropagation(); navigateToEdit(group[0]); }}>
                                <Edit className="w-3 h-3 mr-2" /> Edit in Studio
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    } else {
                      return (
                        <GenerationCard 
                          key={item.id} 
                          gen={item} 
                          onClick={() => isVideoGeneration(item) ? setSelectedImage(item) : navigateToEdit(item)} 
                        />
                      );
                    }
                  })}
               </div>
             ) : (
                <div className="text-center py-20 glass-panel rounded-2xl border-dashed border-slate-300 dark:border-white/20 bg-white dark:bg-slate-900/20">
                   <p className="text-slate-500 mb-4">
                      {generations.length === 0 
                        ? "No generations yet." 
                        : "No results match your filters."}
                   </p>
                   {generations.length === 0 ? (
                      <Button variant="ghost" className="text-purple-500 dark:text-purple-400" onClick={() => navigate('/')}>Start Creating</Button>
                   ) : (
                      <button
                         onClick={() => { setSourceFilter('all'); setSearchQuery(''); }}
                         className="text-purple-500 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300"
                      >
                         Clear filters
                      </button>
                   )}
                </div>
             )}
             
             {/* Load More / Infinite Scroll Trigger */}
             {hasMoreGenerations && (
               <div ref={loadMoreRef} className="flex justify-center py-8">
                 {loadingGenerations && <Loader2 className="w-6 h-6 animate-spin text-purple-500" />}
               </div>
             )}
          </div>
        )}

        {activeTab === 'collections' && (
          <>
            {!activeCollectionId ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in">
                    <div 
                        onClick={() => setIsCreatingCollection(true)}
                        className="glass-panel border-dashed border-slate-300 dark:border-white/20 rounded-2xl flex flex-col items-center justify-center p-8 cursor-pointer bg-slate-50 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10 transition-colors group h-48"
                    >
                        <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-white/5 flex items-center justify-center mb-3 group-hover:bg-purple-50 dark:group-hover:bg-purple-500/20 transition-colors">
                            <Plus className="w-6 h-6 text-slate-500 dark:text-slate-400 group-hover:text-purple-600 dark:group-hover:text-purple-400" />
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 font-medium">New Collection</p>
                    </div>

                    {collections.map(col => {
                        const items = getCollectionItems(col);
                        const previews = items.slice(0, 4);
                        
                        return (
                            <div key={col.id} onClick={() => setActiveCollectionId(col.id)} className="glass-panel p-4 rounded-2xl group cursor-pointer border border-slate-200 dark:border-white/10 hover:border-purple-500/30 transition-all relative bg-white dark:bg-slate-900/50">
                                <div className="grid grid-cols-2 gap-2 mb-4 h-32">
                                    {loadingTemplates && previews.length === 0 && col.imageIds.length > 0 ? (
                                        <div className="col-span-2 flex items-center justify-center">
                                            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                                        </div>
                                    ) : previews.length > 0 ? previews.map((item, idx) => (
                                         <div key={idx} className="bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden relative">
                                             <img src={item.imageUrl} className="w-full h-full object-cover" alt="preview" />
                                         </div>
                                    )) : (
                                         <div className="col-span-2 bg-slate-50 dark:bg-white/5 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs border border-dashed border-slate-200 dark:border-white/5">Empty</div>
                                    )}
                                </div>
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-slate-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">{col.name}</h4>
                                    <span className="text-xs text-slate-500">{col.imageIds.length} items</span>
                                </div>
                                {col.name !== 'Favorites' && (
                                    <button 
                                        className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-200/80 dark:bg-black/50 hover:bg-red-500 hover:text-white dark:hover:bg-red-500/80 text-slate-600 dark:text-white opacity-0 group-hover:opacity-100 transition-all z-10"
                                        onClick={(e) => { e.stopPropagation(); if(confirm('Delete this collection?')) deleteCollection(col.id); }}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                    {activeCollection && getCollectionItems(activeCollection).length === 0 ? (
                        <div className="text-center py-20 text-slate-500">
                             {loadingTemplates ? (
                               <Loader2 className="w-8 h-8 animate-spin text-purple-500 mx-auto" />
                             ) : (
                               <>
                                 <p>This collection is empty.</p>
                                 <Button variant="ghost" onClick={() => navigate('/')} className="mt-4">Browse Templates</Button>
                               </>
                             )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {activeCollection && getCollectionItems(activeCollection).map(item => (
                                <div 
                                  key={item.id} 
                                  className="group relative rounded-xl overflow-hidden cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/5 hover:border-purple-500/50 transition-all shadow-sm hover:shadow-xl hover:shadow-purple-900/20 aspect-square"
                                  onClick={() => navigate('/modify', { 
                                    state: { 
                                      initialImage: item.imageUrl,
                                      initialImageSource: { templateId: item.id, templateName: item.name }
                                    }
                                  })}
                                >
                                    <img 
                                        src={item.imageUrl} 
                                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" 
                                        loading="lazy" 
                                        alt={item.name}
                                    />

                                    {/* Hover Overlay with Actions - 与 History 相同的效果 */}
                                    <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-3 backdrop-blur-[2px] z-30">
                                        <Button size="sm" variant="gradient" onClick={(e) => { 
                                          e.stopPropagation(); 
                                          navigate('/modify', { 
                                            state: { 
                                              initialImage: item.imageUrl,
                                              initialImageSource: { templateId: item.id, templateName: item.name }
                                            }
                                          });
                                        }}>
                                            <Edit className="w-3 h-3 mr-2" /> Edit in Studio
                                        </Button>
                                        <div className="flex gap-2">
                                            <button 
                                              className="p-2 rounded-full bg-white/10 hover:bg-red-500 text-white transition-all border border-white/10" 
                                              onClick={(e) => { e.stopPropagation(); removeFromCollection(activeCollection.id, item.id); }} 
                                              title="Remove from Collection"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
          </>
        )}

        {activeTab === 'templates' && (
          <div className="space-y-6 animate-in fade-in">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">My Templates</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Create, review and manage your workflow templates.</p>
              </div>
              <Button variant="gradient" onClick={() => navigate('/templates/create')}>
                <Plus className="w-4 h-4 mr-2" /> Create new template
              </Button>
            </div>

            {loadingMyTemplates ? (
              <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-800">
                <div className="text-center text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-purple-500" />
                  Loading your templates...
                </div>
              </div>
            ) : myTemplatesError ? (
              <div className="text-center py-16 glass-panel rounded-2xl border border-red-200 dark:border-red-500/20 bg-white dark:bg-slate-900/20">
                <p className="mb-4 text-sm text-red-600 dark:text-red-400">{myTemplatesError}</p>
                <Button variant="secondary" onClick={() => void loadMyTemplates()}>Try again</Button>
              </div>
            ) : myTemplates.length === 0 ? (
              <div className="text-center py-20 glass-panel rounded-2xl border-dashed border-slate-300 dark:border-white/20 bg-white dark:bg-slate-900/20">
                <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                  <Layers className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">No templates yet</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-6">Create your first workflow template and share how you made it.</p>
                <Button variant="gradient" onClick={() => navigate('/templates/create')}>
                  Create a template
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {myTemplates.map(template => (
                  <div key={template.id} className="glass-panel border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden flex flex-col group hover:shadow-xl hover:-translate-y-1 transition-all bg-white dark:bg-slate-800" onClick={() => navigate(`/templates/${template.id}`)}>
                    <div className="relative aspect-[3/4] bg-slate-100 dark:bg-slate-900">
                      {!template.coverUrl || failedTemplateCovers.has(template.id) ? (
                        <div className="flex h-full w-full items-center justify-center text-slate-400 dark:text-slate-600">
                          <ImageIcon className="h-10 w-10" />
                        </div>
                      ) : template.coverType === 'video' ? (
                        <video 
                          src={template.coverUrl} 
                          className="w-full h-full object-cover"
                          muted
                          loop
                          playsInline
                          onMouseEnter={(e) => { e.currentTarget.play().catch(()=>{}); }}
                          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                          onError={() => setFailedTemplateCovers((current) => new Set(current).add(template.id))}
                        />
                      ) : (
                        <img
                          src={template.coverUrl}
                          className="w-full h-full object-cover"
                          alt={template.name}
                          onError={() => setFailedTemplateCovers((current) => new Set(current).add(template.id))}
                        />
                      )}
                      
                      {/* Status Tag */}
                      <div className="absolute top-3 left-3 z-10">
                        {template.status === 'Draft' && <span className="bg-slate-500/90 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded backdrop-blur-sm">Draft</span>}
                        {template.status === 'In review' && <span className="bg-amber-500/90 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded backdrop-blur-sm">In review</span>}
                        {template.status === 'Published' && <span className="bg-emerald-500/90 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded backdrop-blur-sm">Published</span>}
                        {template.status === 'Changes requested' && <span className="bg-red-500/90 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded backdrop-blur-sm">Changes requested</span>}
                      </div>

                      {template.status === 'In review' && (
                        <div className="absolute inset-0 bg-slate-900/40 flex items-center justify-center backdrop-blur-[1px] z-20">
                          <span className="text-white text-sm font-medium px-3 py-1.5 bg-black/50 rounded-lg">Waiting for review</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="p-4 flex-1 flex flex-col">
                      <h4 className="font-bold text-slate-900 dark:text-white truncate mb-1">{template.name}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{new Date(template.updatedAt).toLocaleDateString()} • {template.stepsCount} steps</p>
                      
                      {template.status === 'Published' && (
                        <div className="flex items-center gap-4 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg mb-4">
                          <div className="flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-purple-500" />
                            Used {template.uses} times
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-amber-500" />
                            {template.creditsEarned} credits earned
                          </div>
                        </div>
                      )}

                      <div className="mt-auto flex gap-2">
                        {template.status === 'Draft' && (
                          <>
                            <Button variant="secondary" size="sm" className="flex-1" onClick={(e) => { e.stopPropagation(); navigate(`/templates/create?templateId=${template.id}`); }}>Edit</Button>
                            <Button variant="secondary" size="sm" className="flex-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10" onClick={(e) => { e.stopPropagation(); setTemplateToDelete(template); }}>Delete</Button>
                          </>
                        )}
                        {template.status === 'In review' && (
                          <Button variant="secondary" size="sm" className="w-full" onClick={(e) => { e.stopPropagation(); navigate(`/templates/${template.id}`); }}>View</Button>
                        )}
                        {template.status === 'Published' && (
                          <>
                            <Button variant="secondary" size="sm" className="flex-1" onClick={(e) => { e.stopPropagation(); navigate(`/templates/${template.id}`); }}>View</Button>
                            <Button variant="secondary" size="sm" className="flex-1" onClick={(e) => { 
                              e.stopPropagation(); 
                              if (navigator.clipboard) {
                                navigator.clipboard.writeText(window.location.origin + `/#/templates/${template.id}`);
                                addToast('success', 'Link copied');
                              } else {
                                addToast('success', 'Link copied (fallback)');
                              }
                            }}>Share</Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="flex-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTemplateToDelete(template);
                              }}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                        {template.status === 'Changes requested' && (
                          <>
                            <Button variant="secondary" size="sm" className="flex-1 border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400" onClick={(e) => { e.stopPropagation(); setCurrentFeedback(template.feedback || ''); setCurrentFeedbackTemplateId(template.id); setFeedbackModalOpen(true); }}>View feedback</Button>
                            <Button variant="secondary" size="sm" className="flex-1" onClick={(e) => { e.stopPropagation(); navigate(`/templates/create?templateId=${template.id}`); }}>Edit</Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Collection Modal */}
      <Modal isOpen={isCreatingCollection} onClose={() => { setIsCreatingCollection(false); setNewCollectionName(''); }} title="New Collection">
           <div className="space-y-4">
               <div className="space-y-2">
                   <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Collection Name</label>
                   <input 
                      autoFocus
                      type="text" 
                      value={newCollectionName}
                      onChange={e => setNewCollectionName(e.target.value)}
                      placeholder="e.g. Summer Campaign"
                      className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none"
                      onKeyDown={e => e.key === 'Enter' && !isCreatingInProgress && handleCreateCollection()}
                      disabled={isCreatingInProgress}
                   />
               </div>
               <div className="flex gap-3">
                   <Button variant="secondary" className="flex-1" onClick={() => { setIsCreatingCollection(false); setNewCollectionName(''); }} disabled={isCreatingInProgress}>Cancel</Button>
                   {/* 🔧 FIX: 按钮添加 disabled 和 loading 状态 */}
                   <Button variant="gradient" className="flex-1" onClick={handleCreateCollection} disabled={isCreatingInProgress || !newCollectionName.trim()}>
                       {isCreatingInProgress ? (
                         <>
                           <Loader2 className="w-4 h-4 animate-spin mr-2" />
                           Creating...
                         </>
                       ) : (
                         'Create Collection'
                       )}
                   </Button>
               </div>
           </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="Delete Generation">
          <div className="space-y-6">
              <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4 border border-red-200 dark:border-red-500/20">
                      <Trash2 className="w-6 h-6 text-red-600 dark:text-red-500" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Generation?</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm">
                      Are you sure you want to delete this generation? <br/>
                      <span className="text-red-500 dark:text-red-400 font-medium">This action cannot be undone.</span>
                  </p>
              </div>
              <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" onClick={() => setItemToDelete(null)} disabled={isDeleting}>Cancel</Button>
                  <Button variant="danger" className="flex-1" onClick={confirmDelete} disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Delete Permanently
                  </Button>
              </div>
          </div>
      </Modal>

      {/* Delete Template Modal */}
      <Modal
        isOpen={!!templateToDelete}
        onClose={() => {
          if (!deletingTemplate) setTemplateToDelete(null);
        }}
        title={templateToDelete?.status === 'Published' ? 'Delete this published template?' : 'Delete this draft?'}
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {templateToDelete?.name}
            </p>
            {templateToDelete?.status === 'Published' ? (
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                The template will be removed from the public marketplace and from My Templates immediately. Existing usage, reward, notification, and accounting history will be preserved.
              </p>
            ) : (
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                This draft and its unused uploaded files will be permanently deleted. This action cannot be undone.
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setTemplateToDelete(null)}
              disabled={deletingTemplate}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={deletingTemplate}
              onClick={async () => {
                if (!templateToDelete || !user) return;
                const target = templateToDelete;
                setDeletingTemplate(true);
                try {
                  const result = await deleteCreatorTemplate(
                    target.id,
                    user.id,
                    target.status,
                  );
                  setMyTemplates((current) => current.filter((template) => template.id !== target.id));
                  setFailedTemplateCovers((current) => {
                    const next = new Set(current);
                    next.delete(target.id);
                    return next;
                  });
                  addToast(
                    'success',
                    result.mode === 'archived'
                      ? 'Published template removed from the marketplace.'
                      : 'Draft deleted.',
                  );
                  setTemplateToDelete(null);
                } catch (error) {
                  addToast(
                    'error',
                    error instanceof Error ? error.message : 'Could not delete the template.',
                  );
                } finally {
                  setDeletingTemplate(false);
                }
              }}
            >
              {deletingTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* View Feedback Modal */}
      <Modal isOpen={feedbackModalOpen} onClose={() => { setFeedbackModalOpen(false); setCurrentFeedback(''); setCurrentFeedbackTemplateId(null); }} title="Template Feedback">
        <div className="space-y-6">
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4 rounded-xl">
            <h4 className="text-sm font-bold text-red-800 dark:text-red-400 mb-2">Admin Feedback:</h4>
            <p className="text-sm text-red-700 dark:text-red-300">
              {currentFeedback}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setFeedbackModalOpen(false); setCurrentFeedback(''); setCurrentFeedbackTemplateId(null); }}>Close</Button>
            <Button variant="gradient" className="flex-1" disabled={!currentFeedbackTemplateId} onClick={() => {
              if (!currentFeedbackTemplateId) return;
              const templateId = currentFeedbackTemplateId;
              setFeedbackModalOpen(false);
              setCurrentFeedback('');
              setCurrentFeedbackTemplateId(null);
              navigate(`/templates/create?templateId=${templateId}`);
            }}>Edit template</Button>
          </div>
        </div>
      </Modal>

      {/* Lightbox Modal for Dashboard */}
      {selectedImage && (
        <div className="fixed inset-0 z-[60] bg-slate-900/95 dark:bg-black/95 backdrop-blur-xl flex items-center justify-center animate-in fade-in duration-200" onClick={() => { setSelectedImage(null); setSelectedGroup(null); }}>
           <div className="absolute top-6 right-6 flex gap-4 z-50">
              <button 
                className="p-3 rounded-full bg-white/10 hover:bg-white text-white hover:text-black transition-colors backdrop-blur-md border border-white/10"
                onClick={(e) => { e.stopPropagation(); navigateToEdit(selectedImage); setSelectedImage(null); setSelectedGroup(null); }}
                title={isVideoGeneration(selectedImage) ? "Open Video" : "Edit Template"}
              >
                  {isVideoGeneration(selectedImage) ? <PlayCircle className="w-5 h-5" /> : <Edit className="w-5 h-5" />}
              </button>
              <button 
                className="p-3 rounded-full bg-white/10 hover:bg-red-500 text-white transition-colors backdrop-blur-md border border-white/10"
                onClick={(e) => { e.stopPropagation(); handleDelete(selectedImage.id); }}
                title="Delete Generation"
              >
                  <Trash2 className="w-5 h-5" />
              </button>
              <button className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md border border-white/10" onClick={() => { setSelectedImage(null); setSelectedGroup(null); }}>
                  <X className="w-5 h-5" />
              </button>
           </div>
           
           <div className="max-w-6xl w-full p-4 flex flex-col md:flex-row gap-8 items-center justify-center" onClick={e => e.stopPropagation()}>
               <div className="relative flex-1 flex flex-col items-center justify-center max-h-[80vh]">
                    {renderGenerationMedia(selectedImage, 'max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl', isVideoGeneration(selectedImage), true)}
                    
                    {/* Group thumbnails */}
                    {selectedGroup && selectedGroup.length > 1 && (
                      <div className="flex gap-2 mt-4 p-2 bg-black/40 backdrop-blur-md rounded-xl">
                        {selectedGroup.map((gen, idx) => (
                          <div
                            key={gen.id}
                            onClick={() => setSelectedImage(gen)}
                            className={`w-16 h-16 rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                              selectedImage.id === gen.id 
                                ? 'border-purple-500 ring-2 ring-purple-500/30' 
                                : 'border-transparent hover:border-white/50'
                            }`}
                          >
                            {renderGenerationMedia(gen, 'w-full h-full object-cover')}
                          </div>
                        ))}
                      </div>
                    )}
               </div>
               
               <div className="glass-panel p-6 rounded-2xl w-full md:w-80 flex flex-col gap-4 bg-white/90 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        {isVideoGeneration(selectedImage) ? <Film className="w-5 h-5 text-purple-600 dark:text-purple-400" /> : <ImageIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />} {isVideoGeneration(selectedImage) ? 'Video Details' : 'Image Details'}
                        {selectedGroup && selectedGroup.length > 1 && (
                          <span className="text-xs font-normal text-slate-500 ml-auto">{selectedGroup.findIndex(g => g.id === selectedImage.id) + 1} / {selectedGroup.length}</span>
                        )}
                    </h3>
                    
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Template</span>
                            <div className="flex items-center gap-2 group cursor-pointer p-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-purple-50 dark:hover:bg-purple-500/10 border border-slate-200 dark:border-white/5 hover:border-purple-200 dark:hover:border-purple-500/30 transition-all" onClick={() => navigateToEdit(selectedImage)}>
                                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                <p className="text-sm text-slate-700 dark:text-white font-medium group-hover:text-purple-600 dark:group-hover:text-purple-300 transition-colors flex-1">
                                    {getGenerationDisplayName(selectedImage)}
                                </p>
                                <ExternalLink className="w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-purple-400" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Prompt</span>
                            <p className="text-sm text-slate-600 dark:text-slate-300 italic bg-slate-100 dark:bg-black/30 p-3 rounded-lg border border-slate-200 dark:border-white/5">"{selectedImage.prompt}"</p>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Created</span>
                            <p className="text-sm text-slate-600 dark:text-slate-300 font-mono">{new Date(selectedImage.createdAt).toLocaleString()}</p>
                        </div>
                    </div>
                  </div>
                  
                  <div className="mt-auto space-y-3 pt-6 border-t border-slate-200 dark:border-white/10">
                    <Button variant="gradient" className="w-full" onClick={() => { navigateToEdit(selectedImage); }}>
                        {isVideoGeneration(selectedImage) ? <PlayCircle className="w-4 h-4 mr-2" /> : <Edit className="w-4 h-4 mr-2" />} {isVideoGeneration(selectedImage) ? 'Open in Video Studio' : 'Edit in Studio'}
                    </Button>
                    {isVideoGeneration(selectedImage) && selectedImage.videoUrl ? (
                      <a href={selectedImage.videoUrl} download={`video-${selectedImage.id}.mp4`} className="block">
                        <Button variant="secondary" className="w-full">
                          <Download className="w-4 h-4 mr-2" /> Download Video
                        </Button>
                      </a>
                    ) : (
                      <Button variant="secondary" className="w-full" onClick={() => addToast('success', 'Image saved to device')}>
                          <Download className="w-4 h-4 mr-2" /> Download High Res
                      </Button>
                    )}
                  </div>
               </div>
           </div>
        </div>
      )}
    </div>
  );
};