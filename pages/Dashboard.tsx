import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Clock, FolderHeart, Settings as SettingsIcon, Download, Trash2, Maximize2, X, Edit, Crown, Zap, Image as ImageIcon, TrendingUp, Plus, ArrowLeft, ExternalLink } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Generation, Collection, Template } from '../types';
import { mockTemplates } from '../data/mockData';

export const Dashboard = () => {
  const navigate = useNavigate();
  const { user, generations, deleteGeneration, addToast, collections, createCollection, deleteCollection, removeFromCollection } = useStore();
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'collections'>('overview');
  const [selectedImage, setSelectedImage] = useState<Generation | null>(null);

  // Collections State
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  // Delete State
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  // Sort generations by newest first
  const sortedGenerations = [...generations].sort((a, b) => b.createdAt - a.createdAt);

  if (!user) {
    navigate('/login');
    return null;
  }

  const handleDelete = (id: string) => {
    setItemToDelete(id);
  };

  const confirmDelete = () => {
    if (itemToDelete) {
      deleteGeneration(itemToDelete);
      // If the deleted image was open in lightbox, close it
      if (selectedImage?.id === itemToDelete) {
        setSelectedImage(null);
      }
      addToast('success', 'Image deleted from history');
      setItemToDelete(null);
    }
  };

  const handleCreateCollection = () => {
     if (newCollectionName.trim()) {
         createCollection(newCollectionName.trim());
         setIsCreatingCollection(false);
         setNewCollectionName('');
     }
  };

  const activeCollection = collections.find(c => c.id === activeCollectionId);

  // Helper to get template objects from IDs
  const getCollectionItems = (col: Collection): Template[] => {
      return col.imageIds.map(id => mockTemplates.find(t => t.id === id)).filter(Boolean) as Template[];
  };

  // Reusable Grid Item Component
  const GenerationCard: React.FC<{ gen: Generation; aspect?: string; onClick: () => void }> = ({ gen, aspect = "aspect-square", onClick }) => (
    <div 
        className={`group relative rounded-xl overflow-hidden cursor-pointer bg-slate-800 border border-white/5 hover:border-purple-500/50 transition-all shadow-md hover:shadow-xl hover:shadow-purple-900/20 ${aspect}`} 
        onClick={onClick}
    >
        <img src={gen.imageUrl} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" loading="lazy" alt={gen.templateName} />
        
        {/* Template Name Tag - Purple Badge */}
        <div className="absolute top-3 left-3 z-20">
            <div className="px-2.5 py-1 rounded-md bg-purple-600/90 backdrop-blur-md border border-purple-400/30 shadow-lg shadow-purple-900/20">
                <p className="text-[10px] font-bold text-white uppercase tracking-wider truncate max-w-[120px] shadow-sm">
                    {gen.templateName || 'Template'}
                </p>
            </div>
        </div>

        {/* Hover Overlay with Actions */}
        <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-3 backdrop-blur-[2px] z-30">
            <Button size="sm" variant="gradient" onClick={(e) => { e.stopPropagation(); navigate(`/template/${gen.templateId}`); }}>
                <Edit className="w-3 h-3 mr-2" /> Edit in Studio
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
            <div className="flex justify-between items-end">
                <div className="min-w-0">
                   <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mb-0.5">Created</p>
                   <p className="text-xs text-slate-200 font-medium">{new Date(gen.createdAt).toLocaleDateString()}</p>
                </div>
            </div>
        </div>
    </div>
  );

  return (
    <div className="min-h-screen pt-16 flex">
      {/* Sidebar */}
      <div className="w-64 fixed left-0 top-16 bottom-0 bg-slate-900 border-r border-white/5 hidden md:flex flex-col p-4">
        <div className="space-y-1">
           {[
             { id: 'overview', icon: LayoutGrid, label: 'Overview' },
             { id: 'history', icon: Clock, label: 'History' },
             { id: 'collections', icon: FolderHeart, label: 'Collections' },
           ].map(item => (
             <button
              key={item.id}
              onClick={() => { setActiveTab(item.id as any); setActiveCollectionId(null); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === item.id 
                  ? 'bg-white text-slate-900 shadow-lg' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
             >
               <item.icon className="w-4 h-4" />
               {item.label}
             </button>
           ))}
        </div>
        
        <div className="mt-auto">
           <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-all">
             <SettingsIcon className="w-4 h-4" /> Settings
           </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 md:ml-64 p-6 md:p-10">
        <h2 className="text-2xl font-bold text-white mb-6 capitalize flex items-center gap-3">
            {activeCollectionId && activeTab === 'collections' ? (
                <>
                    <button onClick={() => setActiveCollectionId(null)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
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
               <div className="relative overflow-hidden group p-6 rounded-2xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-slate-900/50 to-slate-900 backdrop-blur-xl transition-all hover:border-purple-500/30">
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20">
                        <Crown className="w-6 h-6 text-purple-400" />
                      </div>
                      <span className="text-xs font-semibold text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-500/20">Active</span>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm font-medium mb-1">Current Plan</p>
                      <h3 className="text-3xl font-bold text-white tracking-tight">{user.plan}</h3>
                    </div>
                  </div>
                  <div className="absolute -right-6 -top-6 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl" />
               </div>

               {/* Credits Card */}
               <div className="relative overflow-hidden group p-6 rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/10 via-slate-900/50 to-slate-900 backdrop-blur-xl transition-all hover:border-blue-500/30">
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20">
                        <Zap className="w-6 h-6 text-blue-400" />
                      </div>
                      <span className="text-xs font-medium text-slate-400 bg-slate-800/50 px-2 py-1 rounded-lg border border-white/5">
                        {Math.round((user.credits / user.maxCredits) * 100)}% Left
                      </span>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm font-medium mb-1">Credits Remaining</p>
                      <div className="flex items-baseline gap-2">
                         <h3 className="text-3xl font-bold text-white tracking-tight">{user.credits}</h3>
                         <span className="text-sm text-slate-500 font-medium">/ {user.maxCredits}</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full mt-4 overflow-hidden border border-white/5">
                         <div className="h-full bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full" style={{ width: `${(user.credits / user.maxCredits) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                   <div className="absolute -right-6 -top-6 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
               </div>

               {/* Stats Card */}
               <div className="relative overflow-hidden group p-6 rounded-2xl border border-white/10 bg-gradient-to-br from-pink-500/10 via-slate-900/50 to-slate-900 backdrop-blur-xl transition-all hover:border-pink-500/30">
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-2.5 bg-pink-500/10 rounded-xl border border-pink-500/20">
                        <ImageIcon className="w-6 h-6 text-pink-400" />
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                         <TrendingUp className="w-3 h-3" /> +12 this week
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm font-medium mb-1">Total Creations</p>
                      <h3 className="text-3xl font-bold text-white tracking-tight">{generations.length}</h3>
                    </div>
                  </div>
                  <div className="absolute -right-6 -top-6 w-32 h-32 bg-pink-500/10 rounded-full blur-3xl" />
               </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-semibold text-white">Recent Generations</h3>
                 <button onClick={() => setActiveTab('history')} className="text-sm text-purple-400 hover:text-purple-300">View All</button>
              </div>
              
              {sortedGenerations.length === 0 ? (
                <div className="text-center py-16 glass-panel rounded-2xl border-dashed border-white/20">
                  <p className="text-slate-500 mb-4">No images generated yet.</p>
                  <Button variant="ghost" className="text-purple-400" onClick={() => navigate('/')}>Start Creating</Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                   {/* Show top 8 recent images */}
                   {sortedGenerations.slice(0, 8).map(gen => (
                     <GenerationCard 
                        key={gen.id} 
                        gen={gen} 
                        onClick={() => navigate(`/template/${gen.templateId}`)} // Overview: Click -> Navigate
                     />
                   ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
           <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 animate-in fade-in">
             {sortedGenerations.map(gen => (
                <GenerationCard 
                    key={gen.id} 
                    gen={gen} 
                    aspect="aspect-[4/5]" 
                    onClick={() => setSelectedImage(gen)} // History: Click -> Lightbox
                />
             ))}
             {sortedGenerations.length === 0 && (
                <div className="col-span-full text-center py-20 text-slate-500">No history found.</div>
             )}
           </div>
        )}

        {activeTab === 'collections' && (
          <>
            {!activeCollectionId ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in">
                    <div 
                        onClick={() => setIsCreatingCollection(true)}
                        className="glass-panel border-dashed border-white/20 rounded-2xl flex flex-col items-center justify-center p-8 cursor-pointer hover:bg-white/5 transition-colors group h-48"
                    >
                        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-purple-500/20 transition-colors">
                            <Plus className="w-6 h-6 text-slate-400 group-hover:text-purple-400" />
                        </div>
                        <p className="text-slate-300 font-medium">New Collection</p>
                    </div>

                    {collections.map(col => {
                        const items = getCollectionItems(col);
                        const previews = items.slice(0, 4);
                        
                        return (
                            <div key={col.id} onClick={() => setActiveCollectionId(col.id)} className="glass-panel p-4 rounded-2xl group cursor-pointer hover:border-purple-500/30 transition-all relative">
                                <div className="grid grid-cols-2 gap-2 mb-4 h-32">
                                    {previews.length > 0 ? previews.map((item, idx) => (
                                         <div key={idx} className="bg-slate-800 rounded-lg overflow-hidden relative">
                                             <img src={item.imageUrl} className="w-full h-full object-cover" alt="preview" />
                                         </div>
                                    )) : (
                                         <div className="col-span-2 bg-white/5 rounded-lg flex items-center justify-center text-slate-500 text-xs">Empty</div>
                                    )}
                                </div>
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-white group-hover:text-purple-400 transition-colors">{col.name}</h4>
                                    <span className="text-xs text-slate-500">{col.imageIds.length} items</span>
                                </div>
                                <button 
                                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-all z-10"
                                    onClick={(e) => { e.stopPropagation(); if(confirm('Delete this collection?')) deleteCollection(col.id); }}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                    {activeCollection && getCollectionItems(activeCollection).length === 0 ? (
                        <div className="text-center py-20 text-slate-500">
                             <p>This collection is empty.</p>
                             <Button variant="ghost" onClick={() => navigate('/')} className="mt-4">Browse Templates</Button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {activeCollection && getCollectionItems(activeCollection).map(item => (
                                <div key={item.id} className="group relative rounded-xl overflow-hidden cursor-pointer bg-slate-800 border border-white/5 hover:border-purple-500/50 transition-all">
                                    <img 
                                        src={item.imageUrl} 
                                        onClick={() => navigate(`/template/${item.id}`)}
                                        className="w-full aspect-square object-cover" 
                                        loading="lazy" 
                                    />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
                                        <span className="text-xs font-medium text-white bg-black/50 px-2 py-1 rounded backdrop-blur-md">Edit Template</span>
                                    </div>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); removeFromCollection(activeCollection.id, item.id); }}
                                        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
          </>
        )}
      </div>

      {/* Create Collection Modal */}
      <Modal isOpen={isCreatingCollection} onClose={() => setIsCreatingCollection(false)} title="New Collection">
           <div className="space-y-4">
               <div className="space-y-2">
                   <label className="text-sm font-medium text-slate-300">Collection Name</label>
                   <input 
                      autoFocus
                      type="text" 
                      value={newCollectionName}
                      onChange={e => setNewCollectionName(e.target.value)}
                      placeholder="e.g. Summer Campaign"
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 outline-none"
                      onKeyDown={e => e.key === 'Enter' && handleCreateCollection()}
                   />
               </div>
               <div className="flex gap-3">
                   <Button variant="secondary" className="flex-1" onClick={() => setIsCreatingCollection(false)}>Cancel</Button>
                   <Button variant="gradient" className="flex-1" onClick={handleCreateCollection}>Create Collection</Button>
               </div>
           </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="Delete Image">
          <div className="space-y-6">
              <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                      <Trash2 className="w-6 h-6 text-red-500" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Delete Generation?</h3>
                  <p className="text-slate-400 text-sm">
                      Are you sure you want to delete this image? <br/>
                      <span className="text-red-400 font-medium">This action cannot be undone.</span>
                  </p>
              </div>
              <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" onClick={() => setItemToDelete(null)}>Cancel</Button>
                  <Button variant="danger" className="flex-1" onClick={confirmDelete}>Delete Permanently</Button>
              </div>
          </div>
      </Modal>

      {/* Lightbox Modal for Dashboard */}
      {selectedImage && (
        <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-xl flex items-center justify-center animate-in fade-in duration-200" onClick={() => setSelectedImage(null)}>
           <div className="absolute top-6 right-6 flex gap-4 z-50">
              <button 
                className="p-3 rounded-full bg-white/10 hover:bg-white text-white hover:text-black transition-colors backdrop-blur-md border border-white/10"
                onClick={(e) => { e.stopPropagation(); navigate(`/template/${selectedImage.templateId}`); setSelectedImage(null); }}
                title="Edit Template"
              >
                  <Edit className="w-5 h-5" />
              </button>
              <button 
                className="p-3 rounded-full bg-white/10 hover:bg-red-500 text-white transition-colors backdrop-blur-md border border-white/10"
                onClick={(e) => { e.stopPropagation(); handleDelete(selectedImage.id); }}
                title="Delete Image"
              >
                  <Trash2 className="w-5 h-5" />
              </button>
              <button className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md border border-white/10" onClick={() => setSelectedImage(null)}>
                  <X className="w-5 h-5" />
              </button>
           </div>
           
           <div className="max-w-6xl w-full p-4 flex flex-col md:flex-row gap-8 items-center justify-center" onClick={e => e.stopPropagation()}>
               <div className="relative flex-1 flex items-center justify-center max-h-[80vh]">
                    <img src={selectedImage.imageUrl} className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl" />
               </div>
               
               <div className="glass-panel p-6 rounded-2xl w-full md:w-80 flex flex-col gap-4 bg-slate-900/50 border border-white/10">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <ImageIcon className="w-5 h-5 text-purple-400" /> Image Details
                    </h3>
                    
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Template</span>
                            <div className="flex items-center gap-2 group cursor-pointer p-2 rounded-lg bg-white/5 hover:bg-purple-500/10 border border-white/5 hover:border-purple-500/30 transition-all" onClick={() => navigate(`/template/${selectedImage.templateId}`)}>
                                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                <p className="text-sm text-white font-medium group-hover:text-purple-300 transition-colors flex-1">{selectedImage.templateName || 'Unknown Template'}</p>
                                <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-purple-400" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Prompt</span>
                            <p className="text-sm text-slate-300 italic bg-black/30 p-3 rounded-lg border border-white/5">"{selectedImage.prompt}"</p>
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Created</span>
                            <p className="text-sm text-slate-300 font-mono">{new Date(selectedImage.createdAt).toLocaleString()}</p>
                        </div>
                    </div>
                  </div>
                  
                  <div className="mt-auto space-y-3 pt-6 border-t border-white/10">
                    <Button variant="gradient" className="w-full" onClick={() => { navigate(`/template/${selectedImage.templateId}`); }}>
                        <Edit className="w-4 h-4 mr-2" /> Edit in Studio
                    </Button>
                    <Button variant="secondary" className="w-full" onClick={() => addToast('success', 'Image saved to device')}>
                        <Download className="w-4 h-4 mr-2" /> Download High Res
                    </Button>
                  </div>
               </div>
           </div>
        </div>
      )}
    </div>
  );
};