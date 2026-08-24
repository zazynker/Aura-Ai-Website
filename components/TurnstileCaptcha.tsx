import React, { useEffect, useRef } from 'react';
import { env } from '../config/env';

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileCaptchaProps {
  onTokenChange: (token: string | null) => void;
  resetKey: number;
}

const SCRIPT_ID = 'cloudflare-turnstile-script';

export const TurnstileCaptcha: React.FC<TurnstileCaptchaProps> = ({ onTokenChange, resetKey }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = env.captcha.turnstileSiteKey;

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let disposed = false;
    const renderWidget = () => {
      if (disposed || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'auto',
        size: 'flexible',
        callback: (token: string) => onTokenChange(token),
        'expired-callback': () => onTokenChange(null),
        'error-callback': () => onTokenChange(null),
      });
    };

    if (window.turnstile) renderWidget();
    else {
      let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderWidget, { once: true });
    }

    return () => {
      disposed = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [onTokenChange, resetKey, siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="min-h-[65px] w-full" />;
};

