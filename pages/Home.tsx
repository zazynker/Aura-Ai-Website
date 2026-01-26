import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Heart, Share2, Crown, Zap, Plus, Check } from 'lucide-react';
import { mockTemplates } from '../data/mockData';
import { useStore } from '../context/StoreContext';
import { Template } from '../types';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';

export const Home = () => {
  const navigate = useNavigate();
  const { browsing, saveBrowsingState, addToast, user, collections, addToCollection, createCollection } = useStore();
  const [search, setSearch] = useState(browsing.searchQuery);
  const [activeCategory, setActiveCategory] = useState(browsing.category);
  const [selectedTemplateForModal, setSelectedTemplateForModal] = useState<Template | null>(null);
  const [modalType, setModalType] = useState<'share' | 'collect' | 'upgrade' | null>(null);
  
  // Create Collection State inside Modal
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const categories = ['All', 'Cosmetic', 'Food', 'Electronic', 'Fashion', 'Furniture'];

  // Restore scroll position
  useEffect(() => {
    window.scrollTo(0, browsing.scrollY);
  }, []); // Only run on mount

  // Filter Logic
  const filteredTemplates = mockTemplates.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = activeCategory === 'All' || t.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const handleTemplateClick = (t: Template) => {
    // Pro Permission Check
    const isProUser = user?.plan === 'Pro' || user?.plan === 'Enterprise';
    if (t.isPro && !isProUser) {
      setModalType('upgrade');
      return;
    }

    saveBrowsingState({ scrollY: window.scrollY, searchQuery: search, category: activeCategory, lastViewedTemplate: t.id });
    navigate(`/template/${t.id}`);
  };

  const handleAction = (e: React.MouseEvent, type: 'share' | 'collect', t: Template) => {
    e.stopPropagation();
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
      // Optionally auto-add to the new collection immediately? 
      // For now, just create it and let user select it.
      setNewCollectionName('');
      setIsCreatingCollection(false);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-12 px-4 md:px-8">
      {/* Search Header */}
      <div className="max-w-4xl mx-auto mb-12 flex flex-col items-center gap-6">
        <h1 className="text-4xl md:text-5xl font-bold text-center">
          Create <span className="text-gradient">Professional</span> Photos <br className="hidden md:block"/> with AI in Seconnds
        </h1>
        
        <div className="relative w-full max-w-xl group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-slate-500 group-focus-within:text-purple-400 transition-colors" />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates (e.g., 'minimal perfume', 'dark whiskey')..."
            className="w-full bg-white/5 border border-white/10 rounded-full py-4 pl-12 pr-6 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:bg-white/10 transition-all shadow-lg shadow-black/20"
          />
        </div>

        {/* Categories */}
        <div className="flex gap-3 overflow-x-auto max-w-full pb-2 hide-scrollbar mask-linear-fade">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-6 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                activeCategory === cat
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-900/40'
                  : 'bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Masonry Grid Simulation */}
      <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 max-w-[1600px] mx-auto space-y-4">
        {filteredTemplates.map((t) => (
          <div
            key={t.id}
            onClick={() => handleTemplateClick(t)}
            className="group relative break-inside-avoid rounded-2xl overflow-hidden cursor-pointer bg-slate-800 border border-white/5 hover:border-purple-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-purple-900/20"
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
                  className="p-2 rounded-full glass-panel hover:bg-white text-white hover:text-pink-500 transition-colors"
                 >
                   <Heart className="w-4 h-4" />
                 </button>
                 <button 
                  onClick={(e) => handleAction(e, 'share', t)}
                  className="p-2 rounded-full glass-panel hover:bg-white text-white hover:text-blue-500 transition-colors"
                 >
                   <Share2 className="w-4 h-4" />
                 </button>
              </div>

              {/* Info Overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300">
                <h3 className="text-white font-medium truncate">{t.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-400">{t.category}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Share Modal */}
      <Modal isOpen={modalType === 'share'} onClose={() => setModalType(null)} title="Share Template">
        <div className="space-y-4">
           <p className="text-slate-300 text-sm">Share this style with your team or social networks.</p>
           <div className="flex gap-2">
             <input readOnly value={`https://aura.ai/template/${selectedTemplateForModal?.id}`} className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-400" />
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
                className="w-full text-left px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-purple-500/50 transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center">
                     <Heart className={`w-4 h-4 ${isAdded ? 'text-pink-500 fill-pink-500' : 'text-slate-500'}`} />
                   </div>
                   <span className="text-slate-200">{col.name}</span>
                </div>
                {isAdded && <Check className="w-4 h-4 text-green-400" />}
              </button>
             );
           })}
           
           {!isCreatingCollection ? (
             <button 
               onClick={() => setIsCreatingCollection(true)}
               className="w-full py-3 text-sm text-center text-purple-400 hover:text-purple-300 mt-2 border border-dashed border-purple-500/30 rounded-xl hover:bg-purple-500/10 transition-colors flex items-center justify-center gap-2"
              >
               <Plus className="w-4 h-4" /> Create New Collection
             </button>
           ) : (
             <div className="mt-2 p-3 bg-slate-900/50 rounded-xl border border-white/10 animate-in fade-in slide-in-from-top-2">
                <input 
                  autoFocus
                  type="text" 
                  value={newCollectionName}
                  onChange={e => setNewCollectionName(e.target.value)}
                  placeholder="Collection Name..."
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mb-2 focus:ring-1 focus:ring-purple-500 outline-none"
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
             <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 border border-white/10 shadow-xl shadow-purple-900/20">
                <Crown className="w-8 h-8 text-yellow-400" />
             </div>
             <h3 className="text-xl font-bold text-white mb-2">Unlock Pro Templates</h3>
             <p className="text-slate-400 text-sm mb-6">This template is exclusively available on the Pro plan. Upgrade now to access this and 500+ other premium styles.</p>
             
             <div className="flex w-full gap-3">
                 <Button variant="secondary" className="flex-1" onClick={() => setModalType(null)}>Cancel</Button>
                 <Button variant="gradient" className="flex-1" onClick={() => navigate('/pricing')}>Upgrade to Pro</Button>
             </div>
         </div>
      </Modal>
    </div>
  );
};