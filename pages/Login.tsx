import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Sparkles, ArrowRight, Mail } from 'lucide-react';
import { supabase } from '../utils/supabase';

const ALLOWED_EMAIL_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'live.com',
  'msn.com',
  'protonmail.com',
  'proton.me',
];

function isAllowedEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

export const Login = ({ isSignup = false }: { isSignup?: boolean }) => {
  const navigate = useNavigate();
  const { browsing, saveBrowsingState, addToast } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleRedirect = () => {
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

    if (!email.includes('@')) return setError('Invalid email address');
    if (isSignup && !isAllowedEmail(email)) return setError('Please use a major email provider (Gmail, Outlook, Yahoo, iCloud, etc.)');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (isSignup && !name) return setError('Name is required');
    if (isSignup && password !== confirmPassword) return setError('Passwords do not match');

    setLoading(true);

    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name }
          }
        });
        if (error) throw error;
        setSignupSuccess(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) throw error;
        handleRedirect();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
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
                    <Sparkles className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{isSignup ? 'Create Account' : 'Welcome Back'}</h2>
                <p className="text-slate-600 dark:text-slate-400 text-sm">Join the future of product photography</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {isSignup && (
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">Full Name</label>
                        <input 
                            type="text" 
                            value={name} 
                            onChange={e => setName(e.target.value)} 
                            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all"
                            placeholder="John Doe"
                        />
                    </div>
                )}
                
                <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">Email</label>
                    <input 
                        type="email" 
                        value={email} 
                        onChange={e => setEmail(e.target.value)} 
                        className={`w-full bg-white dark:bg-slate-900/50 border rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && !email.includes('@') ? 'border-red-500' : 'border-slate-200 dark:border-white/10'}`}
                        placeholder="you@example.com"
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">Password</label>
                    <input 
                        type="password" 
                        value={password} 
                        onChange={e => setPassword(e.target.value)} 
                        className={`w-full bg-white dark:bg-slate-900/50 border rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && password.length < 6 ? 'border-red-500' : 'border-slate-200 dark:border-white/10'}`}
                        placeholder="••••••••"
                    />
                </div>

                {isSignup && (
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 ml-1">Confirm Password</label>
                        <input 
                            type="password" 
                            value={confirmPassword} 
                            onChange={e => setConfirmPassword(e.target.value)} 
                            className={`w-full bg-white dark:bg-slate-900/50 border rounded-xl px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && password !== confirmPassword ? 'border-red-500' : 'border-slate-200 dark:border-white/10'}`}
                            placeholder="••••••••"
                        />
                    </div>
                )}

                {error && <p className="text-red-500 dark:text-red-400 text-xs text-center">{error}</p>}

                <Button variant="gradient" className="w-full py-3" isLoading={loading}>
                    {isSignup ? 'Sign Up' : 'Log In'} <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
            </form>

            <div className="mt-6 text-center">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                    {isSignup ? "Already have an account?" : "Don't have an account?"}
                    <button onClick={() => navigate(isSignup ? '/login' : '/signup')} className="text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-300 font-medium ml-1">
                        {isSignup ? 'Log in' : 'Sign up'}
                    </button>
                </p>
            </div>
        </div>
    </div>
  );
};