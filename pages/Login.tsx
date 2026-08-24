import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Sparkles, ArrowRight, Mail } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { TurnstileCaptcha } from '../components/TurnstileCaptcha';
import { env } from '../config/env';
import { markAuthAttemptPending, trackAuthFunnelEvent } from '../utils/authFunnelAnalytics';

function normalizeEmail(email: string): string {
  const [localPart, domain] = email.toLowerCase().split('@');
  if (!domain) return email.toLowerCase();

  if (domain === 'gmail.com') {
    const cleaned = localPart.replace(/\./g, '').split('+')[0];
    return `${cleaned}@gmail.com`;
  }

  const cleaned = localPart.split('+')[0];
  return `${cleaned}@${domain}`;
}

const SIGNUP_COOLDOWN_KEY = 'lazora_signup_email_cooldown_until';
const SIGNUP_COOLDOWN_SECONDS = 60;

const getAuthRedirectUrl = (): string => `${window.location.origin}${window.location.pathname}`;

export const Login = ({ isSignup = false }: { isSignup?: boolean }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const authRouteState = (location.state || {}) as {
    from?: string;
    authContext?: string;
  };
  const isTemplateContext = authRouteState.authContext === 'template'
    || sessionStorage.getItem('authEntryContext') === 'template';
  const { browsing, saveBrowsingState, addToast } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const captchaRequired = Boolean(env.captcha.turnstileSiteKey);
  const entryContext = authRouteState.authContext
    || sessionStorage.getItem('authEntryContext')
    || 'direct';

  const handleCaptchaToken = useCallback((token: string | null) => {
    setCaptchaToken(token);
  }, []);

  useEffect(() => {
    trackAuthFunnelEvent(isSignup ? 'signup_viewed' : 'login_viewed', { entryContext });
  }, [entryContext, isSignup]);

  useEffect(() => {
    const updateCooldown = () => {
      const until = Number(localStorage.getItem(SIGNUP_COOLDOWN_KEY) || 0);
      setCooldownSeconds(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    };
    updateCooldown();
    const interval = window.setInterval(updateCooldown, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const startSignupCooldown = () => {
    const until = Date.now() + SIGNUP_COOLDOWN_SECONDS * 1_000;
    localStorage.setItem(SIGNUP_COOLDOWN_KEY, String(until));
    setCooldownSeconds(SIGNUP_COOLDOWN_SECONDS);
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError('');
    trackAuthFunnelEvent(isSignup ? 'signup_google_clicked' : 'login_google_clicked', {
      authMethod: 'google',
      entryContext,
    });
    markAuthAttemptPending('google', entryContext, isSignup ? 'signup' : 'login');
    if (authRouteState.from?.startsWith('/') && !authRouteState.from.startsWith('//')) {
      sessionStorage.setItem('postAuthDestination', authRouteState.from);
    }
    
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getAuthRedirectUrl(),
        }
      });
      
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Google login failed');
      setGoogleLoading(false);
    }
  };

  const handleRedirect = () => {
    const routeDestination = (location.state as { from?: string } | null)?.from;
    const storedDestination = sessionStorage.getItem('postAuthDestination');
    const authDestination = routeDestination || storedDestination;
    if (authDestination?.startsWith('/') && !authDestination.startsWith('//')) {
      sessionStorage.removeItem('postAuthDestination');
      sessionStorage.removeItem('authEntryContext');
      navigate(authDestination, { replace: true });
      return;
    }

    if (browsing.intendedDestination) {
      const dest = browsing.intendedDestination;
      saveBrowsingState({ intendedDestination: null });

      if (dest === '/modify') {
        const pendingTemplateStr = sessionStorage.getItem('pendingTemplate');
        if (pendingTemplateStr) {
          const pendingTemplate = JSON.parse(pendingTemplateStr);
          sessionStorage.removeItem('pendingTemplate');
          navigate('/modify', {
            state: {
              initialImage: pendingTemplate.imageUrl,
              initialImageSource: {
                templateId: pendingTemplate.templateId,
                templateName: pendingTemplate.templateName
              }
            }
          });
          return;
        }
      }
      navigate(dest);
    } else {
      navigate('/');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.includes('@')) {
      if (isSignup) trackAuthFunnelEvent('signup_validation_failed', { authMethod: 'email', entryContext, errorCode: 'invalid_email' });
      return setError('Invalid email address');
    }
    if (password.length < 6) {
      if (isSignup) trackAuthFunnelEvent('signup_validation_failed', { authMethod: 'email', entryContext, errorCode: 'short_password' });
      return setError('Password must be at least 6 characters');
    }
    if (captchaRequired && !captchaToken) {
      if (isSignup) trackAuthFunnelEvent('signup_validation_failed', { authMethod: 'email', entryContext, errorCode: 'captcha_required' });
      return setError('Please complete the security check.');
    }

    setLoading(true);

    try {
      if (isSignup) {
        trackAuthFunnelEvent('signup_email_submitted', { authMethod: 'email', entryContext });
        markAuthAttemptPending('email', entryContext, 'signup');
        const { error } = await supabase.auth.signUp({
          email: normalizeEmail(email),
          password,
          options: {
            emailRedirectTo: getAuthRedirectUrl(),
            captchaToken: captchaToken || undefined,
          }
        });
        if (error) throw error;
        trackAuthFunnelEvent('signup_email_sent', { authMethod: 'email', entryContext });
        startSignupCooldown();
        setCaptchaToken(null);
        setCaptchaResetKey((key) => key + 1);
        setSignupSuccess(true);
      } else {
        trackAuthFunnelEvent('login_email_submitted', { authMethod: 'email', entryContext });
        markAuthAttemptPending('email', entryContext, 'login');
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizeEmail(email),
          password,
          options: { captchaToken: captchaToken || undefined },
        });
        if (error) throw error;
        trackAuthFunnelEvent('login_success', { authMethod: 'email', entryContext });
        handleRedirect();
      }
    } catch (err: any) {
      trackAuthFunnelEvent(isSignup ? 'signup_failed' : 'login_failed', {
        authMethod: 'email',
        entryContext,
        errorCode: typeof err?.code === 'string' ? err.code : 'auth_error',
      });
      setError(err.message || 'Authentication failed');
      setCaptchaToken(null);
      setCaptchaResetKey((key) => key + 1);
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    if (resendLoading || cooldownSeconds > 0) return;
    if (captchaRequired && !captchaToken) {
      setError('Please complete the security check.');
      return;
    }
    setResendLoading(true);
    setError('');
    trackAuthFunnelEvent('confirmation_resend_requested', { authMethod: 'email', entryContext });
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: normalizeEmail(email),
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          captchaToken: captchaToken || undefined,
        },
      });
      if (resendError) throw resendError;
      trackAuthFunnelEvent('confirmation_resent', { authMethod: 'email', entryContext });
      startSignupCooldown();
      addToast('success', 'Confirmation email sent again.');
    } catch (resendError: any) {
      trackAuthFunnelEvent('confirmation_resend_failed', {
        authMethod: 'email',
        entryContext,
        errorCode: typeof resendError?.code === 'string' ? resendError.code : 'resend_error',
      });
      setError(resendError.message || 'Could not resend the confirmation email.');
    } finally {
      setCaptchaToken(null);
      setCaptchaResetKey((key) => key + 1);
      setResendLoading(false);
    }
  };

  if (signupSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl -z-10 animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-600/20 rounded-full blur-3xl -z-10" />

        <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl animate-in zoom-in-95 duration-500 text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-500/30">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">Check your email</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-2">
            We've sent a confirmation link to
          </p>
          <p className="text-purple-600 dark:text-purple-400 font-medium mb-6">{email}</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
            Click the link in the email to activate your account. If you don't see it, check your spam folder.
          </p>
          <TurnstileCaptcha onTokenChange={handleCaptchaToken} resetKey={captchaResetKey} />
          {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}
          <div className="mt-5 grid gap-2">
            <Button
              variant="gradient"
              className="w-full"
              isLoading={resendLoading}
              disabled={cooldownSeconds > 0}
              onClick={() => void resendConfirmation()}
            >
              {cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : 'Resend confirmation email'}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => { setSignupSuccess(false); setError(''); }}
            >
              Change email address
            </Button>
            <button
              onClick={() => navigate('/login')}
              className="mt-2 text-sm font-medium text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300"
            >
              Back to Log in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl -z-10 animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-600/20 rounded-full blur-3xl -z-10" />

        <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl animate-in zoom-in-95 duration-500">
            <div className="text-center mb-8">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-500/30">
                    <Sparkles className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{isSignup ? 'Create Account' : 'Welcome Back'}</h2>
                <p className="text-slate-600 dark:text-slate-400 text-sm">
                  {isTemplateContext
                    ? 'Create an account to unlock the full workflow and continue recreating this result.'
                    : 'Create AI Images & Videos. Share How They’re Made.'}
                </p>
            </div>

            <div className="mb-6 rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-center dark:border-purple-800/50 dark:bg-purple-950/30">
              <p className="font-semibold text-purple-900 dark:text-purple-100">
                {isSignup
                  ? 'Sign up and get 120 free credits'
                  : 'Get 120 free credits when you sign up'}
              </p>
              <p className="mt-1 text-xs text-purple-700 dark:text-purple-300">
                No credit card required.
              </p>
            </div>

            {/* Google Login Button - 放在表单前面，更醒目 */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleLoading || loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 mb-6
                         border border-slate-200 dark:border-white/10 rounded-xl
                         bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10
                         text-slate-700 dark:text-white font-medium
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {googleLoading ? (
                <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              <span>{googleLoading ? 'Connecting...' : 'Continue with Google'}</span>
            </button>

            {/* Divider */}
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-white/10" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white dark:bg-slate-800 text-slate-500">
                  or continue with email
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">Email</label>
                    <input 
                        type="email" 
                        autoComplete="email"
                        value={email} 
                        onChange={e => setEmail(e.target.value)} 
                        className={`w-full bg-white dark:bg-slate-900/50 border rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && !email.includes('@') ? 'border-red-500' : 'border-slate-200 dark:border-white/10'}`}
                        placeholder="you@example.com"
                    />
                </div>

                <div className="space-y-1">
                    <div className="flex justify-between items-center">
                        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">Password</label>
                        {!isSignup && (
                            <button
                                type="button"
                                onClick={() => navigate('/forgot-password')}
                                className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-300"
                            >
                                Forgot password?
                            </button>
                        )}
                    </div>
                    <input 
                        type="password" 
                        autoComplete={isSignup ? 'new-password' : 'current-password'}
                        value={password} 
                        onChange={e => setPassword(e.target.value)} 
                        className={`w-full bg-white dark:bg-slate-900/50 border rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && password.length < 6 ? 'border-red-500' : 'border-slate-200 dark:border-white/10'}`}
                        placeholder="••••••••"
                    />
                </div>

                {error && <p className="text-red-500 dark:text-red-400 text-xs text-center">{error}</p>}

                <TurnstileCaptcha onTokenChange={handleCaptchaToken} resetKey={captchaResetKey} />

                <Button
                  variant="gradient"
                  className="w-full py-3"
                  isLoading={loading}
                >
                    {isSignup ? 'Sign up — Get 120 Credits' : 'Log In'} <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
            </form>

            <div className="mt-6 text-center">
                <p className="text-sm text-text-slate-600 dark:text-slate-400">
                    {isSignup ? "Already have an account?" : "Don't have an account?"}
                    <button
                      onClick={() => navigate(
                        isSignup ? '/login' : '/signup',
                        { state: authRouteState },
                      )}
                      className="text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-300 font-medium ml-1"
                    >
                        {isSignup ? 'Log in' : 'Sign up'}
                    </button>
                </p>
            </div>
        </div>
    </div>
  );
};
