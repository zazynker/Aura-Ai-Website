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
  <svg aria-hidden="true" className="h-7 w-7 shrink-0 sm:h-8 sm:w-8" viewBox="0 0 24 24">
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
      className="fixed inset-0 z-[130] flex items-center justify-center overflow-y-auto bg-slate-950/70 px-3 py-4 backdrop-blur-md animate-in fade-in duration-200 sm:px-6 sm:py-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-login-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="relative my-auto w-full max-w-[820px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[30px] border border-white/90 bg-white px-6 pb-8 pt-12 shadow-[0_34px_100px_-24px_rgba(15,23,42,0.72)] sm:rounded-[36px] sm:px-10 sm:pb-10 sm:pt-14 md:min-h-[748px] md:px-16 md:pb-11 md:pt-[78px]">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:right-7 sm:top-6"
          aria-label="Close welcome offer"
        >
          <X className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2} />
        </button>

        <div className="grid items-center gap-8 md:grid-cols-[0.95fr_1.05fr] md:gap-8">
          <div className="text-center md:text-left">
            <h2 id="welcome-login-title" className="text-[28px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[34px] md:text-[38px]">
              Log in to get
            </h2>
            <p className="mt-1 bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-[102px] font-black leading-[0.9] tracking-[-0.065em] text-transparent sm:text-[136px] md:text-[166px]">
              120
            </p>
            <p className="mt-3 text-[15px] font-black tracking-[0.25em] text-purple-700 sm:text-xl md:text-[22px]">
              FREE CREDITS
            </p>
          </div>

          <div className="order-first flex min-h-[190px] items-center justify-center md:order-last md:min-h-[280px]">
            <div className="relative flex h-[178px] w-[220px] items-center justify-center sm:h-[220px] sm:w-[275px] md:h-[270px] md:w-[330px]">
              <div className="absolute bottom-3 left-1/2 h-[64px] w-[240px] -translate-x-1/2 -rotate-[14deg] rounded-[50%] border-[5px] border-fuchsia-100/90 shadow-[0_0_28px_rgba(232,121,249,0.5)] sm:h-[82px] sm:w-[300px] md:bottom-1 md:h-[94px] md:w-[355px]" />
              <div className="absolute bottom-5 left-1/2 h-16 w-44 -translate-x-1/2 rounded-full bg-fuchsia-300/40 blur-2xl sm:h-20 sm:w-56 md:h-24 md:w-64" />

              <div className="relative -translate-y-1 rotate-[4deg] sm:-translate-y-2">
                <div className="absolute inset-x-0 top-[13px] h-full translate-y-3 rounded-[38px] bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-600 shadow-[0_28px_42px_-12px_rgba(192,38,211,0.7)] sm:rounded-[50px]" />
                <div className="relative flex h-[142px] w-[142px] items-center justify-center overflow-hidden rounded-[38px] border border-white/25 bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 shadow-[inset_0_2px_5px_rgba(255,255,255,0.38)] sm:h-[180px] sm:w-[180px] sm:rounded-[50px] md:h-[210px] md:w-[210px] md:rounded-[56px]">
                  <div className="absolute inset-[7px] rounded-[32px] border border-white/20 bg-gradient-to-br from-white/10 to-transparent sm:rounded-[44px] md:rounded-[50px]" />
                  <div className="absolute -left-8 -top-12 h-28 w-28 rounded-full bg-white/15 blur-xl" />
                  <Gift className="relative h-[72px] w-[72px] -rotate-[4deg] text-white sm:h-[92px] sm:w-[92px] md:h-[106px] md:w-[106px]" strokeWidth={1.75} />
                </div>
              </div>

              <Sparkles className="absolute right-1 top-0 h-11 w-11 text-fuchsia-400 sm:-right-1 sm:h-14 sm:w-14 md:-right-2 md:top-2" strokeWidth={1.7} />
              <span aria-hidden="true" className="absolute bottom-7 left-0 text-[34px] leading-none text-pink-400 sm:bottom-8 sm:left-1 md:bottom-10 md:left-0">✦</span>
              <span aria-hidden="true" className="absolute bottom-[44%] left-[7%] text-xl leading-none text-violet-400 sm:text-2xl">✦</span>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 text-base font-medium text-slate-800 sm:ml-1 sm:text-lg md:mt-10 md:max-w-md md:gap-7 md:text-xl">
          <div className="flex items-center justify-center gap-4 md:justify-start">
            <ImageIcon className="h-7 w-7 text-purple-500 md:h-8 md:w-8" strokeWidth={2} />
            <span>Create images &amp; videos</span>
          </div>
          <div className="flex items-center justify-center gap-4 md:justify-start">
            <Gift className="h-7 w-7 text-fuchsia-500 md:h-8 md:w-8" strokeWidth={2} />
            <span>Exclusive to new users</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading}
          className="mt-9 flex min-h-[66px] w-full items-center justify-center gap-4 rounded-[18px] border border-slate-200 bg-white px-5 py-4 text-lg font-semibold text-slate-950 shadow-[0_12px_26px_-12px_rgba(15,23,42,0.3)] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[78px] sm:text-xl md:mt-10 md:min-h-[88px] md:text-2xl"
        >
          {googleLoading ? <Loader2 className="h-7 w-7 animate-spin text-slate-500" /> : <GoogleIcon />}
          <span>{googleLoading ? 'Connecting...' : 'Log in with Google'}</span>
        </button>

        {error && <p className="mt-3 text-center text-xs text-red-500">{error}</p>}

        <button
          type="button"
          onClick={handleOtherLogin}
          className="mx-auto mt-6 block rounded-lg px-3 py-1.5 text-base font-medium text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 sm:text-lg"
        >
          Other ways to log in
        </button>
      </div>
    </div>
  );
};
