import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissible?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, className = '', size = 'md', dismissible = true }) => {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (dismissible && e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [dismissible, isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm transition-opacity" 
        onClick={dismissible ? onClose : undefined}
      />
      <div className={`relative w-full ${sizeClass} glass-panel rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden ${className}`}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200/50 dark:border-white/10">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
          {dismissible ? (
            <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
              <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </button>
          ) : <span className="w-7" aria-hidden="true" />}
        </div>
        <div 
          className="p-6 max-h-[70vh] overflow-y-auto"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#94a3b8 transparent'
          }}
        >
          {children}
        </div>
        {footer && (
          <div className="p-4 border-t border-slate-200/50 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
