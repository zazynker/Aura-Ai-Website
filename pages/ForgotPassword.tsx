import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { KeyRound, ArrowRight, Mail, ArrowLeft } from 'lucide-react';
import { supabase } from '../utils/supabase';

export const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.includes('@')) return setError('Invalid email address');

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://www.lazoraai.com/#/reset-password',
      });
      if (error) throw error;
      setEmailSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
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
            We've sent a password reset link to
          </p>
          <p className="text-purple-600 dark:text-purple-400 font-medium mb-6">{email}</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
            Click the link in the email to reset your password. If you don't see it, check your spam folder.
          </p>
          <button
            onClick={() => { window.location.hash = '/login'; window.location.reload(); }}
            className="text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-300 font-medium text-sm"
          >
            Back to Log in
          </button>
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
            <KeyRound className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Forgot password?</h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm">Enter your email and we'll send you a reset link</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={`w-full bg-white dark:bg-slate-900/50 border rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error ? 'border-red-500' : 'border-slate-200 dark:border-white/10'}`}
              placeholder="you@example.com"
            />
          </div>

          {error && <p className="text-red-500 dark:text-red-400 text-xs text-center">{error}</p>}

          <Button variant="gradient" className="w-full py-3" isLoading={loading}>
            Send Reset Link <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-sm text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-300 font-medium inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" /> Back to Log in
          </button>
        </div>
      </div>
    </div>
  );
};