import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Heart, Share2, Crown, Plus, Check, Loader2 } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useStore } from '../context/StoreContext';
import { Template } from '../types';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';

// ============================================
// 🔧 修复：LazyImage 组件使用 aspect-ratio 占位
// ============================================
interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  width?: number;   // 图片原始宽度
  height?: number;  // 图片原始高度
}

const LazyImage = ({ src, alt, className, width, height }: LazyImageProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }  // 提前 200px 开始加载
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // 计算 aspect-ratio，默认使用 3:4（常见的竖版产品图比例）
  const aspectRatio = width && height ? width / height : 3 / 4;

  return (
    <div 
      ref={imgRef} 
      className="relative w-full overflow-hidden"
      style={{ 
        // 🔧 关键：使用 aspect-ratio 保持占位空间
        aspectRatio: aspectRatio,
      }}
    >
      {/* Skeleton placeholder - 只在未加载时显示 */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 animate-pulse" />
      )}
      
      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
          <span className="text-slate-400 text-xs">Failed to load</span>
        </div>
      )}
      
      {/* Actual image */}
      {isInView && !hasError && (
        <img
          src={src}
          alt={alt}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          className={`${className} absolute inset-0 w-full h-full object-cover ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } transition-opacity duration-300`}
        />
      )}
    </div>
  );
};

export const Home = () => {
  const navigate = useNavigate();
  const { browsing, saveBrowsingState, addToast, user, collections, addToCollection, createCollection } = useStore();
  
  // State
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(browsing.searchQuery);
  const [activeCategory, setActiveCategory] = useState(browsing.category);
  const [selectedTemplateForModal, setSelectedTemplateForModal] = useState<Template | null>(null);
  const [modalType, setModalType] = useState<'share' | 'collect' | 'upgrade' | null>(null);
  
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
  const lastScrollY = useRef(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Filter Options
  const categories = ['All', 'Cosmetic', 'Candle', 'Bath Body', 'Sports', 'Baby', 'Mens Care'];
  const scenes = ['All', 'Studio', 'Outdoor', 'Lifestyle'];
  const models = ['All', 'No Model', 'Hand Only', 'With Model'];
  const moods = ['All', 'Minimal', 'Luxury', 'Fashion', 'Playful', 'Dark', 'Casual'];
  const holidays = ['All', 'Christmas', 'Valentine', 'Halloween', 'Easter', "Mother's Day"];

  // Fetch templates from Supabase
  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('templates')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      
      if (error) {
        console.error('Error fetching templates:', error);
        addToast('error', 'Failed to load templates');
      } else {
        console.log('Fetched templates:', data?.length);
        // 🔧 修复：添加 width 和 height 到映射
        const mapped = (data || []).map(t => ({
          id: t.id,
          name: t.display_name || t.name,
          imageUrl: t.image_url,
          thumbUrl: t.thumb_url,
          category: t.category,
          tags: t.tags || [],
          isPro: t.is_pro || false,
          width: t.width || 600,      // 🔧 新增：默认 600
          height: t.height || 800,    // 🔧 新增：默认 800 (3:4 比例)
          scene: t.scene,
          model: t.model,
          mood: t.mood,
          holiday: t.holiday
        }));
        setTemplates(mapped);
      }
      setLoading(false);
    };
    
    fetchTemplates();
  }, []);

  // Restore scroll position
  useEffect(() => {
    window.scrollTo(0, browsing.scrollY);
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


  // Filter templates based on search, category, and tags
  const filteredTemplates = templates.filter(t => {
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      const matchesSearch = 
        t.name.toLowerCase().includes(searchLower) ||
        t.tags.some(tag => tag.toLowerCase().includes(searchLower));
      if (!matchesSearch) return false;
    }
    
    // Category filter
    if (activeCategory !== 'All' && t.category !== activeCategory) return false;
    
    // Tag filters (scene, model, mood, holiday)
    if (activeScene !== 'All' && t.scene !== activeScene) return false;
    if (activeModel !== 'All' && t.model !== activeModel) return false;
    if (activeMood !== 'All' && t.mood !== activeMood) return false;
    if (activeHoliday !== 'All' && t.holiday !== activeHoliday) return false;
    
    return true;
  });

  // Handle template click - check Pro status
  const handleTemplateClick = (template: Template) => {
    // Check if Pro template and user is not Pro
    if (template.isPro && user?.plan !== 'Pro') {
      setSelectedTemplateForModal(template);
      setModalType('upgrade');
      return;
    }
    
    // Save browsing state before navigating
    saveBrowsingState({
      scrollY: window.scrollY,
      category: activeCategory,
      searchQuery: search,
      lastViewedTemplate: template.id
    });
    
    // Navigate to Modify page with template
    navigate('/modify', { 
      state: { 
        initialImage: template.imageUrl,
        initialImageSource: { templateId: template.id, templateName: template.name }
      } 
    });
  };

  // Share functionality
  const handleShare = (template: Template, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTemplateForModal(template);
    setModalType('share');
  };

  const copyShareLink = () => {
    if (selectedTemplateForModal) {
      const shareUrl = `${window.location.origin}/#/template/${selectedTemplateForModal.id}`;
      navigator.clipboard.writeText(shareUrl);
      addToast('success', 'Link copied to clipboard!');
      setModalType(null);
    }
  };

  // Collection functionality
  const handleCollect = (template: Template, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      navigate('/login');
      return;
    }
    setSelectedTemplateForModal(template);
    setModalType('collect');
  };

  const handleAddToCollection = async (collectionId: string) => {
    if (selectedTemplateForModal) {
      await addToCollection(collectionId, selectedTemplateForModal.id);
      addToast('success', 'Added to collection!');
      setModalType(null);
    }
  };

  const handleCreateAndAdd = async () => {
    if (newCollectionName.trim() && selectedTemplateForModal) {
      const newCollection = await createCollection(newCollectionName.trim());
      if (newCollection) {
        await addToCollection(newCollection.id, selectedTemplateForModal.id);
        addToast('success', `Added to "${newCollectionName}"!`);
      }
      setNewCollectionName('');
      setIsCreatingCollection(false);
      setModalType(null);
    }
  };

  // Reset all filters
  const resetFilters = () => {
    setActiveScene('All');
    setActiveModel('All');
    setActiveMood('All');
    setActiveHoliday('All');
  };

  const hasActiveFilters = activeScene !== 'All' || activeModel !== 'All' || activeMood !== 'All' || activeHoliday !== 'All';

  return (
    <div className="min-h-screen pt-20 px-4 pb-12 bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      {/* Search and Category Section */}
      <div 
        ref={searchContainerRef}
        className={`sticky top-16 z-30 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md py-4 -mx-4 px-4 transition-all duration-300 ${
          showSearchBar ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Search Bar */}
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              className={`w-full pl-12 pr-4 py-3 rounded-2xl border bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 transition-all duration-300 outline-none ${
                isSearchFocused 
                  ? 'border-purple-500 ring-4 ring-purple-500/20 shadow-lg' 
                  : 'border-slate-200 dark:border-white/10 hover:border-purple-300 dark:hover:border-purple-500/30'
              }`}
            />
          </div>

          {/* Category Pills */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide justify-center flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  activeCategory === cat
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-900/20'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-purple-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-white/10'
                }`}
              >
                {cat}
              </button>
            ))}
            
            {/* Filter Toggle Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
                showFilters || hasActiveFilters
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-300 dark:border-purple-500/30'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-purple-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-white/10'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filters
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-purple-500" />
              )}
            </button>
          </div>

          {/* Advanced Filters Panel */}
          {showFilters && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-white/10 space-y-4 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Advanced Filters</h3>
                {hasActiveFilters && (
                  <button
                    onClick={resetFilters}
                    className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-500"
                  >
                    Reset all
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Scene Filter */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Scene</label>
                  <div className="flex flex-wrap gap-1">
                    {scenes.map(scene => (
                      <button
                        key={scene}
                        onClick={() => setActiveScene(scene)}
                        className={`px-2 py-1 rounded-md text-xs transition-all ${
                          activeScene === scene
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-purple-900/30'
                        }`}
                      >
                        {scene}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Model Filter */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Model</label>
                  <div className="flex flex-wrap gap-1">
                    {models.map(model => (
                      <button
                        key={model}
                        onClick={() => setActiveModel(model)}
                        className={`px-2 py-1 rounded-md text-xs transition-all ${
                          activeModel === model
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-purple-900/30'
                        }`}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mood Filter */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Mood</label>
                  <div className="flex flex-wrap gap-1">
                    {moods.map(mood => (
                      <button
                        key={mood}
                        onClick={() => setActiveMood(mood)}
                        className={`px-2 py-1 rounded-md text-xs transition-all ${
                          activeMood === mood
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-purple-900/30'
                        }`}
                      >
                        {mood}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Holiday Filter */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-500">Holiday</label>
                  <div className="flex flex-wrap gap-1">
                    {holidays.map(holiday => (
                      <button
                        key={holiday}
                        onClick={() => setActiveHoliday(holiday)}
                        className={`px-2 py-1 rounded-md text-xs transition-all ${
                          activeHoliday === holiday
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-purple-900/30'
                        }`}
                      >
                        {holiday}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Templates Grid - Masonry Layout */}
      <div className="max-w-7xl mx-auto mt-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-500 dark:text-slate-400">No templates found</p>
          </div>
        ) : (
        <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 max-w-[1600px] mx-auto space-y-4">
          {filteredTemplates.map((t) => (
            <div
              key={t.id}
              onClick={() => handleTemplateClick(t)}
              className="group relative break-inside-avoid rounded-2xl overflow-hidden cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/5 hover:border-purple-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-900/10"
            >
              <div className="relative">
                {/* 🔧 修复：传入 width 和 height */}
                <LazyImage
                  src={t.thumbUrl || t.imageUrl}
                  alt={t.name}
                  width={t.width}
                  height={t.height}
                  className="w-full h-auto object-cover transform transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                
                {/* Pro Badge */}
                {t.isPro && (
                  <div className="absolute top-3 right-3 z-20">
                    <div className="px-2 py-1 rounded-md bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg flex items-center gap-1">
                      <Crown className="w-3 h-3 text-white" />
                      <span className="text-[10px] font-bold text-white">PRO</span>
                    </div>
                  </div>
                )}

                {/* Hover Actions */}
                <div className="absolute bottom-3 left-3 right-3 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
                  <button
                    onClick={(e) => handleCollect(t, e)}
                    className="p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/40 transition-colors"
                  >
                    <Heart className="w-4 h-4 text-white" />
                  </button>
                  <button
                    onClick={(e) => handleShare(t, e)}
                    className="p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/40 transition-colors"
                  >
                    <Share2 className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* Share Modal */}
      <Modal
        isOpen={modalType === 'share'}
        onClose={() => setModalType(null)}
        title="Share Template"
      >
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-400">
            Share this template with others
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={selectedTemplateForModal ? `${window.location.origin}/#/template/${selectedTemplateForModal.id}` : ''}
              className="flex-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm"
            />
            <Button variant="gradient" onClick={copyShareLink}>
              Copy
            </Button>
          </div>
        </div>
      </Modal>

      {/* Collect Modal */}
      <Modal
        isOpen={modalType === 'collect'}
        onClose={() => {
          setModalType(null);
          setIsCreatingCollection(false);
          setNewCollectionName('');
        }}
        title="Add to Collection"
      >
        <div className="space-y-4">
          {/* Existing Collections */}
          {collections.length > 0 && (
            <div className="space-y-2">
              {collections.map(col => (
                <button
                  key={col.id}
                  onClick={() => handleAddToCollection(col.id)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 hover:border-purple-500/50 hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-colors"
                >
                  <span className="text-slate-900 dark:text-white font-medium">{col.name}</span>
                  <span className="text-slate-400 text-sm">{col.imageIds.length} items</span>
                </button>
              ))}
            </div>
          )}

          {/* Create New Collection */}
          {isCreatingCollection ? (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Collection name..."
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                className="flex-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none"
                autoFocus
              />
              <Button variant="gradient" onClick={handleCreateAndAdd} disabled={!newCollectionName.trim()}>
                <Check className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setIsCreatingCollection(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/10 hover:border-purple-500/50 text-slate-500 hover:text-purple-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create new collection
            </button>
          )}
        </div>
      </Modal>

      {/* Upgrade Modal */}
      <Modal
        isOpen={modalType === 'upgrade'}
        onClose={() => setModalType(null)}
        title="Pro Template"
      >
        <div className="space-y-4 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-r from-purple-600 to-pink-600 flex items-center justify-center">
            <Crown className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Unlock Pro Templates
          </h3>
          <p className="text-slate-600 dark:text-slate-400">
            This template is only available for Pro users. Upgrade to access all premium templates and features.
          </p>
          <Button variant="gradient" className="w-full" onClick={() => navigate('/pricing')}>
            Upgrade to Pro
          </Button>
        </div>
      </Modal>
    </div>
  );
};