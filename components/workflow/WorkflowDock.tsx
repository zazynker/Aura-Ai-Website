import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripHorizontal, Sparkles, Image as ImageIcon, WandSparkles, Eye, X, Minus } from 'lucide-react';
import { useWorkflowState, setActiveStep, setWorkflowMinimized, WorkflowStep, clearWorkflow } from './workflowManager';
import { Modal } from '../ui/Modal';
import { useStore } from '../../context/StoreContext';

export const WorkflowDock = () => {
  const { steps, activeStepId, minimized } = useWorkflowState();
  const navigate = useNavigate();
  const { addToast } = useStore();

  const [position, setPosition] = useState({ x: 24, y: window.innerHeight - 300 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // The step whose small beads are currently expanded
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  
  // For modal
  const [modalStep, setModalStep] = useState<WorkflowStep | null>(null);

  useEffect(() => {
    if (steps && steps.length > 0 && !expandedStepId) {
      setExpandedStepId(steps[0].id);
    }
  }, [steps]);

  useEffect(() => {
    const savedPos = sessionStorage.getItem('lazora_dock_position');
    if (savedPos) {
      try {
        const parsed = JSON.parse(savedPos);
        // Ensure within viewport
        const safeX = Math.max(0, Math.min(parsed.x, window.innerWidth - 80));
        const safeY = Math.max(0, Math.min(parsed.y, window.innerHeight - 80));
        setPosition({ x: safeX, y: safeY });
      } catch (e) {}
    }
  }, []);

  if (!steps || steps.length === 0) return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Only left click
    const target = e.target as HTMLElement;
    if (target.closest('.no-drag')) return;
    
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: position.x,
      initY: position.y
    };
    
    if (dockRef.current) {
      dockRef.current.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragRef.current) return;
    
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    
    let newX = dragRef.current.initX + dx;
    let newY = dragRef.current.initY + dy;
    
    // Constrain to viewport
    if (dockRef.current) {
      const rect = dockRef.current.getBoundingClientRect();
      newX = Math.max(0, Math.min(newX, window.innerWidth - rect.width));
      newY = Math.max(0, Math.min(newY, window.innerHeight - rect.height));
    }
    
    setPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    sessionStorage.setItem('lazora_dock_position', JSON.stringify(position));
    if (dockRef.current) {
      dockRef.current.releasePointerCapture(e.pointerId);
    }
    
    // Check if it was just a click (movement < 5px)
    if (dragRef.current) {
      const dx = Math.abs(e.clientX - dragRef.current.startX);
      const dy = Math.abs(e.clientY - dragRef.current.startY);
      if (dx < 5 && dy < 5 && minimized) {
        setWorkflowMinimized(false);
      }
    }
    
    dragRef.current = null;
  };

  const handleBeadClick = (step: WorkflowStep) => {
    if (expandedStepId === step.id) {
      // Navigate on second tap or if already expanded
      setActiveStep(step.id);
      navigate(step.targetRoute);
    } else {
      setExpandedStepId(step.id);
    }
  };

  const handleBeadHover = (stepId: string) => {
    if (!isDragging) {
      setExpandedStepId(stepId);
    }
  };

  const handleMaterialClick = (step: WorkflowStep) => {
    if (step.reusableMaterials) {
      addToast('success', 'Materials ready');
    }
  };

  const handlePromptClick = () => {
    addToast('success', 'Prompt added');
  };

  const handleViewResult = (step: WorkflowStep) => {
    setModalStep(step);
  };

  if (minimized) {
    return (
      <div 
        ref={dockRef}
        className="fixed z-[100] cursor-grab active:cursor-grabbing rounded-full touch-none select-none w-12 h-12 bg-pink-500 shadow-lg flex items-center justify-center hover:scale-110 transition-transform hover:shadow-pink-500/50"
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label="Restore workflow dock"
      >
        <Sparkles className="w-6 h-6 text-white pointer-events-none" />
      </div>
    );
  }

  return (
    <>
      <div 
        ref={dockRef}
        className="fixed z-[100] flex flex-col items-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-md rounded-full p-2 shadow-xl border border-slate-200 dark:border-slate-800 touch-none select-none"
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 mb-2" title="Drag to move">
          <GripHorizontal className="w-4 h-4" />
        </div>

        <div className="absolute top-1 right-1 flex flex-col gap-1">
          <button 
            className="p-1 text-slate-400 hover:text-pink-500 no-drag rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            onClick={(e) => { e.stopPropagation(); clearWorkflow(); }}
            title="Close"
            aria-label="Close workflow dock"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        
        <div className="absolute top-1 left-1 flex flex-col gap-1">
          <button 
            className="p-1 text-slate-400 hover:text-pink-500 no-drag rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            onClick={(e) => { e.stopPropagation(); setWorkflowMinimized(true); }}
            title="Minimize"
            aria-label="Minimize workflow dock"
          >
            <Minus className="w-3 h-3" />
          </button>
        </div>

        <div className="flex flex-col items-center relative py-2">
          {steps.map((step, index) => {
            const isActive = activeStepId === step.id;
            const isExpanded = expandedStepId === step.id;

            return (
              <React.Fragment key={step.id}>
                {/* Connector Line */}
                {index > 0 && <div className="w-0.5 h-6 bg-slate-200 dark:bg-slate-700" />}
                
                <div 
                  className="relative group no-drag"
                  onMouseEnter={() => handleBeadHover(step.id)}
                >
                  {/* Tooltip for large bead */}
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                    Step {step.stepNumber} &middot; {step.feature}
                  </div>

                  {/* Large Bead */}
                  <button
                    onClick={() => handleBeadClick(step)}
                    onFocus={() => handleBeadHover(step.id)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium text-sm transition-all duration-300 relative ${
                      isActive 
                        ? 'bg-pink-500 ring-4 ring-pink-200 dark:ring-pink-900/50 shadow-lg shadow-pink-500/40 animate-[pulse_3s_ease-in-out_infinite]' 
                        : 'bg-pink-400 hover:bg-pink-500 hover:scale-105'
                    }`}
                    aria-label={`Step ${step.stepNumber}: ${step.feature}`}
                  >
                    {step.stepNumber}
                  </button>

                  {/* Small Beads Container */}
                  <div className={`absolute top-1/2 -translate-y-1/2 left-full ml-3 flex items-center gap-2 transition-all duration-300 ${
                    isExpanded 
                      ? 'opacity-100 translate-x-0 scale-100 pointer-events-auto' 
                      : 'opacity-0 -translate-x-4 scale-75 pointer-events-none'
                  }`}>
                    
                    {/* Yellow Bead (Materials) */}
                    <button
                      className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-all group/btn ${
                        step.reusableMaterials 
                          ? 'bg-amber-500 hover:bg-amber-400 hover:scale-110 text-white cursor-pointer' 
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                      }`}
                      onClick={() => handleMaterialClick(step)}
                      aria-label="Reuse template materials"
                      tabIndex={isExpanded ? 0 : -1}
                    >
                      <ImageIcon className="w-4 h-4" />
                      <div className="absolute left-1/2 -translate-x-1/2 -top-8 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity">
                        {step.reusableMaterials ? 'Reuse template materials' : 'No reusable materials'}
                      </div>
                    </button>

                    {/* Green Bead (Prompt) */}
                    <button
                      className="w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-400 hover:scale-110 text-white flex items-center justify-center shadow-md transition-all group/btn cursor-pointer"
                      onClick={handlePromptClick}
                      aria-label="Reuse template's prompt"
                      tabIndex={isExpanded ? 0 : -1}
                    >
                      <WandSparkles className="w-4 h-4" />
                      <div className="absolute left-1/2 -translate-x-1/2 -top-8 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity">
                        Reuse template's prompt
                      </div>
                    </button>

                    {/* Purple Bead (Result) */}
                    <button
                      className="w-8 h-8 rounded-full bg-purple-500 hover:bg-purple-400 hover:scale-110 text-white flex items-center justify-center shadow-md transition-all group/btn cursor-pointer"
                      onClick={() => handleViewResult(step)}
                      aria-label="View step result and details"
                      tabIndex={isExpanded ? 0 : -1}
                    >
                      <Eye className="w-4 h-4" />
                      <div className="absolute left-1/2 -translate-x-1/2 -top-8 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity">
                        View step result and details
                      </div>
                    </button>

                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Full-screen media viewer overlay for step result */}
      {modalStep && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200">
          <button 
            onClick={() => setModalStep(null)}
            className="absolute top-4 right-4 md:top-6 md:right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white z-10"
            aria-label="Close fullscreen view"
          >
            <X className="w-8 h-8" />
          </button>
          
          <div className="w-full h-full flex flex-col items-center justify-center p-4">
            <div className="w-full h-full flex items-center justify-center relative">
              {modalStep.result.type === 'video' ? (
                <video 
                  src={modalStep.result.url} 
                  className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                  controls 
                  autoPlay
                  ref={(el) => {
                    if (el && !document.fullscreenElement) {
                      el.play().catch(console.error);
                      if (el.requestFullscreen) {
                        el.requestFullscreen().catch(console.error);
                      } else if ((el as any).webkitRequestFullscreen) {
                        (el as any).webkitRequestFullscreen();
                      } else if ((el as any).msRequestFullscreen) {
                        (el as any).msRequestFullscreen();
                      }
                    }
                  }}
                  onFullscreenChange={(e) => {
                    if (!document.fullscreenElement && !(document as any).webkitIsFullScreen) {
                      setModalStep(null);
                    }
                  }}
                />
              ) : (
                <img 
                  src={modalStep.result.url} 
                  alt={`Step ${modalStep.stepNumber} result`} 
                  className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" 
                />
              )}
            </div>
            {modalStep.prompt && (
              <div className="mt-4 p-4 bg-white/10 backdrop-blur-md rounded-lg max-w-3xl w-full">
                <h4 className="font-medium text-white/80 mb-2 text-sm uppercase tracking-wider">Prompt</h4>
                <p className="text-sm text-white whitespace-pre-wrap font-mono">
                  {modalStep.prompt}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

