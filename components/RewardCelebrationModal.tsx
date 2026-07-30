import React, { useEffect, useState, useRef } from 'react';
import { Sparkles, Heart } from 'lucide-react';
import { Button } from './ui/Button';
import { useNavigate } from 'react-router-dom';
import type { CreatorRewardCelebration } from '../types';

interface RewardCelebrationModalProps {
  celebration: CreatorRewardCelebration | null;
  onClose: () => void;
}

const describeTemplates = (celebration: CreatorRewardCelebration): string => {
  const names = celebration.templates.slice(0, 2).map((template) => `“${template.templateName}”`);
  if (celebration.templateCount <= 1) return `${names[0] || 'your template'}`;
  const remaining = Math.max(celebration.templateCount - names.length, 0);
  return remaining > 0 ? `${names.join(', ')} and ${remaining} more` : names.join(' and ');
};

const describePeople = (celebration: CreatorRewardCelebration): string => {
  const names = celebration.usernames.slice(0, 2);
  if (names.length === 0) {
    return celebration.userCount === 1 ? 'Someone' : `${celebration.userCount} people`;
  }
  if (celebration.userCount <= 1) return names[0];
  const remaining = Math.max(celebration.userCount - names.length, 0);
  return remaining > 0 ? `${names.join(', ')} and ${remaining} more people` : names.join(' and ');
};

export const RewardCelebrationModal: React.FC<RewardCelebrationModalProps> = ({ celebration, onClose }) => {
  const navigate = useNavigate();
  const [showParticles, setShowParticles] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const isOpen = celebration !== null;
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (isOpen) {
      if (!prefersReducedMotion) {
        setShowParticles(true);
        // Stop particles after 3.5 seconds
        const timer = setTimeout(() => {
          setShowParticles(false);
        }, 3500);
        return () => clearTimeout(timer);
      }
    } else {
      setShowParticles(false);
    }
  }, [isOpen, prefersReducedMotion]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!celebration) return null;

  const personLabel = describePeople(celebration);
  const templateDescription = describeTemplates(celebration);
  const activityDescription = celebration.templateCount === 1
    ? `${personLabel} used your ${templateDescription} template.`
    : `${personLabel} used ${celebration.templateCount} of your templates, including ${templateDescription}.`;
  const canOpenSingleTemplate = celebration.templateCount === 1 && Boolean(celebration.primaryTemplateId);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto">
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      
      {showParticles && <ParticlesContainer />}

      <div 
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-celebration-title"
        className="relative w-full max-w-sm mx-4 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 p-8 text-center animate-in zoom-in-95 fade-in duration-300 pointer-events-auto"
        style={{
          animation: prefersReducedMotion ? 'none' : 'modal-pop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
      >
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-24 h-24 bg-gradient-to-br from-purple-500 via-pink-500 to-amber-500 rounded-full flex items-center justify-center shadow-xl shadow-pink-500/30 border-4 border-white dark:border-slate-900 animate-in zoom-in duration-500 delay-100">
          <Heart className="w-10 h-10 text-white fill-white" />
        </div>

        <div className="mt-8 space-y-4">
          <div>
            <h2 id="reward-celebration-title" className="text-xl font-extrabold text-slate-900 dark:text-white">Your templates earned rewards!</h2>
            <p className="text-sm font-medium text-purple-600 dark:text-purple-400 mt-1 uppercase tracking-wider">Creator reward received</p>
          </div>
          
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-100 dark:border-white/5">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {activityDescription}
            </p>
          </div>

          <div className="py-2 animate-in slide-in-from-bottom-4 fade-in duration-500 delay-300">
            <span className="text-slate-500 dark:text-slate-400 text-sm font-medium">You earned</span>
            <div className="flex items-center justify-center gap-2 mt-1">
              <Sparkles className="w-6 h-6 text-amber-500" />
              <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-500">{celebration.creditsEarned}</span>
              <span className="text-xl font-bold text-amber-500">credits!</span>
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3">
          <Button 
            variant="secondary" 
            className="flex-1"
            onClick={() => {
              onClose();
              navigate(canOpenSingleTemplate
                ? `/templates/${celebration.primaryTemplateId}`
                : '/dashboard?tab=templates');
            }}
          >
            {canOpenSingleTemplate ? 'View template' : 'View templates'}
          </Button>
          <Button 
            className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg shadow-pink-500/25"
            onClick={onClose}
          >
            Awesome!
          </Button>
        </div>
      </div>
      
      <style>{`
        @keyframes modal-pop {
          0% { transform: scale(0.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

// --- Particles Engine ---
const ParticlesContainer = () => {
  const [particles, setParticles] = useState<any[]>([]);

  useEffect(() => {
    const colors = ['#a855f7', '#ec4899', '#eab308', '#22c55e', '#3b82f6'];
    const newParticles = [];
    
    // Generate scattered hearts and sparks
    for (let i = 0; i < 40; i++) {
      const type = Math.random() > 0.5 ? 'heart' : 'spark';
      newParticles.push({
        id: i,
        type,
        color: colors[Math.floor(Math.random() * colors.length)],
        left: 50 + (Math.random() - 0.5) * 20 + '%', // Start near center horizontal
        top: 50 + (Math.random() - 0.5) * 20 + '%', // Start near center vertical
        tx: (Math.random() - 0.5) * 400 + 'px', // Translation X
        ty: (Math.random() - 0.5) * 400 - 100 + 'px', // Translation Y (bias upwards)
        rot: Math.random() * 360 + 'deg',
        scale: Math.random() * 0.8 + 0.4,
        delay: Math.random() * 0.2 + 's',
        duration: Math.random() * 1 + 1.5 + 's'
      });
    }

    // Generate some large floating hearts from bottom
    for (let i = 0; i < 8; i++) {
      newParticles.push({
        id: 'float-' + i,
        type: 'float-heart',
        color: colors[Math.floor(Math.random() * colors.length)],
        left: 20 + Math.random() * 60 + '%',
        top: '110%',
        tx: (Math.random() - 0.5) * 100 + 'px',
        ty: -(Math.random() * 400 + 400) + 'px',
        rot: (Math.random() - 0.5) * 45 + 'deg',
        scale: Math.random() * 1 + 0.8,
        delay: Math.random() * 0.5 + 's',
        duration: Math.random() * 2 + 2 + 's'
      });
    }

    setParticles(newParticles);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => {
        if (p.type === 'heart') {
          return (
            <div
              key={p.id}
              className="absolute"
              style={{
                left: p.left, top: p.top,
                ['--tx' as string]: p.tx,
                ['--ty' as string]: p.ty,
                ['--rot' as string]: p.rot,
                ['--scale' as string]: p.scale,
                animation: `flyOut ${p.duration} ease-out ${p.delay} forwards`
              } as React.CSSProperties}
            >
              <Heart 
                className="fill-current"
                style={{ 
                  color: p.color, 
                  width: `${24 * p.scale}px`, 
                  height: `${24 * p.scale}px` 
                }} 
              />
            </div>
          );
        } else if (p.type === 'spark') {
          return (
            <div
              key={p.id}
              className="absolute rounded-full"
              style={{
                left: p.left, top: p.top,
                ['--tx' as string]: p.tx,
                ['--ty' as string]: p.ty,
                ['--rot' as string]: p.rot,
                ['--scale' as string]: p.scale,
                width: `${8 * p.scale}px`,
                height: `${8 * p.scale}px`,
                backgroundColor: p.color,
                animation: `flyOutSpark ${p.duration} cubic-bezier(0.25, 1, 0.5, 1) ${p.delay} forwards`
              } as React.CSSProperties}
            />
          );
        } else {
          // Float heart
          return (
            <div
              key={p.id}
              className="absolute"
              style={{
                left: p.left, top: p.top,
                ['--tx' as string]: p.tx,
                ['--ty' as string]: p.ty,
                ['--rot' as string]: p.rot,
                ['--scale' as string]: p.scale,
                animation: `floatUp ${p.duration} ease-in-out ${p.delay} forwards`
              } as React.CSSProperties}
            >
              <Heart 
                className="fill-current opacity-60"
                style={{ 
                  color: p.color, 
                  width: `${32 * p.scale}px`, 
                  height: `${32 * p.scale}px` 
                }} 
              />
            </div>
          );
        }
      })}
      
      <style>{`
        @keyframes flyOut {
          0% { transform: translate(0, 0) scale(0) rotate(0deg); opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) scale(var(--scale)) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes flyOutSpark {
          0% { transform: translate(0, 0) scale(0); opacity: 1; }
          50% { opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
        }
        @keyframes floatUp {
          0% { transform: translate(0, 0) scale(var(--scale)) rotate(0deg); opacity: 0; }
          20% { opacity: 0.6; }
          80% { opacity: 0.6; }
          100% { transform: translate(var(--tx), var(--ty)) scale(var(--scale)) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
    </div>
  );
};
