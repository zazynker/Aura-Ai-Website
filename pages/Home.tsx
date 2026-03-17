
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Heart, Share2, Crown, Plus, Check, Loader2 } from 'lucide-react';
import { fetchTemplates, fetchCategories } from '../utils/api';
import { useStore } from '../context/StoreContext';
import { Template } from '../types';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';

export const Home = () => {
  const navigate = useNavigate();
  const { browsing, saveBrowsingState, addToast, user, collections, addToCollection, createCollection } = useStore();
  
  // Templates State
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>(['All']);
  
  // Search & Filter State
  const [search, setSearch] = useState(browsing.searchQuery);
  const [activeCategory, setActiveCategory] = useState(browsing.category);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  
  // Modal State
  const [selectedTemplateForModal, setSelectedTemplateForModal] = useState<Template | null>(null);
  const [modalType, setModalType] = useState<'share' | 'collect' | 'upgrade' | null>(null);
  
  // Create Collection State inside Modal
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  // Search Bar Interaction State
  const [showSearchBar, setShowSearchBar] = useState(true);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const lastScrollY = useRef(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch categories on mount
  useEffect(() => {
    const loadCategories = async () => {
      const cats = await fetchCategories();
      setCategories(cats);
    };
    loadCategories();
  }, []);

  // Fetch templates when search or category changes
  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    const result = await fetchTemplates({
      search: debouncedSearch,
      category: activeCategory,
      limit: 100,
    });
    
    if (result.error) {
      setError(result.error);
      setTemplates([]);
    } else {
      setTemplates(result.templates);
    }
    
    setIsLoading(false);
  }, [debouncedSearch, activeCategory]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Restore scroll position
  useEffect(() => {
    if (!isLoading && templates.length > 0) {
      window.scrollTo(0, browsing.scrollY);
    }
  }, [isLoading, templates.length]); 

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

  const handleTemplateClick = (t: Template) => {
    // Login Check
    if (!user) {
      saveBrowsingState({ 
        scrollY: window.scrollY, 
        searchQuery: search, 
        category: activeCategory, 
        lastViewedTemplate: t.id,
        intendedDestination: '/modify'
      });
      // Store template info for after login
      sessionStorage.setItem('pendingTemplate', JSON.stringify({
        imageUrl: t.imageUrl,
        templateId: t.id,
        templateName: t.name
      }));
      navigate('/login');
      return;
    }

    // Pro Permission Check
    const isProUser = user?.plan === 'Pro' || user?.plan === 'Enterprise';
    if (t.isPro && !isProUser) {
      setModalType('upgrade');
      return;
    }

    saveBrowsingState({ scrollY: window.scrollY, searchQuery: search, category: activeCategory, lastViewedTemplate: t.id });
    
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
      navigate('/login');
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      
      {/* Fixed Search Bar */}
      <div 
        ref={searchContainerRef}
        className={`fixed top-16 left-0 right-0 z-30 transition-all duration-300 ease-out ${
          showSearchBar ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              placeholder="Search templates (e.g., 'lemon perfume', 'baby skincare')..."
              className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 rounded-full py-2.5 pl-10 pr-6 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:bg-white dark:focus:bg-slate-800 transition-all shadow-inner"
            />
            {isLoading && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-500 animate-spin" />
            )}
          </div>

          {/* Categories - Expandable */}
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
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="pt-44 px-4 md:px-8 pb-12">
        {/* Error State */}
        {error && (
          <div className="max-w-md mx-auto text-center py-12">
            <div className="text-red-500 dark:text-red-400 mb-4">
              <p className="text-lg font-medium">Failed to load templates</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{error}</p>
            </div>
            <Button variant="secondary" onClick={loadTemplates}>
              Try Again
            </Button>
          </div>
        )}

        {/* Loading State */}
        {isLoading && templates.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-4" />
            <p className="text-slate-500 dark:text-slate-400 text-sm">Loading templates...</p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && templates.length === 0 && (
          <div className="text-center py-20">
            <p className="text-slate-500 dark:text-slate-400 text-lg mb-2">No templates found</p>
            <p className="text-slate-400 dark:text-slate-500 text-sm">
              Try adjusting your search or category filter
            </p>
          </div>
        )}

        {/* Templates Grid */}
        {templates.length > 0 && (
          <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 max-w-[1600px] mx-auto space-y-4">
            {templates.map((t) => (
              <div
                key={t.id}
                onClick={() => handleTemplateClick(t)}
                className="group relative break-inside-avoid rounded-2xl overflow-hidden cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/5 hover:border-purple-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-900/10"
              >
                <div className="relative">
                  <img
                    src={t.imageUrl}
                    alt={t.name}
                    loading="lazy"
                    className="w-full h-auto object-cover transform transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  
                  {/* Pro Badge */}
                  {t.isPro && (
                    <div className="absolute top-3 right-3 z-20">
                      <div className="px-2 py-1 rounded-md bg-gradient-to-r from-purple-600 to-pink-600 shadow-lg flex items-center gap-1.5">
                        <Crown className="w-3 h-3 text-white" />
                        <span className="text-[10px] font-bold text-white uppercase tracking-wider">Pro</span>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="absolute top-3 left-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-4 group-hover:translate-x-0 z-10">
                     <button 
                      onClick={(e) => handleAction(e, 'collect', t)}
                      className="p-2 rounded-full glass-panel hover:bg-white text-slate-900 dark:text-white hover:text-pink-500 transition-colors"
                     >
                       <Heart className="w-4 h-4" />
                     </button>
                     <button 
                      onClick={(e) => handleAction(e, 'share', t)}
                      className="p-2 rounded-full glass-panel hover:bg-white text-slate-900 dark:text-white hover:text-blue-500 transition-colors"
                     >
                       <Share2 className="w-4 h-4" />
                     </button>
                  </div>

                  {/* Info Overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300">
                    <h3 className="text-white font-medium truncate text-sm">{t.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-slate-300">{t.category}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Share Modal */}
      <Modal isOpen={modalType === 'share'} onClose={() => setModalType(null)} title="Share Template">
        <div className="space-y-4">
           <p className="text-slate-600 dark:text-slate-300 text-sm">Share this style with your team or social networks.</p>
           <div className="flex gap-2">
             <input readOnly value={`https://lazora.ai/template/${selectedTemplateForModal?.id}`} className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-400" />
             <Button size="sm" onClick={() => { addToast('success', 'Link copied to clipboard!'); setModalType(null); }}>Copy</Button>
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
    </div>
  );
};
