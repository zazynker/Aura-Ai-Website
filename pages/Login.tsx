import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Sparkles, ArrowRight } from 'lucide-react';

export const Login = ({ isSignup = false }: { isSignup?: boolean }) => {
  const navigate = useNavigate();
  const { login, browsing } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!email.includes('@')) return setError('Invalid email address');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (isSignup && !name) return setError('Name is required');

    setLoading(true);
    setTimeout(() => {
      login(email, isSignup ? name : email.split('@')[0]);
      setLoading(false);
      
      // Smart redirect
      if (browsing.lastViewedTemplate) {
          navigate(`/template/${browsing.lastViewedTemplate}`);
      } else {
          navigate('/');
      }
    }, 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
        {/* Background blobs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl -z-10 animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-600/20 rounded-full blur-3xl -z-10" />

        <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-white/10 shadow-2xl animate-in zoom-in-95 duration-500">
            <div className="text-center mb-8">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-500/30">
                    <Sparkles className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">{isSignup ? 'Create Account' : 'Welcome Back'}</h2>
                <p className="text-slate-400 text-sm">Join the future of product photography</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {isSignup && (
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-300 ml-1">Full Name</label>
                        <input 
                            type="text" 
                            value={name} 
                            onChange={e => setName(e.target.value)} 
                            className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all"
                            placeholder="John Doe"
                        />
                    </div>
                )}
                
                <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 ml-1">Email</label>
                    <input 
                        type="email" 
                        value={email} 
                        onChange={e => setEmail(e.target.value)} 
                        className={`w-full bg-slate-900/50 border rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && !email.includes('@') ? 'border-red-500' : 'border-white/10'}`}
                        placeholder="you@example.com"
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300 ml-1">Password</label>
                    <input 
                        type="password" 
                        value={password} 
                        onChange={e => setPassword(e.target.value)} 
                        className={`w-full bg-slate-900/50 border rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500/50 focus:border-transparent outline-none transition-all ${error && password.length < 6 ? 'border-red-500' : 'border-white/10'}`}
                        placeholder="••••••••"
                    />
                </div>

                {error && <p className="text-red-400 text-xs text-center">{error}</p>}

                <Button variant="gradient" className="w-full py-3" isLoading={loading}>
                    {isSignup ? 'Sign Up' : 'Log In'} <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
            </form>

            <div className="mt-6 text-center">
                <p className="text-sm text-slate-400">
                    {isSignup ? "Already have an account?" : "Don't have an account?"}
                    <button onClick={() => navigate(isSignup ? '/login' : '/signup')} className="text-purple-400 hover:text-purple-300 font-medium ml-1">
                        {isSignup ? 'Log in' : 'Sign up'}
                    </button>
                </p>
            </div>
        </div>
    </div>
  );
};
