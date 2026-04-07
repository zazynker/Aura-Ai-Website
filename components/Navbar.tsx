import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { User as UserIcon, LogOut, LayoutDashboard, CreditCard, Sparkles, Sun, Moon } from 'lucide-react';
import { Button } from './ui/Button';

export const Navbar = () => {
  const { user, logout, theme, toggleTheme } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);

  const isHome = location.pathname === '/';

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isHome ? 'bg-white/80 dark:bg-slate-900/80' : 'bg-white dark:bg-slate-900'} backdrop-blur-md border-b border-slate-200 dark:border-white/5`}>
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Left - Logo (Updated to Sparkles to match Login page) */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center group-hover:scale-105 transition-transform shadow-lg shadow-purple-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-purple-400 group-hover:to-pink-400 transition-all">Lazora</span>
        </Link>

        {/* Center */}
        <div className="hidden md:flex items-center gap-8">
          <Link to="/" className={`text-sm font-medium transition-colors hover:text-purple-500 dark:hover:text-white ${location.pathname === '/' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Templates</Link>
          <Link to="/modify" className={`text-sm font-medium transition-colors hover:text-purple-500 dark:hover:text-white ${location.pathname === '/modify' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Modify</Link>
          <Link to="/pricing" className={`text-sm font-medium transition-colors hover:text-purple-500 dark:hover:text-white ${location.pathname === '/pricing' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Plans</Link>
        </div>

        {/* Right */}
        <div className="flex items-center gap-4">
          
          {/* Theme Toggle */}
          <button 
            onClick={toggleTheme}
            className="p-2 rounded-full text-slate-500 hover:text-purple-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/5 transition-all"
            aria-label="Toggle Theme"
          >
             {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          {user ? (
            <>
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <Sparkles className="w-3 h-3 text-yellow-500 dark:text-yellow-400" />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{user.credits} Credits</span>
              </div>
              
              <div className="relative">
                <button 
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="w-9 h-9 rounded-full p-[1px] bg-gradient-to-tr from-purple-500 to-pink-500 overflow-hidden hover:scale-105 transition-transform"
                >
                   <div className="w-full h-full rounded-full bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                     {user.avatarUrl ? (
                       <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                     ) : (
                       <UserIcon className="w-5 h-5 text-slate-700 dark:text-white" />
                     )}
                   </div>
                </button>

                {showDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                    <div className="absolute right-0 mt-2 w-56 py-2 bg-white dark:bg-slate-900/90 backdrop-blur-2xl border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl z-20 animate-in slide-in-from-top-2 ring-1 ring-black/5 dark:ring-white/5">
                      <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 mb-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{user.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                      </div>
                      <Link to="/dashboard" onClick={() => setShowDropdown(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:text-purple-600 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <LayoutDashboard className="w-4 h-4" /> Dashboard
                      </Link>
                       <Link to="/pricing" onClick={() => setShowDropdown(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:text-purple-600 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <CreditCard className="w-4 h-4" /> Plans
                      </Link>
                      <button onClick={async () => { await logout(); setShowDropdown(false); navigate('/'); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-white/5 hover:text-red-600 dark:hover:text-red-300 transition-colors">
                        <LogOut className="w-4 h-4" /> Logout
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link to="/login" className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">Log in</Link>
              <Button variant="gradient" size="sm" onClick={() => navigate('/signup')}>Sign Up</Button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};