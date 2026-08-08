import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Heart, Share2, Crown, Plus, Check, Loader2, Workflow, Play } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Template } from '../types';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { fetchPublishedTemplates } from '../utils/templatePublicApi';
import { AuthGateModal } from '../components/AuthGateModal';

const getHomeColumnCount = (): number => {
  if (typeof window === 'undefined') return 5;
  if (window.innerWidth >= 1280) return 5;
  if (window.innerWidth >= 1024) return 4;
  if (window.innerWidth >= 768) return 3;
  return 2;
};

const HOME_PAGE_SIZE = 24;

// Lazy loading image component with skeleton - 使用 aspect-ratio 防止跳动
const LazyImage = ({ 
  src, 
  alt, 
  className,
  width,
  height 
}: { 
  src: string; 
  alt: string; 
  className?: string;
  width?: number;
  height?: number;
}) => {
  
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [intrinsicAspectRatio, setIntrinsicAspectRatio] = useState<number | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsLoaded(false);
    setIntrinsicAspectRatio(null);
  }, [src]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // 计算 aspect-ratio，如果有宽高则使用，否则用默认值
  const aspectRatio = intrinsicAspectRatio || (width && height ? width / height : 3 / 4);

  return (
    <div 
      ref={imgRef} 
      className="relative w-full"
      style={{ aspectRatio }}
    >
      {/* Skeleton placeholder */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-2xl" />
      )}
      {/* Actual image */}
      {isInView && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) {
              setIntrinsicAspectRatio(image.naturalWidth / image.naturalHeight);
            }
            setIsLoaded(true);
          }}
          className={`absolute inset-0 w-full h-full object-cover ${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
        />
      )}
    </div>
  );
};

const LazyWorkflowVideo = ({
  videoUrl,
  posterUrl,
  width,
  height,
}: {
  videoUrl: string;
  posterUrl: string;
  width?: number;
  height?: number;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [intrinsicAspectRatio, setIntrinsicAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    setShouldLoad(false);
    setIntrinsicAspectRatio(null);
    // Let the video element request its poster when it is near the viewport.
    // Creating a new Image here caused every off-screen workflow to request
    // its poster immediately, duplicating work on mobile connections.
  }, [posterUrl, videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const aspectRatio = intrinsicAspectRatio || (width && height ? width / height : 3 / 4);

  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio }}>
      <video
        ref={videoRef}
        src={shouldLoad ? videoUrl : undefined}
        poster={posterUrl}
        autoPlay={shouldLoad}
        loop
        muted
        playsInline
        preload="none"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) {
            setIntrinsicAspectRatio(video.videoWidth / video.videoHeight);
          }
        }}
        className="absolute inset-0 h-full w-full object-cover transform transition-transform duration-700 group-hover:scale-105"
      />
    </div>
  );
};


const TemplateCardItem: React.FC<{ 
  t: Template; 
  onClick: () => void; 
  onAction: (e: React.MouseEvent, type: 'share' | 'collect', t: Template) => void;
  user: any;
}> = ({ 
  t, 
  onClick, 
  onAction,
  user
}) => {
  const handleUseWorkflow = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  };

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  };

  return (
    <div
      onClick={(e) => {
        if (t.isWorkflow) handleViewDetails(e);
        else onClick();
      }}
      className="group relative break-inside-avoid rounded-2xl overflow-hidden cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/5 hover:border-purple-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-900/10"
    >
      <div className="relative">
        {t.videoUrl ? (
          <LazyWorkflowVideo
            videoUrl={t.videoUrl}
            posterUrl={t.thumbUrl || t.imageUrl}
            width={t.width}
            height={t.height}
          />
        ) : (
          <LazyImage
            src={t.thumbUrl || t.imageUrl}
            alt={t.name}
            width={t.width}
            height={t.height}
            className="transform transition-transform duration-700 group-hover:scale-105"
          />
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        
        {t.isWorkflow && (
          <div className="absolute top-3 left-3 z-20">
            <span className="flex items-center gap-1 text-[10px] font-medium text-purple-200 bg-purple-500/20 px-1.5 py-0.5 rounded backdrop-blur-md border border-purple-500/30 uppercase">
              <Workflow className="w-3 h-3" />
              Workflow
            </span>
          </div>
        )}

        {t.isPro && (
          <div className="absolute top-3 right-3 z-20">
            <div className="px-2 py-1 rounded-md bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg flex items-center gap-1.5">
              <Crown className="w-3 h-3 text-white" />
              <span className="text-[10px] font-bold text-white uppercase tracking-wider">Pro</span>
            </div>
          </div>
        )}

        {!t.isWorkflow && (
          <>
            <div className="absolute top-3 left-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-4 group-hover:translate-x-0 z-10">
              <button 
                onClick={(e) => onAction(e, 'collect', t)}
                className="p-2 rounded-full glass-panel hover:bg-white text-slate-900 dark:text-white hover:text-pink-500 transition-colors"
              >
                <Heart className="w-4 h-4" />
              </button>
              <button 
                onClick={(e) => onAction(e, 'share', t)}
                className="p-2 rounded-full glass-panel hover:bg-white text-slate-900 dark:text-white hover:text-blue-500 transition-colors"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
            
            <div className="absolute bottom-3 left-0 right-0 flex justify-center opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0 transition-all duration-300 z-10">
              <div
                onClick={(event) => {
                  event.stopPropagation();
                  onClick();
                }}
                className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 px-4 py-2.5 rounded-xl shadow-lg shadow-purple-900/30 hover:shadow-purple-900/50 hover:scale-105 transition-all duration-200 cursor-pointer pointer-events-auto"
              >
                <svg className="w-4 h-4 text-white shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                <span className="text-sm font-medium text-white whitespace-nowrap">Replace with my product</span>
              </div>
            </div>
          </>
        )}

        {t.isWorkflow && (
          <div className="absolute bottom-0 left-0 right-0 p-4 pt-12 bg-gradient-to-t from-slate-900/90 via-slate-900/60 to-transparent flex flex-row items-end justify-between z-20 translate-y-2 group-hover:translate-y-0 transition-all duration-300">
            <div className="flex flex-col">
              <h3 className="text-white font-bold text-sm line-clamp-1">{t.name}</h3>
              <p className="text-white/70 text-xs">{t.authorName}</p>
              <span className="text-white/60 text-[10px] mt-0.5">{t.usesCount} uses</span>
            </div>

            <button 
              onClick={handleUseWorkflow}
              className="flex items-center justify-center w-10 h-10 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-full text-[11px] font-bold transition-all shadow-lg shadow-purple-500/25 pointer-events-auto hover:scale-105 shrink-0 opacity-0 group-hover:opacity-100"
            >
              Use
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

interface HomeProps {
  onGuestTemplateClick?: () => void;
}

export const Home: React.FC<HomeProps> = ({ onGuestTemplateClick }) => {
  const navigate = useNavigate();
  const { browsing, saveBrowsingState, addToast, user, collections, addToCollection, createCollection } = useStore();
  
  // State
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreTemplates, setHasMoreTemplates] = useState(true);
  const [search, setSearch] = useState(browsing.searchQuery);
  const [activeCategory, setActiveCategory] = useState(browsing.category);
  const [selectedTemplateForModal, setSelectedTemplateForModal] = useState<Template | null>(null);
  const [modalType, setModalType] = useState<'share' | 'collect' | 'upgrade' | 'auth' | null>(null);
  
  // Tag Filter State
  const [activeScene, setActiveScene] = useState<string>('All');
  const [activeModel, setActiveModel] = useState<string>('All');
  const [activeMood, setActiveMood] = useState<string>('All');
  const [activeHoliday, setActiveHoliday] = useState<string>('All');
  const [showFilters, setShowFilters] = useState(false);
  
  // Create Collection State inside Modal
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  // Search Bar Interaction State
  const [showSearchBar, setShowSearchBar] = useState(true);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [columnCount, setColumnCount] = useState(getHomeColumnCount);
  const lastScrollY = useRef(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Filter Options
  const categories = ['All', 'Cosmetic', 'Candle', 'Bath Body', 'Sports', 'Baby', 'Mens Care'];
  const scenes = ['All', 'Studio', 'Outdoor', 'Lifestyle'];
  const models = ['All', 'No Model', 'Hand Only', 'With Model'];
  const moods = ['All', 'Minimal', 'Luxury', 'Fashion', 'Playful', 'Dark', 'Casual'];
  const holidays = ['All', 'Christmas', 'Valentine', 'Halloween', 'Easter', "Mother's Day"];

  const mapTemplate = (row: Awaited<ReturnType<typeof fetchPublishedTemplates>>[number]): Template => {
    const isWorkflow = row.template_kind.startsWith('workflow_');
    const originalCoverUrl = row.cover_url || row.preview_url || '';
    const isVideoCover = isWorkflow && (
      row.cover_type === 'video'
      || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(originalCoverUrl)
    );
    const poster = row.thumb_url || row.image_url || '';
    const cover = isVideoCover
      ? poster
      : row.thumb_url || row.cover_url || row.image_url || '';
    return {
      id: row.id,
      slug: row.slug,
      name: row.display_name || row.name,
      imageUrl: cover,
      thumbUrl: row.thumb_url || undefined,
      videoUrl: isVideoCover ? originalCoverUrl || undefined : undefined,
      category: row.category || (isWorkflow ? 'Workflow' : 'Other'),
      tags: row.tags || [],
      isPro: Boolean(row.is_pro),
      scene: row.scene || undefined,
      model: row.model || undefined,
      mood: row.mood || undefined,
      holiday: row.holiday || undefined,
      width: row.width || 896,
      height: row.height || 1344,
      isWorkflow,
      authorName: row.creator_id === user?.id
        ? user.name
        : row.author_name || (row.creator_id ? 'Lazora creator' : 'Lazora'),
      usesCount: Number(row.use_count || 0),
      publishedAt: row.published_at || undefined,
    };
  };

  const loadTemplatePage = async (offset: number, append: boolean) => {
    if (append && (loadingMore || !hasMoreTemplates)) return;
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const rows = await fetchPublishedTemplates(HOME_PAGE_SIZE, offset);
      const mapped = rows.map(mapTemplate);
      setTemplates((current) => append ? [...current, ...mapped] : mapped);
      setHasMoreTemplates(rows.length === HOME_PAGE_SIZE);
    } catch (err) {
      console.error('Unexpected error:', err);
      addToast('error', 'Failed to load published templates. Please refresh.');
      if (!append) setTemplates([]);
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplatePage(0, false);
  }, [addToast, user?.id, user?.name]);

  // Restore scroll position
  useEffect(() => {
    window.scrollTo(0, browsing.scrollY);
  }, []); 

  useEffect(() => {
    let animationFrame = 0;
    const updateColumnCount = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setColumnCount(getHomeColumnCount());
      });
    };
    window.addEventListener('resize', updateColumnCount);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', updateColumnCount);
    };
  }, []);

  // Scroll Handler for Search Bar Visibility
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Threshold to prevent jitter on small movements
      if (Math.abs(currentScrollY - lastScrollY.current) < 5) return;

      if (currentScrollY < 50) {
        // Always show at the top
        setShowSearchBar(true);
      } else if (currentScrollY > lastScrollY.current && currentScrollY > 80) {
        // Scrolling Down - Hide
        setShowSearchBar(false);
        setIsSearchFocused(false);
        
        // Blur input if needed to prevent keyboard from sticking up
        if (document.activeElement instanceof HTMLElement && searchContainerRef.current?.contains(document.activeElement)) {
            document.activeElement.blur();
        }
      } else if (currentScrollY < lastScrollY.current) {
        // Scrolling Up - Show
        setShowSearchBar(true);
      }
      
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Click Outside to Collapse Categories
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter Logic
  const normalizedSearch = search.trim().toLowerCase();
  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(normalizedSearch) || t.tags.some(tag => tag.toLowerCase().includes(normalizedSearch)) || (t.authorName && t.authorName.toLowerCase().includes(normalizedSearch));
    const matchesCategory = activeCategory === 'All' || t.category.includes(activeCategory);
    const matchesScene = activeScene === 'All' || t.scene === activeScene;
    const matchesModel = activeModel === 'All' || t.model === activeModel;
    const matchesMood = activeMood === 'All' || (t.mood && t.mood.includes(activeMood));
    const matchesHoliday = activeHoliday === 'All' || t.holiday === activeHoliday;
    if (normalizedSearch) return matchesSearch;
    if (t.isWorkflow) return true;
    return matchesCategory && matchesScene && matchesModel && matchesMood && matchesHoliday;
  });
  const workflowTemplates = filteredTemplates
    .filter((template) => template.isWorkflow)
    .sort((left, right) => {
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      return rightTime - leftTime;
    });
  const standardTemplates = filteredTemplates.filter((template) => !template.isWorkflow);
  const masonryColumns = useMemo(() => {
    const columns = Array.from({ length: columnCount }, () => [] as Template[]);
    [...workflowTemplates, ...standardTemplates].forEach((template, index) => {
      columns[index % columnCount].push(template);
    });
    return columns;
  }, [columnCount, standardTemplates, workflowTemplates]);
  
  // Count active filters
  const activeFilterCount = [activeScene, activeModel, activeMood, activeHoliday].filter(f => f !== 'All').length;

  const handleTemplateClick = (t: Template) => {
    if (!user) {
      saveBrowsingState({
        scrollY: window.scrollY,
        searchQuery: search,
        category: activeCategory,
        lastViewedTemplate: t.id,
      });
      onGuestTemplateClick?.();
      return;
    }

    // Pro Permission Check
    const isProUser = user?.plan === 'Pro' || user?.plan === 'Enterprise';
    if (user && t.isPro && !isProUser) {
      setModalType('upgrade');
      return;
    }

    saveBrowsingState({ scrollY: window.scrollY, searchQuery: search, category: activeCategory, lastViewedTemplate: t.id });

    if (t.isWorkflow) {
      navigate('/templates/' + (t.slug || t.id));
      return;
    }
    
    // Navigate to Modify with template as initial image
    navigate('/modify', {
      state: {
        initialImage: t.imageUrl,
        initialImageSource: { templateId: t.id, templateName: t.name }
      }
    });
  };

  const handleAction = (e: React.MouseEvent, type: 'share' | 'collect', t: Template) => {
    e.stopPropagation();

    // Login Check for Collection
    if (type === 'collect' && !user) {
      saveBrowsingState({ 
        intendedDestination: '/' // Stay on home if they just wanted to collect
      });
      setModalType('auth');
      return;
    }

    setSelectedTemplateForModal(t);
    setModalType(type);
    setIsCreatingCollection(false); // Reset creation state
    setNewCollectionName('');
  };

  const handleAddToCollection = (collectionId: string) => {
    if (selectedTemplateForModal) {
      addToCollection(collectionId, selectedTemplateForModal.id);
      setModalType(null);
    }
  };

  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      createCollection(newCollectionName.trim());
      setNewCollectionName('');
      setIsCreatingCollection(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!selectedTemplateForModal) return;
    const routeKey = selectedTemplateForModal.slug || selectedTemplateForModal.id;
    const shareUrl = `${window.location.origin}/#/templates/${routeKey}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      addToast('success', 'Template link copied.');
      setModalType(null);
    } catch {
      addToast('error', 'Could not copy the template link.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      
      {/* Fixed Search Bar */}
      <div 
        ref={searchContainerRef}
        className={`fixed top-16 left-0 right-0 z-40 px-4 md:px-8 py-2.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-b border-slate-200 dark:border-white/5 shadow-sm transition-transform duration-300 ease-out ${
            showSearchBar ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="max-w-4xl mx-auto flex flex-col items-center">
          {/* Search Bar Input */}
          <div className="relative w-full max-w-xl group z-50">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Search className={`w-4 h-4 transition-colors ${isSearchFocused ? 'text-purple-500' : 'text-slate-400 dark:text-slate-500'}`} />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              placeholder="Search templates (e.g., 'minimal', 'perfume', 'flower')..."
              className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 rounded-full py-2.5 pl-10 pr-6 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:bg-white dark:focus:bg-slate-800 transition-all shadow-inner"
            />
          </div>

          {/* Categories - Expandable (Adjusted Height and Margin) */}
          <div className={`w-full md:w-auto overflow-hidden transition-all duration-300 ease-in-out ${
              isSearchFocused ? 'max-h-14 opacity-100 mt-2' : 'max-h-0 opacity-0 mt-0'
          }`}>
            <div className="flex gap-2 overflow-x-auto max-w-full pb-1 hide-scrollbar mask-linear-fade justify-start md:justify-center px-1">
                {categories.map(cat => (
                <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    onMouseDown={(e) => e.preventDefault()} // Prevent input blur when clicking buttons
                    className={`px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
                    activeCategory === cat
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-md'
                        : 'bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white hover:border-slate-200 dark:hover:border-white/10'
                    }`}
                >
                    {cat}
                </button>
                ))}
                {/* Filter Toggle Button */}
                <button
                    onClick={() => setShowFilters(!showFilters)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border flex items-center gap-1.5 ${
                      showFilters || activeFilterCount > 0
                        ? 'bg-purple-600 text-white border-purple-600 shadow-md'
                        : 'bg-transparent border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                    }`}
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
                </button>
            </div>
          </div>

          {/* Advanced Filters Panel */}
          <div className={`w-full overflow-hidden transition-all duration-300 ease-in-out ${
              showFilters && isSearchFocused ? 'max-h-96 opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'
          }`}>
            <div className="bg-slate-100/80 dark:bg-slate-800/50 rounded-xl p-4 space-y-3">
              {/* Scene */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16">Scene:</span>
                {scenes.map(s => (
                  <button
                    key={s}
                    onClick={() => setActiveScene(s)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`px-3 py-1 rounded-full text-xs transition-all ${
                      activeScene === s
                        ? 'bg-purple-600 text-white'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-slate-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              
              {/* Model */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16">Model:</span>
                {models.map(m => (
                  <button
                    key={m}
                    onClick={() => setActiveModel(m)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`px-3 py-1 rounded-full text-xs transition-all ${
                      activeModel === m
                        ? 'bg-purple-600 text-white'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-slate-600'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              
              {/* Mood */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16">Mood:</span>
                {moods.map(m => (
                  <button
                    key={m}
                    onClick={() => setActiveMood(m)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`px-3 py-1 rounded-full text-xs transition-all ${
                      activeMood === m
                        ? 'bg-purple-600 text-white'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-slate-600'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              
              {/* Holiday */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16">Holiday:</span>
                {holidays.map(h => (
                  <button
                    key={h}
                    onClick={() => setActiveHoliday(h)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`px-3 py-1 rounded-full text-xs transition-all ${
                      activeHoliday === h
                        ? 'bg-purple-600 text-white'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-slate-600'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
              
              {/* Clear Filters */}
              {activeFilterCount > 0 && (
                <button
                  onClick={() => {
                    setActiveScene('All');
                    setActiveModel('All');
                    setActiveMood('All');
                    setActiveHoliday('All');
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  className="text-xs text-purple-600 dark:text-purple-400 hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area - Increased Padding Top */}
      <div className="pt-44 px-4 md:px-8 pb-12">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-500 dark:text-slate-400">No templates found</p>
          </div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 items-start gap-4 max-w-[1600px] mx-auto">
          {masonryColumns.map((column, columnIndex) => (
            <div key={`template-column-${columnIndex}`} className="min-w-0 space-y-4">
              {column.map((t) => (
                <TemplateCardItem
                  key={t.id}
                  t={t}
                  onClick={() => handleTemplateClick(t)}
                  onAction={handleAction}
                  user={user}
                />
              ))}
            </div>
          ))}
        </div>
        {hasMoreTemplates && (
          <div className="flex justify-center pt-10">
            <Button
              variant="secondary"
              onClick={() => void loadTemplatePage(templates.length, true)}
              disabled={loadingMore}
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load more templates'}
            </Button>
          </div>
        )}
        </>
        )}
      </div>

      {/* Share Modal */}
      <Modal isOpen={modalType === 'share'} onClose={() => setModalType(null)} title="Share Template">
        <div className="space-y-4">
           <p className="text-slate-600 dark:text-slate-300 text-sm">Share this style with your team or social networks.</p>
           <div className="flex gap-2">
             <input
               readOnly
               value={selectedTemplateForModal
                 ? `${window.location.origin}/#/templates/${selectedTemplateForModal.slug || selectedTemplateForModal.id}`
                 : ''}
               className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-400"
             />
             <Button size="sm" onClick={() => void handleCopyShareLink()}>Copy</Button>
           </div>
        </div>
      </Modal>

      {/* Collection Modal */}
      <Modal isOpen={modalType === 'collect'} onClose={() => setModalType(null)} title="Add to Collection">
        <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
           {collections.map(col => {
             const isAdded = col.imageIds.includes(selectedTemplateForModal?.id || '');
             return (
              <button 
                key={col.id} 
                onClick={() => handleAddToCollection(col.id)}
                className="w-full text-left px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 hover:border-purple-500/50 transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded bg-white dark:bg-slate-800 flex items-center justify-center border border-slate-200 dark:border-white/5">
                     <Heart className={`w-4 h-4 ${isAdded ? 'text-pink-500 fill-pink-500' : 'text-slate-400 dark:text-slate-500'}`} />
                   </div>
                   <span className="text-slate-700 dark:text-slate-200 text-sm">{col.name}</span>
                </div>
                {isAdded && <Check className="w-4 h-4 text-green-400" />}
              </button>
             );
           })}
           
           {!isCreatingCollection ? (
             <button 
               onClick={() => setIsCreatingCollection(true)}
               className="w-full py-3 text-sm text-center text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-300 mt-2 border border-dashed border-purple-500/30 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-colors flex items-center justify-center gap-2"
              >
               <Plus className="w-4 h-4" /> Create New Collection
             </button>
           ) : (
             <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-white/10 animate-in fade-in slide-in-from-top-2">
                <input 
                  autoFocus
                  type="text" 
                  value={newCollectionName}
                  onChange={e => setNewCollectionName(e.target.value)}
                  placeholder="Collection Name..."
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white mb-2 focus:ring-1 focus:ring-purple-500 outline-none"
                  onKeyDown={e => e.key === 'Enter' && handleCreateCollection()}
                />
                <div className="flex gap-2">
                   <Button size="sm" variant="gradient" className="flex-1" onClick={handleCreateCollection}>Create</Button>
                   <Button size="sm" variant="secondary" className="flex-1" onClick={() => setIsCreatingCollection(false)}>Cancel</Button>
                </div>
             </div>
           )}
        </div>
      </Modal>

      {/* Upgrade Modal */}
      <Modal isOpen={modalType === 'upgrade'} onClose={() => setModalType(null)} title="🔒 Pro Feature">
         <div className="flex flex-col items-center text-center p-4">
             <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4 border border-slate-200 dark:border-white/10 shadow-xl shadow-purple-900/20">
                <Crown className="w-8 h-8 text-yellow-400" />
             </div>
             <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Unlock Pro Templates</h3>
             <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">This template is exclusively available on the Pro plan. Upgrade now to access this and 500+ other premium styles.</p>
             
             <div className="flex w-full gap-3">
                 <Button variant="secondary" className="flex-1" onClick={() => setModalType(null)}>Cancel</Button>
                 <Button variant="gradient" className="flex-1" onClick={() => navigate('/pricing')}>Upgrade to Pro</Button>
             </div>
         </div>
      </Modal>
      <AuthGateModal
        isOpen={modalType === 'auth'}
        onClose={() => setModalType(null)}
        destination="/"
        title="Sign up to save templates"
        description="Browsing and opening templates is free. Create an account only when you want to save one to a collection."
      />
    </div>
  );
};
