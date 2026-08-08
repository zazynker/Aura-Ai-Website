import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Gift, X } from 'lucide-react';
import { supabase } from '../utils/supabase';

interface WelcomeLoginPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WelcomeLoginPopup: React.FC<WelcomeLoginPopupProps> = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [googleLoading, setGoogleLoading] = useState(false);

  const destination = `${location.pathname}${location.search}`;

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    if (isOpen) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleEsc);
      return () => {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener('keydown', handleEsc);
      };
    }

    return undefined;
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const rememberDestination = () => {
    if (destination.startsWith('/') && !destination.startsWith('//')) {
      sessionStorage.setItem('postAuthDestination', destination);
    }
    sessionStorage.setItem('authEntryContext', 'welcome-popup');
  };

  const handleGoogleLogin = async () => {
    if (googleLoading) return;
    setGoogleLoading(true);
    rememberDestination();

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
        },
      });
      if (error) throw error;
    } catch (error) {
      console.error(error);
      setGoogleLoading(false);
    }
  };

  const handleOtherLogin = () => {
    rememberDestination();
    onClose();
    navigate('/login', {
      state: { from: destination, authContext: 'welcome-popup' },
    });
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-login-title"
    >
      <div
        className="absolute inset-0 bg-transparent backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 flex w-full max-w-sm origin-center scale-[0.64] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full bg-black/5 p-1.5 text-slate-700 transition-colors hover:bg-black/10"
          aria-label="Close welcome offer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative bg-gradient-to-br from-indigo-200 via-purple-300 to-pink-300 px-6 pb-8 pt-12 text-center">
          <div className="relative mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-white/40 bg-gradient-to-br from-pink-400 to-purple-400 shadow-lg shadow-pink-500/30">
            <div className="absolute -right-5 -top-3 text-lg text-white/90 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">✦</div>
            <div className="absolute -left-5 bottom-1 text-sm text-white/80 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">✦</div>
            <Gift className="h-8 w-8 text-white" />
          </div>

          <h3 id="welcome-login-title" className="relative z-10 mb-1 text-xl font-bold text-slate-900">
            Log in to get
          </h3>

          <div className="relative mb-6 mt-2">
            <div className="pointer-events-none absolute inset-0 scale-125 rounded-full bg-white/30 blur-[40px]" />
            <div
              className="relative z-10 text-[130px] font-black leading-none tracking-tighter text-white"
              style={{ textShadow: '0 10px 20px rgba(0,0,0,0.15), 0 0 30px rgba(255,255,255,0.4)' }}
            >
              120
            </div>
            <div className="absolute -bottom-1 left-1/2 z-20 h-px w-4/5 -translate-x-1/2 bg-gradient-to-r from-transparent via-white to-transparent opacity-90">
              <div className="absolute left-1/2 top-1/2 h-0.5 w-1/3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_4px_rgba(255,255,255,1)]" />
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-center gap-2 text-xs font-bold tracking-[0.2em] text-white drop-shadow-sm">
            <span>✦</span>
            FREE CREDITS
            <span>✦</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center bg-white px-6 py-8 text-center">
          <div className="mb-2 flex items-center gap-3">
            <div className="relative flex h-12 w-12 items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                  <linearGradient id="welcome-media-icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>
                </defs>
                <rect x="4" y="6" width="20" height="16" rx="2" stroke="url(#welcome-media-icon-gradient)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="10" cy="11" r="1.5" stroke="url(#welcome-media-icon-gradient)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 18l5-5 4 4" stroke="url(#welcome-media-icon-gradient)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="22" cy="18" r="7" fill="white" stroke="url(#welcome-media-icon-gradient)" strokeWidth="1.5" />
                <path d="M20 15v6l4.5-3-4.5-3z" stroke="url(#welcome-media-icon-gradient)" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
            <h4 className="text-lg font-bold text-slate-900">Create images &amp; videos</h4>
          </div>

          <p className="mb-6 text-sm text-slate-500">Exclusive to new users</p>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="mb-4 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {googleLoading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            <span>Log in with Google</span>
          </button>

          <button
            type="button"
            onClick={handleOtherLogin}
            className="text-sm text-slate-500 transition-colors hover:text-slate-700"
          >
            Other ways to log in &gt;
          </button>
        </div>
      </div>
    </div>
  );
};
