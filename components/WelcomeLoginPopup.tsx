import React, { useEffect, useState } from 'react';
import { Gift, Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';

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
      className="fixed inset-0 z-[130] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-2 backdrop-blur-md animate-in fade-in duration-200 sm:px-6 sm:py-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-login-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="relative my-auto w-full max-w-[820px] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-[26px] border border-white/90 bg-white px-5 pb-5 pt-8 shadow-[0_34px_100px_-24px_rgba(15,23,42,0.72)] sm:max-h-[calc(100dvh-2rem)] sm:rounded-[36px] sm:px-10 sm:pb-9 sm:pt-12 md:min-h-[700px] md:px-16 md:pb-10 md:pt-16">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:right-7 sm:top-6"
          aria-label="Close welcome offer"
        >
          <X className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2} />
        </button>

        <div className="grid items-center gap-2 sm:gap-6 md:grid-cols-[0.95fr_1.05fr] md:gap-8">
          <div className="mx-auto w-[160px] text-left sm:w-[220px] md:mx-0 md:w-[250px]">
            <h2 id="welcome-login-title" className="w-full whitespace-nowrap text-[22px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[32px] md:text-[38px]">
              <span className="inline-block origin-left scale-x-[1.22] sm:scale-x-[1.13] md:scale-x-[1.12]">Log in to get</span>
            </h2>
            <p className="w-full text-[92px] font-black leading-[0.88] tracking-[-0.065em] sm:text-[136px] md:text-[166px]">
              <span className="inline-block origin-left scale-x-[1.13] bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent sm:scale-x-[1.07] md:scale-x-100">120</span>
            </p>
            <p className="mt-1 w-full whitespace-nowrap text-[13px] font-black tracking-[0.16em] text-purple-700 sm:mt-3 sm:text-[19px] md:text-[22px]">
              <span className="inline-block origin-left scale-x-[1.35] sm:scale-x-[1.3]">FREE CREDITS</span>
            </p>
          </div>

          <div className="order-first flex min-h-[122px] items-center justify-center sm:min-h-[205px] md:order-last md:min-h-[270px]">
            <div className="relative flex h-[122px] w-[170px] items-center justify-center sm:h-[205px] sm:w-[255px] md:h-[260px] md:w-[320px]">
              <div className="absolute bottom-2 left-1/2 h-[48px] w-[180px] -translate-x-1/2 -rotate-[14deg] rounded-[50%] border-[4px] border-fuchsia-100/90 shadow-[0_0_24px_rgba(232,121,249,0.45)] sm:h-[72px] sm:w-[270px] md:bottom-1 md:h-[88px] md:w-[340px]" />
              <div className="absolute bottom-3 left-1/2 h-12 w-36 -translate-x-1/2 rounded-full bg-fuchsia-300/35 blur-2xl sm:h-16 sm:w-52 md:h-20 md:w-60" />

              <div className="relative -translate-y-1 rotate-[5deg] sm:-translate-y-2">
                <div className="absolute inset-x-0 top-[7px] h-full rounded-[29px] bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-600 shadow-[0_20px_32px_-12px_rgba(192,38,211,0.65)] sm:top-[9px] sm:rounded-[46px] md:rounded-[52px]" />
                <div className="relative flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-[29px] border border-white/25 bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 shadow-[inset_0_2px_5px_rgba(255,255,255,0.38)] sm:h-[164px] sm:w-[164px] sm:rounded-[46px] md:h-[200px] md:w-[200px] md:rounded-[52px]">
                  <div className="absolute inset-[6px] rounded-[24px] border border-white/20 bg-gradient-to-br from-white/10 to-transparent sm:rounded-[40px] md:rounded-[46px]" />
                  <div className="absolute -left-8 -top-12 h-28 w-28 rounded-full bg-white/15 blur-xl" />
                  <Gift className="relative h-[54px] w-[54px] -rotate-[5deg] text-white sm:h-[82px] sm:w-[82px] md:h-[100px] md:w-[100px]" strokeWidth={1.75} />
                </div>
              </div>

              <Sparkles className="absolute right-1 top-0 h-9 w-9 text-fuchsia-400 sm:-right-1 sm:h-12 sm:w-12 md:-right-2 md:top-2 md:h-14 md:w-14" strokeWidth={1.7} />
              <span aria-hidden="true" className="absolute bottom-5 left-0 text-[26px] leading-none text-pink-400 sm:bottom-7 sm:left-1 sm:text-[32px] md:bottom-9 md:left-0">✦</span>
              <span aria-hidden="true" className="absolute bottom-[44%] left-[7%] text-base leading-none text-violet-400 sm:text-xl md:text-2xl">✦</span>
            </div>
          </div>
        </div>

        <div className="mt-5 text-[15px] font-medium text-slate-800 sm:ml-1 sm:mt-7 sm:text-lg md:mt-9 md:max-w-md md:text-xl">
          <div className="flex items-center justify-center gap-4 md:justify-start">
            <ImageIcon className="h-6 w-6 text-purple-500 sm:h-7 sm:w-7 md:h-8 md:w-8" strokeWidth={2} />
            <span>Create images &amp; videos</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading}
          className="mt-5 flex min-h-[58px] w-full items-center justify-center gap-3 rounded-[17px] border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-950 shadow-[0_12px_26px_-12px_rgba(15,23,42,0.3)] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:mt-8 sm:min-h-[74px] sm:gap-4 sm:text-xl md:mt-10 md:min-h-[84px] md:text-2xl"
        >
          {googleLoading ? <Loader2 className="h-7 w-7 animate-spin text-slate-500" /> : <GoogleIcon />}
          <span>{googleLoading ? 'Connecting...' : 'Log in with Google'}</span>
        </button>

        {error && <p className="mt-3 text-center text-xs text-red-500">{error}</p>}

        <button
          type="button"
          onClick={handleOtherLogin}
          className="mx-auto mt-3 block rounded-lg px-3 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 sm:mt-5 sm:text-lg"
        >
          Other ways to log in
        </button>
      </div>
    </div>
  );
};
