import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { User as UserIcon, LogOut, LayoutDashboard, CreditCard, Sparkles, Sun, Moon, Bell, Check, AlertCircle, Sparkles as SparklesOutline, Pencil } from 'lucide-react';
import { Button } from './ui/Button';
import { ProfileSettingsModal } from './ProfileSettingsModal';
import {
  fetchMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type UserNotification,
} from '../utils/notificationsApi';

const formatRelativeTime = (createdAt: string): string => {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (elapsedSeconds < 60) return 'Just now';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(createdAt).toLocaleDateString();
};

const getNotificationLink = (notification: UserNotification): string => {
  const metadataLink = notification.metadata.link;
  const baseLink = typeof metadataLink === 'string' && metadataLink.startsWith('/')
    ? metadataLink
    : notification.type === 'template_approved' && notification.templateId
      ? `/templates/${notification.templateId}`
      : '/dashboard?tab=templates';
  const approvedVersionId = notification.type === 'template_approved'
    && typeof notification.metadata.version_id === 'string'
      ? notification.metadata.version_id
      : null;
  if (approvedVersionId && baseLink.startsWith('/templates/')) {
    const separator = baseLink.includes('?') ? '&' : '?';
    return `${baseLink}${separator}version=${encodeURIComponent(approvedVersionId)}`;
  }
  return baseLink;
};

export const Navbar = () => {
  const { user, logout, theme, toggleTheme, addToast } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  
  const isHome = location.pathname === '/';
  const unreadCount = notifications.filter(n => !n.readAt).length;

  const notifRef = useRef<HTMLDivElement>(null);

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setNotificationsError(null);
      return;
    }
    setNotificationsLoading(true);
    try {
      setNotifications(await fetchMyNotifications());
      setNotificationsError(null);
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : 'Could not load notifications.');
    } finally {
      setNotificationsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refreshNotifications();
    if (!user) return;
    const intervalId = window.setInterval(() => void refreshNotifications(), 60_000);
    return () => window.clearInterval(intervalId);
  }, [refreshNotifications, user?.id]);

  useEffect(() => {
    if (showNotifications) void refreshNotifications();
  }, [showNotifications, refreshNotifications]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotifications(false);
    };
    
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEsc);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showNotifications]);

  const handleNotificationClick = async (notif: UserNotification) => {
    if (!notif.readAt) {
      const readAt = new Date().toISOString();
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, readAt } : n));
      try {
        await markNotificationRead(notif.id);
      } catch (error) {
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, readAt: null } : n));
        addToast('error', error instanceof Error ? error.message : 'Could not mark this notification as read.');
      }
    }
    setShowNotifications(false);
    navigate(getNotificationLink(notif));
  };

  const markAllAsRead = async () => {
    const previous = notifications;
    const readAt = new Date().toISOString();
    setNotifications(prev => prev.map(n => n.readAt ? n : { ...n, readAt }));
    try {
      await markAllNotificationsRead();
    } catch (error) {
      setNotifications(previous);
      addToast('error', error instanceof Error ? error.message : 'Could not mark notifications as read.');
    }
  };

  const getNotifIcon = (type: string) => {
    switch (type) {
      case 'template_approved': return <Check className="w-4 h-4 text-emerald-500" />;
      case 'template_changes_requested': return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'creator_credits_earned':
      case 'platform_creator_bonus':
        return <SparklesOutline className="w-4 h-4 text-amber-500" />;
      default: return <Bell className="w-4 h-4 text-purple-500" />;
    }
  };

  return (
    <>
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isHome ? 'bg-white/80 dark:bg-slate-900/80' : 'bg-white dark:bg-slate-900'} backdrop-blur-md border-b border-slate-200 dark:border-white/5`}>
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Left - Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center group-hover:scale-105 transition-transform shadow-lg shadow-purple-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-purple-400 group-hover:to-pink-400 transition-all">Lazora</span>
        </Link>

        {/* Center */}
        <div className="hidden md:flex items-center gap-8">
          <Link to="/" className={`text-sm font-medium transition-colors hover:text-purple-500 dark:hover:text-white ${location.pathname === '/' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Templates</Link>
          <Link to="/modify" className={`text-sm font-medium transition-colors hover:text-purple-500 dark:hover:text-white ${location.pathname === '/modify' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Image</Link>
          <Link to="/video" className={`text-sm font-medium transition-colors hover:text-purple-500 dark:hover:text-white ${location.pathname === '/video' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Video</Link>
          <Link to="/templates/create" className={`text-sm font-medium transition-colors hover:text-purple-500 dark:hover:text-white ${location.pathname === '/templates/create' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Builder</Link>
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
              {/* Notifications */}
              <div className="relative" ref={notifRef}>
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 rounded-full text-slate-500 hover:text-purple-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/5 transition-all"
                  aria-label="Notifications"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white border-2 border-white dark:border-slate-900">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-white/10">
                      <h3 className="font-bold text-slate-900 dark:text-white">Notifications</h3>
                      {unreadCount > 0 && (
                        <button 
                          onClick={markAllAsRead}
                          className="text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                      {notificationsLoading && notifications.length === 0 ? (
                        <div className="py-12 px-4 text-center text-sm text-slate-500 dark:text-slate-400">
                          Loading notifications...
                        </div>
                      ) : notificationsError && notifications.length === 0 ? (
                        <div className="py-10 px-4 text-center">
                          <p className="text-sm text-red-600 dark:text-red-400">{notificationsError}</p>
                          <button onClick={() => void refreshNotifications()} className="mt-3 text-xs font-medium text-purple-600 dark:text-purple-400">
                            Try again
                          </button>
                        </div>
                      ) : notifications.length === 0 ? (
                        <div className="py-12 px-4 text-center">
                          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Bell className="w-5 h-5 text-slate-400" />
                          </div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">You're all caught up</p>
                          <p className="text-xs text-slate-500 mt-1">New template and credit updates will appear here.</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100 dark:divide-white/5">
                          {notifications.map(notif => (
                            <button
                              key={notif.id}
                              onClick={() => handleNotificationClick(notif)}
                              className={`w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-start gap-3 relative ${!notif.readAt ? 'bg-slate-50/50 dark:bg-slate-800/50' : ''}`}
                            >
                              {!notif.readAt && (
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-purple-500" />
                              )}
                              <div className={`mt-0.5 p-2 rounded-full flex-shrink-0 ${
                                notif.type === 'template_approved' ? 'bg-emerald-100 dark:bg-emerald-500/20' :
                                notif.type === 'template_changes_requested' ? 'bg-red-100 dark:bg-red-500/20' :
                                'bg-amber-100 dark:bg-amber-500/20'
                              }`}>
                                {getNotifIcon(notif.type)}
                              </div>
                              <div className="flex-1 pr-4">
                                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{notif.title}</h4>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                                  {notif.body}
                                </p>
                                <span className="text-[10px] text-slate-400 font-medium block mt-1.5">{formatRelativeTime(notif.createdAt)}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

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
                    {user.avatarUrl || user.avatar ? (
                      <img src={user.avatarUrl || user.avatar} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-5 h-5 text-slate-700 dark:text-white" />
                    )}
                  </div>
                </button>

                {showDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                    <div className="absolute right-0 mt-2 w-56 py-2 bg-white dark:bg-slate-900/90 backdrop-blur-2xl border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl z-20 animate-in slide-in-from-top-2 ring-1 ring-black/5 dark:ring-white/5">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDropdown(false);
                          setShowProfileSettings(true);
                        }}
                        className="mb-2 flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
                      >
                        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-white/10">
                          {user.avatarUrl || user.avatar ? (
                            <img src={user.avatarUrl || user.avatar} alt={user.name} className="h-full w-full object-cover" />
                          ) : (
                            <UserIcon className="m-2.5 h-5 w-5 text-slate-500" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">{user.name}</span>
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</span>
                        </span>
                        <Pencil className="h-4 w-4 shrink-0 text-slate-400" />
                      </button>
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
      <ProfileSettingsModal
        isOpen={showProfileSettings}
        onClose={() => setShowProfileSettings(false)}
      />
    </>
  );
};
