import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Lock, ArrowRight, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '../utils/supabase';

export const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const recoverSession = async () => {
      // 从完整 URL 中提取 access_token 和 refresh_token
      const fullHash = window.location.href.split('#').slice(1).join('#');
      const params = new URLSearchParams(fullHash.replace(/^.*#/, ''));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        // 手动设置 session
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          setError('Reset link has expired or is invalid. Please request a new one.');
        } else {
          setSessionReady(true);
          // 清理 URL 中的 token
          window.history.replaceState(null, '', '/#/reset-password');
        }
        setVerifying(false);
      } else {
        // 没有 token，检查已有 session
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setSessionReady(true);
          setVerifying(false);
        } else {
          // 也监听 auth 事件作为后备
          const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
              setSessionReady(true);
              setVerifying(false);
            }
          });

          setTimeout(() => {
            setVerifying(prev => {
              if (prev) {
                setError('Reset link has expired or is invalid. Please request a new one.');
                return false;
              }
              return prev;
            });
          }, 5000);

          return () => subscription.unsubscribe();
        }
      }
    };

    recoverSession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirmPassword) return setError('Passwords do not match');

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl -z-10 animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-600/20 rounded-full blur-3xl -z-10" />

        <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl animate-in zoom-in-95 duration-500 text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/30">
            <CheckCircle className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">Password updated!</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-8">
            Your password has been reset successfully. You can now log in with your new password.
          </p>
          <Button variant="gradient" className="w-full py-3" onClick={() => navigate('/login')}>
            Go to Log in <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
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
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Set new password</h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm">Enter your new password below</p>
        </div>

        {verifying ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-4" />
            <p className="text-slate-500 dark:text-slate-400 text-sm">Verifying your reset link...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">New Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={`w-full bg-white dark:bg-slate-900/50 border rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && password.length < 6 ? 'border-red-500' : 'border-slate-200 dark:border-white/10'}`}
                placeholder="••••••••"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className={`w-full bg-white dark:bg-slate-900/50 border rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && password !== confirmPassword ? 'border-red-500' : 'border-slate-200 dark:border-white/10'}`}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-center">
                <p className="text-red-500 dark:text-red-400 text-xs">{error}</p>
                {error.includes('expired') && (
                  <button
                    type="button"
                    onClick={() => navigate('/forgot-password')}
                    className="text-purple-600 dark:text-purple-400 hover:text-purple-500 text-xs font-medium mt-2"
                  >
                    Request a new reset link
                  </button>
                )}
              </div>
            )}

            {sessionReady && (
              <Button variant="gradient" className="w-full py-3" isLoading={loading}>
                Reset Password <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </form>
        )}
      </div>
    </div>
  );
};