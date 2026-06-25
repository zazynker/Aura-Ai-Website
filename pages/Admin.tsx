import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, Users, TrendingUp, Zap, Search, Crown, 
  ChevronLeft, ChevronRight, Loader2, AlertCircle,
  Settings, BarChart3, RefreshCw, Image, AlertTriangle,
  Eye, X
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { 
  checkIsAdmin, 
  adminGetUsers, 
  adminGetStats, 
  adminGetTemplateStats,
  adminGetUnusedTemplates,
  adminUpdateCredits,
  adminUpdatePlan,
  adminGetUserGenerations,
  AdminGeneration
} from '../utils/adminApi';
import { AdminUser, AdminStats, TemplateStats, UnusedTemplate } from '../types';

type TabType = 'overview' | 'users' | 'templates' | 'unused';

export const Admin = () => {
  const navigate = useNavigate();
  const { user, addToast } = useStore();
  
  // Auth state
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Stats state
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // Template stats state
  const [templateStats, setTemplateStats] = useState<TemplateStats[]>([]);
  const [templateStatsLoading, setTemplateStatsLoading] = useState(false);

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
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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
    const { data, error } = await adminGetStats();
    if (error) {
      addToast('error', `Failed to load stats: ${error}`);
    } else if (data) {
      setStats(data);
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
    const { data, error } = await adminGetTemplateStats(30);
    if (error) {
      addToast('error', `Failed to load template stats: ${error}`);
    } else if (data) {
      setTemplateStats(data);
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
    }
  }, [activeTab, isAdmin, stats, users.length, templateStats.length, unusedTemplates.length, loadStats, loadUsers, loadTemplateStats, loadUnusedTemplates]);

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
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'templates', label: 'Top Templates', icon: TrendingUp },
            { id: 'unused', label: 'Low Usage', icon: AlertTriangle },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
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
              </div>
            ) : null}
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
                    <div className="p-2">
                      <h3 className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {t.template_name || t.template_id}
                      </h3>
                      <p className="text-[10px] text-orange-500 font-mono">{t.total_credits.toLocaleString()} credits</p>
                    </div>
                  </div>
                ))}
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
        onClose={() => { setViewingUser(null); setPreviewImage(null); }}
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

            {/* Image Preview */}
            {previewImage && (
              <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
                <button 
                  className="absolute top-4 right-4 text-white hover:text-slate-300"
                  onClick={() => setPreviewImage(null)}
                >
                  <X className="w-8 h-8" />
                </button>
                <img 
                  src={previewImage} 
                  alt="Preview" 
                  className="max-w-full max-h-[90vh] object-contain rounded-lg"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}

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
                        onClick={() => setPreviewImage(gen.image_url)}
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