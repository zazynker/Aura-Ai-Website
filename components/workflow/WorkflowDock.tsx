import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripHorizontal, Sparkles, Image as ImageIcon, WandSparkles, Eye, X, Minus } from 'lucide-react';
import { useWorkflowState, setActiveStep, setWorkflowMinimized, WorkflowStep, clearWorkflow, queueWorkflowHandoff, type WorkflowHandoffAction } from './workflowManager';
import { useStore } from '../../context/StoreContext';

export const WorkflowDock = () => {
  const { steps, activeStepId, minimized, runId } = useWorkflowState();
  const navigate = useNavigate();
  const { addToast } = useStore();

  const [position, setPosition] = useState({ x: 24, y: window.innerHeight - 300 });
  const [isDragging, setIsDragging] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // The step whose small beads are currently expanded
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  
  // For modal
  const [modalStep, setModalStep] = useState<WorkflowStep | null>(null);

  // WorkflowDock stays mounted when a workflow is cleared; it only renders
  // null while there are no steps. Reset transient state whenever the bound
  // run changes so a successful cancel cannot leave the next run's X button
  // disabled.
  useEffect(() => {
    setIsCancelling(false);
    setExpandedStepId(steps?.[0]?.id || null);
    setModalStep(null);
  }, [runId]);

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

  useEffect(() => {
    if (!modalStep) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalStep(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [modalStep]);

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

  const handleBeadClick = async (step: WorkflowStep) => {
    setExpandedStepId(step.id);
    try {
      await setActiveStep(step.id);
      const handoff = queueWorkflowHandoff(step, 'all');
      const separator = step.targetRoute.includes('?') ? '&' : '?';
      navigate(`${step.targetRoute}${separator}workflowAction=all&workflowNonce=${encodeURIComponent(handoff.nonce)}`);
    } catch (error) {
      addToast(
        'error',
        error instanceof Error ? error.message : 'Could not open this workflow step.',
      );
    }
  };

  const handleBeadHover = (stepId: string) => {
    if (!isDragging) {
      setExpandedStepId(stepId);
    }
  };

  const openWorkflowAction = async (step: WorkflowStep, action: WorkflowHandoffAction) => {
    if (action === 'materials' && (step.materials || []).length === 0) return;
    try {
      await setActiveStep(step.id);
      const handoff = queueWorkflowHandoff(step, action);
      const separator = step.targetRoute.includes('?') ? '&' : '?';
      navigate(`${step.targetRoute}${separator}workflowAction=${action}&workflowNonce=${encodeURIComponent(handoff.nonce)}`);
    } catch (error) {
      addToast(
        'error',
        error instanceof Error ? error.message : 'Could not reuse this workflow step.',
      );
    }
  };

  const handleViewResult = (step: WorkflowStep) => {
    setModalStep(step);
  };

  const handleCancelWorkflow = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await clearWorkflow(true);
      addToast('info', 'Workflow cancelled. Your run history was kept.');
    } catch (error) {
      addToast(
        'error',
        error instanceof Error ? error.message : 'Could not cancel this workflow.',
      );
      setIsCancelling(false);
    }
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
            onClick={(e) => { e.stopPropagation(); void handleCancelWorkflow(); }}
            disabled={isCancelling}
            title="Cancel workflow"
            aria-label="Cancel workflow and close dock"
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
            const statusClass = step.status === 'completed'
              ? 'bg-emerald-500 ring-4 ring-emerald-200 dark:ring-emerald-900/50'
              : step.status === 'failed'
                ? 'bg-red-500 ring-4 ring-red-200 dark:ring-red-900/50'
                : isActive
                  ? 'bg-pink-500 ring-4 ring-pink-200 dark:ring-pink-900/50 shadow-lg shadow-pink-500/40 animate-[pulse_3s_ease-in-out_infinite]'
                  : 'bg-pink-400 hover:bg-pink-500 hover:scale-105';

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
                    onClick={() => { void handleBeadClick(step); }}
                    onFocus={() => handleBeadHover(step.id)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium text-sm transition-all duration-300 relative ${statusClass}`}
                    aria-label={`Step ${step.stepNumber}: ${step.feature} (${step.status})`}
                  >
                    {step.stepNumber}
                  </button>

                  {/* Small Beads Container */}
                  <div className={`absolute top-1/2 -translate-y-1/2 left-full ml-3 flex items-center gap-2 transition-all duration-300 ${
                    isExpanded 
                      ? 'opacity-100 translate-x-0 scale-100 pointer-events-auto' 
                      : 'opacity-0 -translate-x-4 scale-75 pointer-events-none'
                  }`}>
                    {/* Purple Bead (Step Details) */}
                    <button
                      className="w-8 h-8 rounded-full bg-purple-500 hover:bg-purple-400 hover:scale-110 text-white flex items-center justify-center shadow-md transition-all group/btn cursor-pointer"
                      onClick={() => handleViewResult(step)}
                      aria-label="View this step's details"
                      tabIndex={isExpanded ? 0 : -1}
                    >
                      <Eye className="w-4 h-4" />
                      <div className="absolute left-1/2 -translate-x-1/2 -top-8 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity">
                        View step details
                      </div>
                    </button>
                    
                    {/* Yellow Bead (Materials) */}
                    <button
                      className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-all group/btn ${
                        step.reusableMaterials 
                          ? 'bg-amber-500 hover:bg-amber-400 hover:scale-110 text-white cursor-pointer' 
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                      }`}
                      onClick={() => { void openWorkflowAction(step, 'materials'); }}
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
                      onClick={() => { void openWorkflowAction(step, 'prompt'); }}
                      aria-label="Reuse template's prompt"
                      tabIndex={isExpanded ? 0 : -1}
                    >
                      <WandSparkles className="w-4 h-4" />
                      <div className="absolute left-1/2 -translate-x-1/2 -top-8 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity">
                        Reuse template's prompt
                      </div>
                    </button>

                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Scrollable step details; media never forces browser fullscreen. */}
      {modalStep && (
        <div
          className="fixed inset-0 z-[110] overflow-y-auto bg-black/95 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModalStep(null);
          }}
        >
          <div className="mx-auto min-h-full w-full max-w-5xl px-4 py-8 sm:px-6">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 text-white shadow-2xl">
              <header className="sticky top-0 z-20 flex items-start justify-between border-b border-white/10 bg-zinc-950/95 px-5 py-4 backdrop-blur">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-400">Step {modalStep.stepNumber}</p>
                  <h2 className="mt-1 text-xl font-semibold">{modalStep.feature}</h2>
                  <p className="mt-1 text-sm text-white/55">
                    {modalStep.targetRoute.startsWith('/video') ? 'Video creation page' : 'Image creation page'} · {modalStep.capability}
                  </p>
                </div>
                <button onClick={() => setModalStep(null)} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Close step details">
                  <X className="h-6 w-6" />
                </button>
              </header>

              <div className="space-y-5 p-5">
                <div className="space-y-5">
                  <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">Materials uploaded</h3>
                    {(modalStep.materials || []).length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(modalStep.materials || []).map((material) => (
                          <div key={material.id} className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
                            <div className="flex h-36 items-center justify-center bg-black/60">
                              {material.type === 'image' ? (
                                <img src={material.url} alt={material.name} className="h-full w-full object-contain" />
                              ) : material.type === 'video' ? (
                                <video src={material.url} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                              ) : (
                                <audio src={material.url} controls preload="metadata" className="w-[90%]" />
                              )}
                            </div>
                            <div className="px-3 py-2">
                              <p className="truncate text-sm font-medium">{material.name || `${material.type} material`}</p>
                              <p className="mt-0.5 text-xs text-white/45">{material.type}{material.slot ? ` · ${material.slot}` : ''}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/45">This step has no reusable uploaded materials.</p>
                    )}
                  </section>

                  <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">Prompt</h3>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-white/90">{modalStep.prompt || 'No prompt was saved for this step.'}</p>
                  </section>

                  {Object.keys(modalStep.settings || {}).filter((key) => key !== 'prompt').length > 0 && (
                    <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">Settings</h3>
                      <dl className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(modalStep.settings).filter(([key]) => key !== 'prompt').map(([key, value]) => (
                          <div key={key} className="rounded-lg bg-black/35 px-3 py-2">
                            <dt className="text-xs text-white/45">{key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())}</dt>
                            <dd className="mt-1 break-words text-sm text-white/90">
                              {typeof value === 'boolean' ? (value ? 'On' : 'Off') : Array.isArray(value) ? value.join(', ') : String(value ?? '—')}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  )}
                </div>

                <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">Final result from this step</h3>
                  {modalStep.result?.url ? (
                    modalStep.result.type === 'video' ? (
                      <video src={modalStep.result.url} controls playsInline preload="metadata" className="mx-auto max-h-[65vh] w-full rounded-lg bg-black object-contain" />
                    ) : (
                      <img src={modalStep.result.url} alt={`Step ${modalStep.stepNumber} result`} className="mx-auto max-h-[65vh] w-full rounded-lg bg-black object-contain" />
                    )
                  ) : (
                    <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-white/15 bg-black/30 px-6 text-center text-sm text-white/45">
                      This step has not produced a final result yet.
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
