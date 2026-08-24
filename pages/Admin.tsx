import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, Users, TrendingUp, Zap, Search, Crown, 
  ChevronLeft, ChevronRight, Loader2, AlertCircle,
  Settings, BarChart3, RefreshCw, Image, AlertTriangle,
  Eye, X, CheckCircle, MessageSquare, ChevronDown, ChevronUp, Layers,
  PlayCircle, Maximize2, Music, Gift, Sparkles
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { 
  checkIsAdmin, 
  adminGetUsers, 
  adminGetStats, 
  adminGetPopupImpressionCount,
  adminGetAuthFunnel,
  adminGetTemplateStats,
  adminGetUnusedTemplates,
  adminUpdateCredits,
  adminUpdatePlan,
  adminGetUserGenerations,
  adminGetTemplateReviews,
  adminReviewTemplate,
  adminSetTemplateUseCount,
  adminIssueTemplateEncouragement,
  AdminGeneration,
  AdminReviewTemplate,
  AdminReviewedTemplate,
  type AuthFunnelStats,
} from '../utils/adminApi';
import { TEMPLATE_DETAIL_AUTH_GATE_KEY } from '../utils/popupAnalytics';
import { announceCreatorRewardAvailable } from '../utils/notificationsApi';
import { AdminUser, AdminStats, TemplateStats, UnusedTemplate } from '../types';

type TabType = 'overview' | 'users' | 'templates' | 'rewards' | 'unused' | 'review';

const VIRTUAL_USERNAME_SUGGESTIONS = [
  'Bananapiepie', 'MochiStudio', 'PeachyNova', 'CocoCanvas',
  'LunaCreates', 'MintyMango', 'PixelPanda', 'SunnyBunny',
];

export const Admin = () => {
  const navigate = useNavigate();
  const { user, addToast } = useStore();
  
  // Auth state
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Review state
  const [pendingTemplates, setPendingTemplates] = useState<AdminReviewTemplate[]>([]);
  const [reviewedTemplates, setReviewedTemplates] = useState<AdminReviewedTemplate[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [reviewingTemplate, setReviewingTemplate] = useState<AdminReviewTemplate | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [reviewActionLoading, setReviewActionLoading] = useState(false);
  const [reviewMediaPreview, setReviewMediaPreview] = useState<{
    url: string;
    type: 'image' | 'video' | 'audio';
    title: string;
  } | null>(null);

  // Stats state
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [popupImpressions, setPopupImpressions] = useState<{
    impressionCount: number;
    lastShownAt: string | null;
  } | null>(null);
  const [authFunnel, setAuthFunnel] = useState<AuthFunnelStats | null>(null);

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // Template stats state
  const [templateStats, setTemplateStats] = useState<TemplateStats[]>([]);
  const [templateStatsLoading, setTemplateStatsLoading] = useState(false);

  // Admin-only creator encouragement controls
  const [boostingTemplate, setBoostingTemplate] = useState<TemplateStats | null>(null);
  const [boostDisplayedUses, setBoostDisplayedUses] = useState('0');
  const [boostVirtualUsername, setBoostVirtualUsername] = useState('Bananapiepie');
  const [boostUsageDelta, setBoostUsageDelta] = useState('1');
  const [boostRewardCredits, setBoostRewardCredits] = useState('10');
  const [boostInternalNote, setBoostInternalNote] = useState('');
  const [boostSaving, setBoostSaving] = useState(false);
  const [boostTemplateSearch, setBoostTemplateSearch] = useState('');

  // Unused templates state
  const [unusedTemplates, setUnusedTemplates] = useState<UnusedTemplate[]>([]);
  const [unusedTemplatesLoading, setUnusedTemplatesLoading] = useState(false);

  // Edit user modal state
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditOperation, setCreditOperation] = useState<'set' | 'add' | 'subtract'>('add');
  const [newPlan, setNewPlan] = useState<'Free' | 'Pro'>('Free');
  const [bonusCredits, setBonusCredits] = useState('0');
  const [isUpdating, setIsUpdating] = useState(false);

  // Generations modal state
  const [viewingUser, setViewingUser] = useState<AdminUser | null>(null);
  const [userGenerations, setUserGenerations] = useState<AdminGeneration[]>([]);
  const [userGensTotal, setUserGensTotal] = useState(0);
  const [userGensPage, setUserGensPage] = useState(1);
  const [userGensLoading, setUserGensLoading] = useState(false);
  const [previewGen, setPreviewGen] = useState<AdminGeneration | null>(null);

  // Check admin status on mount
  useEffect(() => {
    const verifyAdmin = async () => {
      if (!user) {
        navigate('/login');
        return;
      }

      const adminStatus = await checkIsAdmin();
      setIsAdmin(adminStatus);
      setLoading(false);

      if (!adminStatus) {
        addToast('error', 'Access denied. Admin privileges required.');
        navigate('/');
      }
    };

    verifyAdmin();
  }, [user, navigate, addToast]);

  // Load stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    const [statsResult, popupResult, funnelResult] = await Promise.all([
      adminGetStats(),
      adminGetPopupImpressionCount(TEMPLATE_DETAIL_AUTH_GATE_KEY),
      adminGetAuthFunnel(30),
    ]);
    if (statsResult.error) {
      addToast('error', `Failed to load stats: ${statsResult.error}`);
    } else if (statsResult.data) {
      setStats(statsResult.data);
    }
    if (popupResult.error) {
      addToast('error', `Failed to load popup analytics: ${popupResult.error}`);
    } else if (popupResult.data) {
      setPopupImpressions(popupResult.data);
    }
    if (funnelResult.error) {
      addToast('error', `Failed to load registration funnel: ${funnelResult.error}`);
    } else if (funnelResult.data) {
      setAuthFunnel(funnelResult.data);
    }
    setStatsLoading(false);
  }, [addToast]);

  // Load users
  const loadUsers = useCallback(async (page: number = 1, search: string = '') => {
    setUsersLoading(true);
    const { data, error } = await adminGetUsers(search, page, 15);
    if (error) {
      addToast('error', `Failed to load users: ${error}`);
    } else if (data) {
      setUsers(data.users);
      setUsersTotal(data.total);
    }
    setUsersLoading(false);
  }, [addToast]);

  // Load template stats
  const loadTemplateStats = useCallback(async () => {
    setTemplateStatsLoading(true);
    const { data, error } = await adminGetTemplateStats(100);
    if (data) {
      setTemplateStats(data);
    }
    if (error) {
      addToast('error', `Failed to load template stats: ${error}`);
    }
    setTemplateStatsLoading(false);
  }, [addToast]);

  // Load unused templates
  const loadUnusedTemplates = useCallback(async () => {
    setUnusedTemplatesLoading(true);
    const { data, error } = await adminGetUnusedTemplates(2, 50);
    if (error) {
      addToast('error', `Failed to load unused templates: ${error}`);
    } else if (data) {
      setUnusedTemplates(data);
    }
    setUnusedTemplatesLoading(false);
  }, [addToast]);

  const loadTemplateReviews = useCallback(async () => {
    setReviewsLoading(true);
    const { data, error } = await adminGetTemplateReviews();
    if (error) {
      addToast('error', `Failed to load template reviews: ${error}`);
    } else if (data) {
      setPendingTemplates(data.pending);
      setReviewedTemplates(data.recent);
    }
    setReviewsLoaded(true);
    setReviewsLoading(false);
  }, [addToast]);

  const submitTemplateReview = useCallback(async (
    decision: 'approve' | 'request_changes',
    feedback?: string,
  ) => {
    if (!reviewingTemplate || reviewActionLoading) return;
    if (decision === 'approve' && !reviewingTemplate.coverUrl) {
      addToast('error', 'A template cover is required before approval.');
      return;
    }
    setReviewActionLoading(true);
    const result = await adminReviewTemplate(reviewingTemplate.id, reviewingTemplate.versionId, decision, feedback);
    if (!result.success) {
      addToast('error', result.error || 'The review could not be saved.');
      setReviewActionLoading(false);
      return;
    }
    setApproveConfirmOpen(false);
    setRejectModalOpen(false);
    setRejectFeedback('');
    setReviewingTemplate(null);
    await loadTemplateReviews();
    addToast('success', decision === 'approve' ? 'Template approved' : 'Feedback sent');
    setReviewActionLoading(false);
  }, [reviewingTemplate, reviewActionLoading, addToast, loadTemplateReviews]);

  // Load data when tab changes
  useEffect(() => {
    if (!isAdmin) return;

    if (activeTab === 'overview' && !stats) {
      loadStats();
    } else if (activeTab === 'users' && users.length === 0) {
      loadUsers(1, '');
    } else if (activeTab === 'templates' && templateStats.length === 0) {
      loadTemplateStats();
    } else if (activeTab === 'unused' && unusedTemplates.length === 0) {
      loadUnusedTemplates();
    } else if (activeTab === 'review' && !reviewsLoaded && !reviewsLoading) {
      loadTemplateReviews();
    }
  }, [activeTab, isAdmin, stats, users.length, templateStats.length, unusedTemplates.length, reviewsLoaded, reviewsLoading, loadStats, loadUsers, loadTemplateStats, loadUnusedTemplates, loadTemplateReviews]);

  // Handle user search
  const handleUserSearch = () => {
    setUsersPage(1);
    loadUsers(1, usersSearch);
  };

  // Handle pagination
  const handlePageChange = (newPage: number) => {
    setUsersPage(newPage);
    loadUsers(newPage, usersSearch);
  };

  // Handle edit user
  const openEditModal = (u: AdminUser) => {
    setEditingUser(u);
    setCreditAmount('');
    setCreditOperation('add');
    setNewPlan(u.plan as 'Free' | 'Pro');
    setBonusCredits('0');
  };

  // Handle view user generations
  const openGenerationsModal = async (u: AdminUser) => {
    setViewingUser(u);
    setUserGenerations([]);
    setUserGensPage(1);
    setUserGensTotal(0);
    await loadUserGenerations(u.id, 1);
  };

  const loadUserGenerations = async (userId: string, page: number) => {
    setUserGensLoading(true);
    const { data, error } = await adminGetUserGenerations(userId, page, 12);
    if (error) {
      addToast('error', `Failed to load generations: ${error}`);
    } else if (data) {
      setUserGenerations(data.generations);
      setUserGensTotal(data.total);
      setUserGensPage(page);
    }
    setUserGensLoading(false);
  };

  // Handle update credits
  const handleUpdateCredits = async () => {
    if (!editingUser || !creditAmount) return;
    
    setIsUpdating(true);
    const amount = parseInt(creditAmount);
    if (isNaN(amount) || amount < 0) {
      addToast('error', 'Invalid credit amount');
      setIsUpdating(false);
      return;
    }

    const { success, data, error } = await adminUpdateCredits(
      editingUser.id, 
      amount, 
      creditOperation
    );

    if (success && data) {
      addToast('success', `Credits updated: ${data.previous_credits} → ${data.new_credits}`);
      // Update local state
      setUsers(prev => prev.map(u => 
        u.id === editingUser.id ? { ...u, credits: data.new_credits } : u
      ));
      setEditingUser(prev => prev ? { ...prev, credits: data.new_credits } : null);
      setCreditAmount('');
    } else {
      addToast('error', error || 'Failed to update credits');
    }
    setIsUpdating(false);
  };

  // Handle update plan
  const handleUpdatePlan = async () => {
    if (!editingUser) return;
    
    setIsUpdating(true);
    const bonus = parseInt(bonusCredits) || 0;

    const { success, data, error } = await adminUpdatePlan(
      editingUser.id,
      newPlan,
      bonus
    );

    if (success && data) {
      addToast('success', `Plan updated: ${data.previous_plan} → ${data.new_plan}`);
      // Update local state
      setUsers(prev => prev.map(u => 
        u.id === editingUser.id ? { ...u, plan: data.new_plan as 'Free' | 'Pro', credits: data.new_credits } : u
      ));
      setEditingUser(prev => prev ? { ...prev, plan: data.new_plan as 'Free' | 'Pro', credits: data.new_credits } : null);
    } else {
      addToast('error', error || 'Failed to update plan');
    }
    setIsUpdating(false);
  };

  const openTemplateBoostModal = (template: TemplateStats) => {
    setBoostingTemplate(template);
    setBoostDisplayedUses(String(template.usage_count));
    setBoostVirtualUsername(VIRTUAL_USERNAME_SUGGESTIONS[0]);
    setBoostUsageDelta('1');
    setBoostRewardCredits('10');
    setBoostInternalNote('');
  };

  const closeTemplateBoostModal = () => {
    if (boostSaving) return;
    setBoostingTemplate(null);
  };

  const applyTemplateUseCount = async () => {
    if (!boostingTemplate || boostSaving) return;
    const useCount = Number(boostDisplayedUses);
    if (!Number.isSafeInteger(useCount) || useCount < 0) {
      addToast('error', 'Displayed uses must be a non-negative whole number.');
      return;
    }
    setBoostSaving(true);
    const { data, error } = await adminSetTemplateUseCount(
      boostingTemplate.template_id,
      useCount,
      boostInternalNote,
    );
    if (error || !data) {
      addToast('error', error || 'Could not update displayed uses.');
    } else {
      setTemplateStats((items) => items.map((item) => item.template_id === boostingTemplate.template_id
        ? { ...item, usage_count: data.newUseCount }
        : item));
      setBoostingTemplate((current) => current ? { ...current, usage_count: data.newUseCount } : current);
      setBoostDisplayedUses(String(data.newUseCount));
      addToast('success', `Displayed uses updated: ${data.previousUseCount} → ${data.newUseCount}`);
    }
    setBoostSaving(false);
  };

  const sendTemplateEncouragement = async () => {
    if (!boostingTemplate || boostSaving) return;
    const rewardCredits = Number(boostRewardCredits);
    const usageDelta = Number(boostUsageDelta);
    if (!/^[A-Za-z0-9_.]{2,30}$/.test(boostVirtualUsername.trim())) {
      addToast('error', 'Virtual username must be 2-30 letters, numbers, underscores, or dots.');
      return;
    }
    if (!Number.isSafeInteger(rewardCredits) || rewardCredits < 1 || rewardCredits > 10000) {
      addToast('error', 'Reward credits must be a whole number between 1 and 10,000.');
      return;
    }
    if (!Number.isSafeInteger(usageDelta) || usageDelta < 1 || usageDelta > 1000) {
      addToast('error', 'Usage increment must be a whole number between 1 and 1,000.');
      return;
    }

    setBoostSaving(true);
    const { data, error } = await adminIssueTemplateEncouragement({
      templateId: boostingTemplate.template_id,
      virtualUsername: boostVirtualUsername,
      rewardCredits,
      usageDelta,
      internalNote: boostInternalNote,
    });
    if (error || !data) {
      addToast('error', error || 'Could not send creator encouragement.');
    } else {
      setTemplateStats((items) => items.map((item) => item.template_id === boostingTemplate.template_id
        ? {
            ...item,
            usage_count: data.newUseCount,
            total_credits: item.total_credits + rewardCredits,
          }
        : item));
      announceCreatorRewardAvailable();
      addToast(
        'success',
        `${data.virtualUsername || boostVirtualUsername} used the template · ${rewardCredits} credits awarded`,
      );
      setBoostingTemplate(null);
    }
    setBoostSaving(false);
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  // Not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen pt-24 flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-16 h-16 text-red-500" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Access Denied</h1>
        <p className="text-slate-500">You don't have permission to access this page.</p>
        <Button onClick={() => navigate('/')}>Go Home</Button>
      </div>
    );
  }

  const totalPages = Math.ceil(usersTotal / 15);
  const visibleRewardTemplates = templateStats.filter((template) => {
    const query = boostTemplateSearch.trim().toLowerCase();
    return !query
      || template.template_name?.toLowerCase().includes(query)
      || template.template_id.toLowerCase().includes(query);
  });

  return (
    <div className="min-h-screen pt-24 px-4 pb-12">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin Panel</h1>
            <p className="text-sm text-slate-500">Manage users, credits, and view analytics</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-200 dark:border-white/10 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3, visible: true },
            { id: 'users', label: 'Users', icon: Users, visible: true },
            { id: 'templates', label: 'Top Templates', icon: TrendingUp, visible: false },
            { id: 'rewards', label: 'Creator Rewards', icon: Gift, visible: true },
            { id: 'unused', label: 'Low Usage', icon: AlertTriangle, visible: false },
            { id: 'review', label: 'Template Review', icon: Layers, visible: true },
          ].filter(tab => tab.visible).map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as TabType);
                if (tab.id === 'rewards') void loadTemplateStats();
              }}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="flex justify-end">
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={loadStats}
                disabled={statsLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${statsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {statsLoading && !stats ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard 
                  title="Total Users" 
                  value={stats.total_users} 
                  icon={Users}
                  color="blue"
                />
                <StatCard 
                  title="Pro Users" 
                  value={stats.pro_users} 
                  icon={Crown}
                  color="purple"
                  subtitle={`${((stats.pro_users / stats.total_users) * 100).toFixed(1)}%`}
                />
                <StatCard 
                  title="Total Generations" 
                  value={stats.total_generations} 
                  icon={TrendingUp}
                  color="green"
                />
                <StatCard 
                  title="Today's Generations" 
                  value={stats.generations_today} 
                  icon={Zap}
                  color="yellow"
                />
                <StatCard 
                  title="This Week" 
                  value={stats.generations_this_week} 
                  icon={BarChart3}
                  color="pink"
                />
                <StatCard 
                  title="Credits Used (Total)" 
                  value={stats.total_credits_used.toLocaleString()} 
                  icon={Zap}
                  color="orange"
                />
                <StatCard
                  title="Auth Popup Views"
                  value={popupImpressions?.impressionCount ?? 'Unavailable'}
                  icon={Eye}
                  color="purple"
                  subtitle={popupImpressions?.lastShownAt
                    ? `Last shown ${new Date(popupImpressions.lastShownAt).toLocaleString()}`
                    : 'Template detail sign-in popup'}
                />
              </div>
            ) : null}

            {authFunnel && (
              <div className="glass-panel rounded-2xl border border-slate-200 p-5 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-bold text-slate-900 dark:text-white">Registration Funnel</h2>
                    <p className="mt-1 text-xs text-slate-500">Unique browser sessions · Last {authFunnel.days} days</p>
                  </div>
                  <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 dark:bg-purple-500/10 dark:text-purple-300">
                    Refresh with Overview
                  </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ['signup_viewed', 'Signup viewed'],
                    ['signup_google_clicked', 'Google clicked'],
                    ['signup_email_submitted', 'Email submitted'],
                    ['signup_email_sent', 'Email sent'],
                    ['signup_completed', 'Signup completed'],
                    ['quick_use_restored', 'Quick Use restored'],
                  ].map(([eventName, label]) => {
                    const sessions = authFunnel.steps.find((step) => step.eventName === eventName)?.sessions || 0;
                    const signupViews = authFunnel.steps.find((step) => step.eventName === 'signup_viewed')?.sessions || 0;
                    const conversion = signupViews > 0 ? Math.round((sessions / signupViews) * 100) : 0;
                    return (
                      <div key={eventName} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">{sessions}</div>
                        <div className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">{label}</div>
                        <div className="mt-1 text-[11px] text-slate-400">{conversion}% of signup views</div>
                      </div>
                    );
                  })}
                </div>
                {authFunnel.errors.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-white/5">
                    <span className="text-xs font-semibold text-slate-500">Top blockers:</span>
                    {authFunnel.errors.map((item) => (
                      <span key={item.errorCode} className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                        {item.errorCode} · {item.sessions}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* Search */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={usersSearch}
                  onChange={(e) => setUsersSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUserSearch()}
                  placeholder="Search by email..."
                  className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>
              <Button onClick={handleUserSearch} disabled={usersLoading}>
                Search
              </Button>
            </div>

            {/* Users Table */}
            <div className="glass-panel rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 overflow-x-auto">
              {usersLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
              ) : (
                <table className="w-full min-w-[800px]">
                  <thead className="bg-slate-50 dark:bg-white/5">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Plan</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Credits</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Used</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gens</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Joined</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-900 dark:text-white">{u.email}</span>
                            {u.is_admin && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded">
                                ADMIN
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            u.plan === 'Pro' 
                              ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400'
                              : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400'
                          }`}>
                            {u.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono text-slate-900 dark:text-white">
                            {u.credits.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono text-orange-600 dark:text-orange-400">
                            {(u.total_credits_used || 0).toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono text-slate-500">
                            {(u.generation_count || 0).toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-500">
                            {new Date(u.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-1 justify-end">
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={() => openGenerationsModal(u)}
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              View
                            </Button>
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={() => openEditModal(u)}
                            >
                              <Settings className="w-3 h-3 mr-1" />
                              Edit
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  Showing {((usersPage - 1) * 15) + 1} - {Math.min(usersPage * 15, usersTotal)} of {usersTotal}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePageChange(usersPage - 1)}
                    disabled={usersPage === 1 || usersLoading}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="px-3 py-1 text-sm text-slate-600 dark:text-slate-300">
                    {usersPage} / {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePageChange(usersPage + 1)}
                    disabled={usersPage === totalPages || usersLoading}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Top Templates by Usage
              </h2>
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={loadTemplateStats}
                disabled={templateStatsLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${templateStatsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {templateStatsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {templateStats.map((t, idx) => (
                  <div 
                    key={t.template_id} 
                    className="glass-panel rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden hover:border-purple-300 dark:hover:border-purple-500/30 transition-colors"
                  >
                    {/* Thumbnail - 方形 */}
                    <div className="relative aspect-square bg-slate-100 dark:bg-slate-800">
                      {(t.thumb_url || t.image_url) ? (
                        <img 
                          src={t.thumb_url || t.image_url || ''} 
                          alt={t.template_name || 'Template'} 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Image className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                        </div>
                      )}
                      {/* Rank Badge */}
                      <div className={`absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx < 3 
                          ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white shadow-lg'
                          : 'bg-white/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10'
                      }`}>
                        {idx + 1}
                      </div>
                      {/* Uses Badge */}
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-bold bg-purple-500 text-white">
                        {t.usage_count} uses
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-2 space-y-2">
                      <h3 className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {t.template_name || t.template_id}
                      </h3>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] text-orange-500 font-mono">{t.total_credits.toLocaleString()} credits</p>
                        <button
                          type="button"
                          onClick={() => openTemplateBoostModal(t)}
                          className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-amber-500 to-pink-500 px-2 py-1 text-[10px] font-bold text-white shadow-sm hover:from-amber-600 hover:to-pink-600"
                        >
                          <Sparkles className="w-3 h-3" /> Golden finger
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Creator Rewards / Golden Finger Tab */}
        {activeTab === 'rewards' && (
          <div className="space-y-5">
            <div className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-pink-50 p-5 dark:border-amber-500/20 dark:from-amber-500/10 dark:to-pink-500/10 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Creator Rewards / Golden Finger
                  </h2>
                </div>
                <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                  Adjust a template's displayed usage count or issue an encouragement reward with a virtual username.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={loadTemplateStats}
                disabled={templateStatsLoading}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${templateStatsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={boostTemplateSearch}
                onChange={(event) => setBoostTemplateSearch(event.target.value)}
                placeholder="Search template name or ID..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-amber-500 dark:border-white/10 dark:bg-slate-900 dark:text-white"
              />
            </div>

            {templateStatsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              </div>
            ) : visibleRewardTemplates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 py-14 text-center text-sm text-slate-500 dark:border-white/20">
                No matching published templates.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/40">
                <div className="divide-y divide-slate-200 dark:divide-white/10">
                  {visibleRewardTemplates.map((template) => (
                    <div
                      key={template.template_id}
                      className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center"
                    >
                      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                        {template.thumb_url || template.image_url ? (
                          <img
                            src={template.thumb_url || template.image_url || ''}
                            alt={template.template_name || 'Template'}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Image className="h-6 w-6 text-slate-400" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold text-slate-900 dark:text-white">
                          {template.template_name || template.template_id}
                        </h3>
                        <p className="mt-1 truncate text-xs text-slate-400">{template.template_id}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-5 text-sm sm:text-right">
                        <div>
                          <p className="text-xs text-slate-400">Displayed uses</p>
                          <p className="font-semibold text-purple-600 dark:text-purple-400">
                            {template.usage_count.toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Credits earned</p>
                          <p className="font-semibold text-amber-600 dark:text-amber-400">
                            {template.total_credits.toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        className="bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:from-amber-600 hover:to-pink-600"
                        onClick={() => openTemplateBoostModal(template)}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Manage reward
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Unused Templates Tab */}
        {activeTab === 'unused' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Low Usage Templates
                </h2>
                <p className="text-sm text-slate-500">Templates with 2 or fewer uses</p>
              </div>
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={loadUnusedTemplates}
                disabled={unusedTemplatesLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${unusedTemplatesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {unusedTemplatesLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {unusedTemplates.map((t) => (
                  <div 
                    key={t.template_id} 
                    className="glass-panel rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden"
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-square bg-slate-100 dark:bg-slate-800">
                      {(t.thumb_url || t.image_url) ? (
                        <img 
                          src={t.thumb_url || t.image_url || ''} 
                          alt={t.template_name || 'Template'} 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Image className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                        </div>
                      )}
                      {/* Usage Badge */}
                      <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-bold ${
                        t.usage_count === 0 
                          ? 'bg-red-500 text-white'
                          : 'bg-yellow-500 text-white'
                      }`}>
                        {t.usage_count} uses
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-2">
                      <h3 className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {t.display_name || t.template_name || t.template_id}
                      </h3>
                      <p className="text-[10px] text-slate-400 truncate">{t.category}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {unusedTemplates.length === 0 && !unusedTemplatesLoading && (
              <div className="text-center py-12">
                <TrendingUp className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">All templates are being used!</h3>
                <p className="text-slate-500">No templates with low usage found.</p>
              </div>
            )}
          </div>
        )}
      </div>

        {/* Template Review Tab */}
        {activeTab === 'review' && (
          <div className="space-y-8 animate-in fade-in">
            {/* Pending Templates */}
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Template Review</h2>
                <p className="text-sm text-slate-500">Review workflow templates before they appear on Lazora.</p>
                <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-full text-sm font-medium">
                  {pendingTemplates.length} waiting for review
                </div>
              </div>

              {reviewsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
              ) : pendingTemplates.length === 0 ? (
                <div className="text-center py-12 glass-panel rounded-2xl border-dashed border-slate-300 dark:border-white/20">
                  <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">All caught up!</h3>
                  <p className="text-slate-500">There are no templates waiting for review.</p>
                </div>
              ) : (
                <div className="flex flex-wrap items-start gap-4">
                  {pendingTemplates.map(template => (
                    <div key={template.id} className="w-full sm:w-[270px] glass-panel border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden flex flex-col bg-white dark:bg-slate-800">
                      <button
                        type="button"
                        className="relative w-full aspect-video bg-slate-100 dark:bg-slate-900 overflow-hidden text-left group"
                        onClick={() => {
                          setReviewingTemplate(template);
                          setExpandedStep(template.steps[0]?.id || null);
                        }}
                        aria-label={`Review ${template.name}`}
                      >
                        {template.coverUrl && template.coverType === 'video' ? (
                          <video
                            src={template.coverUrl}
                            poster={template.coverPosterUrl}
                            className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]"
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="metadata"
                          />
                        ) : template.coverUrl ? (
                          <img src={template.coverUrl} className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]" alt={template.name} loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Image className="w-9 h-9 text-slate-300" />
                          </div>
                        )}
                        <div className="absolute top-2 left-2 z-10">
                          <span className="bg-amber-500/90 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded backdrop-blur-sm">In review</span>
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                          <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 drop-shadow" />
                        </div>
                      </button>
                      <div className="p-3 flex-1 flex flex-col">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-2 line-clamp-1">{template.name}</h4>
                        <div className="flex items-center gap-2 mb-2">
                          {template.authorAvatar ? (
                            <img src={template.authorAvatar} alt={template.authorName} className="w-5 h-5 rounded-full bg-slate-200" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-[9px] font-bold">
                              {template.authorName.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{template.authorName}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mb-3 flex items-center justify-between gap-2">
                          <span>{new Date(template.submittedAt).toLocaleDateString()}</span>
                          <span>{template.stepsCount} steps</span>
                        </div>
                        <div className="mt-auto">
                          <Button 
                            variant="gradient" 
                            className="w-full h-9 text-sm"
                            onClick={() => {
                              setReviewingTemplate(template);
                              setExpandedStep(template.steps[0]?.id || null);
                            }}
                          >
                            <Eye className="w-4 h-4 mr-2" /> Review
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recently Reviewed */}
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Recently reviewed</h3>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-white/5">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Template</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Author</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Reviewed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {reviewedTemplates.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">{t.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{t.authorName}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full ${
                            t.status === 'Published' 
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' 
                              : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                          }`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {new Date(t.reviewedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      {/* Admin-only template golden finger */}
      <Modal
        isOpen={!!boostingTemplate}
        onClose={closeTemplateBoostModal}
        title={`Golden finger: ${boostingTemplate?.template_name || 'Template'}`}
      >
        {boostingTemplate && (
          <div className="space-y-6">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Creator-facing rewards use the same popup and notification as a real template use. The internal source is visible only in the admin audit trail.
            </div>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-purple-500" />
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Displayed usage count</h4>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={boostDisplayedUses}
                  onChange={(event) => setBoostDisplayedUses(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-purple-500 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                />
                <Button
                  variant="secondary"
                  onClick={() => void applyTemplateUseCount()}
                  disabled={boostSaving}
                >
                  {boostSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save count'}
                </Button>
              </div>
            </section>

            <section className="space-y-4 border-t border-slate-200 pt-5 dark:border-white/10">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-pink-500" />
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Simulate a successful use</h4>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Displayed username</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={30}
                    value={boostVirtualUsername}
                    onChange={(event) => setBoostVirtualUsername(event.target.value)}
                    placeholder="Bananapiepie"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-pink-500 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const options = VIRTUAL_USERNAME_SUGGESTIONS.filter((name) => name !== boostVirtualUsername);
                      setBoostVirtualUsername(options[Math.floor(Math.random() * options.length)] || VIRTUAL_USERNAME_SUGGESTIONS[0]);
                    }}
                  >
                    Random
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Add to uses</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    value={boostUsageDelta}
                    onChange={(event) => setBoostUsageDelta(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-pink-500 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Reward credits</label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    step="1"
                    value={boostRewardCredits}
                    onChange={(event) => setBoostRewardCredits(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-pink-500 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Internal audit note (optional)</label>
                <textarea
                  maxLength={500}
                  value={boostInternalNote}
                  onChange={(event) => setBoostInternalNote(event.target.value)}
                  placeholder="Only administrators can see this note."
                  className="h-20 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-pink-500 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <Button
                className="w-full bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:from-amber-600 hover:to-pink-600"
                onClick={() => void sendTemplateEncouragement()}
                disabled={boostSaving || !boostVirtualUsername.trim() || !boostRewardCredits || !boostUsageDelta}
              >
                {boostSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sparkles className="mr-2 h-4 w-4" /> Send encouragement</>}
              </Button>
            </section>
          </div>
        )}
      </Modal>

      {/* Edit User Modal */}
      <Modal 
        isOpen={!!editingUser} 
        onClose={() => setEditingUser(null)} 
        title={`Edit User: ${editingUser?.email}`}
      >
        {editingUser && (
          <div className="space-y-6">
            {/* Current Status */}
            <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-xl space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Current Plan:</span>
                <span className={`text-sm font-medium ${editingUser.plan === 'Pro' ? 'text-purple-600' : 'text-slate-600 dark:text-slate-300'}`}>
                  {editingUser.plan}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Current Credits:</span>
                <span className="text-sm font-mono font-medium text-slate-900 dark:text-white">
                  {editingUser.credits.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Total Used:</span>
                <span className="text-sm font-mono font-medium text-orange-500">
                  {(editingUser.total_credits_used || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Generations:</span>
                <span className="text-sm font-mono font-medium text-slate-500">
                  {(editingUser.generation_count || 0).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Update Credits */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-500" />
                Update Credits
              </h4>
              <div className="flex gap-2">
                <select
                  value={creditOperation}
                  onChange={(e) => setCreditOperation(e.target.value as 'set' | 'add' | 'subtract')}
                  className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                >
                  <option value="add">Add (+)</option>
                  <option value="subtract">Subtract (-)</option>
                  <option value="set">Set to</option>
                </select>
                <input
                  type="number"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  placeholder="Amount"
                  min="0"
                  className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                />
                <Button 
                  onClick={handleUpdateCredits}
                  disabled={!creditAmount || isUpdating}
                  size="sm"
                >
                  {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                </Button>
              </div>
            </div>

            {/* Update Plan */}
            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-white/10">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Crown className="w-4 h-4 text-purple-500" />
                Update Plan
              </h4>
              <div className="flex gap-2">
                <select
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value as 'Free' | 'Pro')}
                  className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                >
                  <option value="Free">Free</option>
                  <option value="Pro">Pro</option>
                </select>
                <input
                  type="number"
                  value={bonusCredits}
                  onChange={(e) => setBonusCredits(e.target.value)}
                  placeholder="Bonus credits"
                  min="0"
                  className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg text-sm"
                />
                <Button 
                  onClick={handleUpdatePlan}
                  disabled={isUpdating}
                  size="sm"
                  variant="gradient"
                >
                  {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update'}
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Bonus credits will be added when changing plan
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* User Generations Modal */}
      <Modal
        isOpen={!!viewingUser}
        onClose={() => { setViewingUser(null); setPreviewGen(null); }}
        title={`Generations: ${viewingUser?.email}`}
      >
        {viewingUser && (
          <div className="space-y-4">
            {/* Stats bar */}
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{userGensTotal} total generations</span>
              {userGensTotal > 0 && (
                <span>
                  Page {userGensPage} / {Math.ceil(userGensTotal / 12)}
                </span>
              )}
            </div>



            {/* Loading */}
            {userGensLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              </div>
            ) : userGenerations.length === 0 ? (
              <div className="text-center py-12">
                <Image className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500">No generations found</p>
              </div>
            ) : (
              <>
                {/* Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
                  {userGenerations.map((gen) => (
                    <div 
                      key={gen.id}
                      className="group glass-panel rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden"
                    >
                      {/* Thumbnail */}
                      <div 
                        className="relative aspect-square bg-slate-100 dark:bg-slate-800 cursor-pointer"
                        onClick={() => setPreviewGen(gen)}
                      >
                        <img 
                          src={gen.image_url} 
                          alt={gen.template_name || 'Generation'}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Eye className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      {/* Info */}
                      <div className="p-2 space-y-1">
                        <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                          {gen.template_name || 'Custom prompt'}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate" title={gen.prompt}>
                          {gen.prompt}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-orange-500">
                            {gen.credits_used} cr
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(gen.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {userGensTotal > 12 && (
                  <div className="flex justify-center gap-2 pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => loadUserGenerations(viewingUser.id, userGensPage - 1)}
                      disabled={userGensPage === 1 || userGensLoading}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="px-3 py-1 text-sm text-slate-600 dark:text-slate-300">
                      {userGensPage} / {Math.ceil(userGensTotal / 12)}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => loadUserGenerations(viewingUser.id, userGensPage + 1)}
                      disabled={userGensPage === Math.ceil(userGensTotal / 12) || userGensLoading}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Fullscreen Image Preview (outside Modal so it's not clipped) */}
      {previewGen && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewGen(null)}
        >
          <button 
            className="absolute top-4 right-4 z-10 text-white/70 hover:text-white transition-colors"
            onClick={() => setPreviewGen(null)}
          >
            <X className="w-8 h-8" />
          </button>
          
          <div className="flex flex-col lg:flex-row gap-6 max-w-6xl w-full max-h-[90vh] items-center" onClick={(e) => e.stopPropagation()}>
            {/* Image */}
            <div className="flex-1 flex items-center justify-center min-h-0">
              <img 
                src={previewGen.image_url} 
                alt={previewGen.template_name || 'Generation'}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            </div>
            
            {/* Info Panel */}
            <div className="lg:w-80 w-full bg-white/10 backdrop-blur-sm rounded-xl p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Template</p>
                <p className="text-sm text-white font-medium">
                  {previewGen.template_name || 'Custom prompt'}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Full Prompt</p>
                <p className="text-sm text-white/90 whitespace-pre-wrap break-words leading-relaxed">
                  {previewGen.prompt || '(no prompt)'}
                </p>
              </div>
              <div className="flex gap-4">
                <div>
                  <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Credits</p>
                  <p className="text-sm text-orange-400 font-mono">{previewGen.credits_used}</p>
                </div>
                <div>
                  <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Date</p>
                  <p className="text-sm text-white/80">
                    {new Date(previewGen.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Image URL</p>
                <a 
                  href={previewGen.image_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 break-all"
                >
                  Open in new tab →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review media preview: open images large and play videos without enlarging the review card. */}
      {reviewMediaPreview && (
        <div
          className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setReviewMediaPreview(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 z-10 rounded-full bg-black/40 p-2 text-white/80 hover:text-white"
            onClick={() => setReviewMediaPreview(null)}
            aria-label="Close media preview"
          >
            <X className="w-7 h-7" />
          </button>
          <div
            className="w-full max-w-5xl max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            {reviewMediaPreview.type === 'video' ? (
              <video
                src={reviewMediaPreview.url}
                controls
                autoPlay
                playsInline
                preload="metadata"
                className="max-w-full max-h-[82vh] rounded-xl bg-black"
              />
            ) : reviewMediaPreview.type === 'audio' ? (
              <div className="w-full max-w-xl rounded-2xl bg-white p-6">
                <div className="mb-4 flex items-center justify-center gap-2 text-slate-700">
                  <Music className="h-6 w-6" />
                  <span className="font-medium">Audio material</span>
                </div>
                <audio
                  src={reviewMediaPreview.url}
                  controls
                  autoPlay
                  className="w-full"
                />
              </div>
            ) : (
              <img
                src={reviewMediaPreview.url}
                alt={reviewMediaPreview.title}
                className="max-w-full max-h-[82vh] object-contain rounded-xl"
              />
            )}
            <p className="text-sm text-white/80">{reviewMediaPreview.title}</p>
          </div>
        </div>
      )}

      {/* Template Review Detail Modal */}
      <Modal isOpen={!!reviewingTemplate} onClose={() => { setReviewingTemplate(null); setReviewMediaPreview(null); }} title="Review Template" size="lg">
        {reviewingTemplate && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="w-full md:w-[240px] md:flex-none">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Template Cover</p>
                {reviewingTemplate.coverUrl ? (
                  <button
                    type="button"
                    className="relative w-full aspect-video overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 group"
                    onClick={() => setReviewMediaPreview({
                      url: reviewingTemplate.coverUrl,
                      type: reviewingTemplate.coverType,
                      title: `${reviewingTemplate.name} cover`,
                    })}
                  >
                    {reviewingTemplate.coverType === 'video' ? (
                      <video
                        src={reviewingTemplate.coverUrl}
                        poster={reviewingTemplate.coverPosterUrl}
                        className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]"
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img src={reviewingTemplate.coverUrl} alt="Cover" className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]" />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
                      <Maximize2 className="w-7 h-7 text-white opacity-0 group-hover:opacity-100 drop-shadow" />
                    </span>
                  </button>
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10">
                    <Image className="w-9 h-9 text-slate-300" />
                  </div>
                )}
              </div>
              <div className="w-full md:w-[240px] md:flex-none">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Final Result</p>
                {reviewingTemplate.finalResultUrl ? (
                  <button
                    type="button"
                    className="group relative w-full aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-slate-800"
                    onClick={() => setReviewMediaPreview({
                      url: reviewingTemplate.finalResultUrl!,
                      type: reviewingTemplate.finalResultType === 'video' ? 'video' : 'image',
                      title: `${reviewingTemplate.name} final result`,
                    })}
                  >
                    {reviewingTemplate.finalResultType === 'video' ? (
                      <>
                        <video
                          src={reviewingTemplate.finalResultUrl}
                          poster={reviewingTemplate.finalResultPosterUrl}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25">
                          <PlayCircle className="h-10 w-10 text-white drop-shadow" />
                        </span>
                      </>
                    ) : (
                      <img
                        src={reviewingTemplate.finalResultUrl}
                        alt="Final result"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <Maximize2 className="absolute right-2 top-2 h-4 w-4 text-white drop-shadow" />
                  </button>
                ) : (
                  <div className="flex w-full aspect-video items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xs text-slate-400 dark:border-white/10 dark:bg-slate-800">
                    No final result
                  </div>
                )}
              </div>
              <div className="w-full md:flex-1 space-y-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">{reviewingTemplate.name}</h3>
                  <div className="flex items-center gap-2 mt-2">
                    {reviewingTemplate.authorAvatar ? (
                      <img src={reviewingTemplate.authorAvatar} alt="Author" className="w-5 h-5 rounded-full" />
                    ) : null}
                    <span className="text-sm text-slate-600 dark:text-slate-300">{reviewingTemplate.authorName}</span>
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-sm text-slate-700 dark:text-slate-300">
                  {reviewingTemplate.description}
                </div>
                <div className="text-xs text-slate-500">
                  Submitted At: {new Date(reviewingTemplate.submittedAt).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">Workflow Steps</h4>
              {reviewingTemplate.steps.map((step: any, idx: number) => (
                <div key={step.id} className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-slate-800">
                  <button 
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300">
                        {idx + 1}
                      </div>
                      <span className="font-medium text-slate-900 dark:text-white">{step.name}</span>
                    </div>
                    {expandedStep === step.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  
                  {expandedStep === step.id && (
                    <div className="p-4 border-t border-slate-200 dark:border-white/10 space-y-4 bg-slate-50 dark:bg-slate-900/50">
                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="w-full md:w-[190px] md:flex-none space-y-2">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Result from This Step</span>
                          {step.resultUrl ? (
                            <button
                              type="button"
                              className="relative block w-full aspect-video overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 group"
                              onClick={() => setReviewMediaPreview({
                                url: step.resultUrl,
                                type: step.resultType === 'video' ? 'video' : 'image',
                                title: `${step.name} result`,
                              })}
                            >
                              {step.resultType === 'video' ? (
                                <>
                                  <video src={step.resultUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                                  <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition-colors">
                                    <PlayCircle className="w-9 h-9 text-white drop-shadow" />
                                  </span>
                                </>
                              ) : (
                                <img src={step.resultUrl} alt="Step Result" className="w-full h-full object-cover" />
                              )}
                              <Maximize2 className="absolute top-2 right-2 w-4 h-4 text-white opacity-80 drop-shadow" />
                            </button>
                          ) : (
                            <div className="aspect-video flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-400">
                              No saved result preview
                            </div>
                          )}
                        </div>
                        <div className="w-full md:flex-1 space-y-4">
                          <div>
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Feature I Used</span>
                            <div className="text-sm font-medium text-slate-900 dark:text-white">{step.feature}</div>
                          </div>
                          
                          {step.materials.length > 0 && (
                            <div>
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Materials I Uploaded</span>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {step.materials.map((material: any, materialIndex: number) => (
                                  <button
                                    key={material.id}
                                    type="button"
                                    disabled={!material.url}
                                    onClick={() => material.url && setReviewMediaPreview({
                                      url: material.url,
                                      type: material.type,
                                      title: `${step.name} material ${materialIndex + 1}`,
                                    })}
                                    className="relative aspect-video overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-800"
                                  >
                                    {material.type === 'image' && material.url ? (
                                      <img
                                        src={material.url}
                                        alt={`${step.name} material ${materialIndex + 1}`}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                      />
                                    ) : material.type === 'video' && material.url ? (
                                      <>
                                        <video
                                          src={material.url}
                                          muted
                                          playsInline
                                          preload="metadata"
                                          className="h-full w-full object-cover"
                                        />
                                        <PlayCircle className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" />
                                      </>
                                    ) : (
                                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-slate-500 dark:text-slate-300">
                                        <Music className="h-6 w-6" />
                                        {material.url ? 'Play audio' : 'Preview unavailable'}
                                      </span>
                                    )}
                                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium capitalize text-white">
                                      {material.type}
                                    </span>
                                  </button>
                                ))}
                              </div>
                              <div className={`mt-1 text-xs font-medium ${step.reusable ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                {step.reusable ? 'Allowed to be reused' : 'Not allowed for reuse'}
                              </div>
                            </div>
                          )}

                          <div>
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Prompt & Settings I Set</span>
                            {step.prompt && (
                              <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-white/10 mb-2">
                                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{step.prompt}</p>
                              </div>
                            )}
                            <div className="text-sm text-slate-600 dark:text-slate-400 font-mono text-xs">
                              {step.settings}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-white/10 flex gap-3">
              <Button 
                variant="secondary" 
                className="flex-1 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10"
                disabled={reviewActionLoading}
                onClick={() => {
                  setRejectModalOpen(true);
                }}
              >
                Request changes
              </Button>
              <Button 
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20"
                disabled={reviewActionLoading || !reviewingTemplate.coverUrl}
                onClick={() => {
                  setApproveConfirmOpen(true);
                }}
              >
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Approve Confirm Modal */}
      <Modal isOpen={approveConfirmOpen} onClose={() => setApproveConfirmOpen(false)} title="Approve this template?">
        <div className="space-y-6">
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            It will become visible on the Templates homepage.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setApproveConfirmOpen(false)}>Cancel</Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20"
              disabled={reviewActionLoading}
              onClick={() => void submitTemplateReview('approve')}
            >
              {reviewActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reject Feedback Modal */}
      <Modal isOpen={rejectModalOpen} onClose={() => { setRejectModalOpen(false); setRejectFeedback(''); }} title="Request Changes">
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Feedback for the author</label>
            <textarea 
              className="w-full h-32 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none text-slate-900 dark:text-white"
              placeholder="e.g. Please use a clearer cover and explain what users should upload in Step 2."
              value={rejectFeedback}
              onChange={e => setRejectFeedback(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setRejectModalOpen(false); setRejectFeedback(''); }}>Cancel</Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={!rejectFeedback.trim() || reviewActionLoading}
              onClick={() => void submitTemplateReview('request_changes', rejectFeedback.trim())}
            >
              {reviewActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send feedback'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{
  title: string;
  value: number | string;
  icon: React.FC<{ className?: string }>;
  color: 'blue' | 'purple' | 'green' | 'yellow' | 'pink' | 'orange';
  subtitle?: string;
}> = ({ title, value, icon: Icon, color, subtitle }) => {
  const colorClasses = {
    blue: 'from-blue-500 to-cyan-500',
    purple: 'from-purple-500 to-pink-500',
    green: 'from-green-500 to-emerald-500',
    yellow: 'from-yellow-500 to-orange-500',
    pink: 'from-pink-500 to-rose-500',
    orange: 'from-orange-500 to-red-500',
  };

  return (
    <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-white/10">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
};

export default Admin;
