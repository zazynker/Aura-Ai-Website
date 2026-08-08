import React, { useEffect, useState } from 'react';
import { Gift, Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';

export const WELCOME_LOGIN_POPUP_SEEN_KEY = 'lazora-welcome-login-popup-seen';

interface WelcomeLoginPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

const GoogleIcon = () => (
  <svg aria-hidden="true" className="h-6 w-6 shrink-0" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

export const WelcomeLoginPopup: React.FC<WelcomeLoginPopupProps> = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const destination = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
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
    setError('');
    rememberDestination();

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
        },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError) {
      setError(oauthError instanceof Error ? oauthError.message : 'Google login failed');
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
      className="fixed inset-0 z-[130] flex items-center justify-center overflow-y-auto bg-slate-950/65 px-4 py-5 backdrop-blur-md animate-in fade-in duration-200 sm:px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-login-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="relative my-auto w-full max-w-[760px] max-h-[calc(100dvh-2.5rem)] overflow-y-auto rounded-[30px] border border-white/80 bg-white px-6 py-7 shadow-[0_32px_90px_-24px_rgba(15,23,42,0.65)] sm:px-9 sm:py-9 md:px-12">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:right-5 sm:top-5"
          aria-label="Close welcome offer"
        >
          <X className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>

        <div className="grid items-center gap-7 pt-2 md:grid-cols-[1.08fr_0.92fr] md:gap-10 md:pt-4">
          <div className="text-center md:text-left">
            <h2 id="welcome-login-title" className="text-2xl font-extrabold tracking-[-0.025em] text-slate-950 sm:text-3xl">
              Log in to get
            </h2>
            <p className="mt-1 bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-[88px] font-black leading-[0.95] tracking-[-0.06em] text-transparent sm:text-[108px] md:text-[132px]">
              120
            </p>
            <p className="mt-2 text-sm font-extrabold tracking-[0.22em] text-purple-700 sm:text-base">
              FREE CREDITS
            </p>
          </div>

          <div className="order-first flex justify-center md:order-last">
            <div className="relative flex h-36 w-36 items-center justify-center rounded-[38px] bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 shadow-[0_24px_45px_-18px_rgba(192,38,211,0.75)] sm:h-44 sm:w-44 sm:rounded-[46px]">
              <div className="absolute inset-[5px] rounded-[34px] border border-white/25 bg-white/10 sm:rounded-[42px]" />
              <Gift className="relative h-16 w-16 text-white sm:h-20 sm:w-20" strokeWidth={1.7} />
              <Sparkles className="absolute -right-7 -top-7 h-10 w-10 text-fuchsia-400" strokeWidth={1.7} />
              <span className="absolute -bottom-4 -left-6 text-3xl text-pink-400">✦</span>
              <span className="absolute -left-12 top-1/2 text-xl text-violet-400">✦</span>
            </div>
          </div>
        </div>

        <div className="mt-7 grid gap-3 text-sm font-medium text-slate-800 sm:ml-1 sm:text-base md:mt-6 md:max-w-sm">
          <div className="flex items-center justify-center gap-3 md:justify-start">
            <ImageIcon className="h-5 w-5 text-purple-500" strokeWidth={2} />
            <span>Create images &amp; videos</span>
          </div>
          <div className="flex items-center justify-center gap-3 md:justify-start">
            <Gift className="h-5 w-5 text-fuchsia-500" strokeWidth={2} />
            <span>Exclusive to new users</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading}
          className="mt-7 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-base font-semibold text-slate-950 shadow-[0_10px_24px_-16px_rgba(15,23,42,0.55)] transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg"
        >
          {googleLoading ? <Loader2 className="h-6 w-6 animate-spin text-slate-500" /> : <GoogleIcon />}
          <span>{googleLoading ? 'Connecting...' : 'Log in with Google'}</span>
        </button>

        {error && <p className="mt-3 text-center text-xs text-red-500">{error}</p>}

        <button
          type="button"
          onClick={handleOtherLogin}
          className="mx-auto mt-5 block rounded-lg px-3 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
        >
          Other ways to log in
        </button>
      </div>
    </div>
  );
};
