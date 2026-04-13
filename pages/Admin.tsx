import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, Users, TrendingUp, Zap, Search, Crown, 
  ChevronLeft, ChevronRight, Loader2, AlertCircle,
  Plus, Minus, Settings, BarChart3, RefreshCw
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { 
  checkIsAdmin, 
  adminGetUsers, 
  adminGetStats, 
  adminGetTemplateStats,
  adminUpdateCredits,
  adminUpdatePlan
} from '../utils/adminApi';
import { AdminUser, AdminStats, TemplateStats } from '../types';

type TabType = 'overview' | 'users' | 'templates';

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

  // Edit user modal state
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditOperation, setCreditOperation] = useState<'set' | 'add' | 'subtract'>('add');
  const [newPlan, setNewPlan] = useState<'Free' | 'Pro'>('Free');
  const [bonusCredits, setBonusCredits] = useState('0');
  const [isUpdating, setIsUpdating] = useState(false);

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

  // Load data when tab changes
  useEffect(() => {
    if (!isAdmin) return;

    if (activeTab === 'overview' && !stats) {
      loadStats();
    } else if (activeTab === 'users' && users.length === 0) {
      loadUsers(1, '');
    } else if (activeTab === 'templates' && templateStats.length === 0) {
      loadTemplateStats();
    }
  }, [activeTab, isAdmin, stats, users.length, templateStats.length, loadStats, loadUsers, loadTemplateStats]);

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
        u.id === editingUser.id ? { ...u, plan: data.new_plan, credits: data.new_credits } : u
      ));
      setEditingUser(prev => prev ? { ...prev, plan: data.new_plan, credits: data.new_credits } : null);
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
        <div className="flex gap-2 mb-6 border-b border-slate-200 dark:border-white/10">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'templates', label: 'Templates', icon: TrendingUp },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
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
            <div className="glass-panel rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
              {usersLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-white/5">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Plan</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Credits</th>
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
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono text-slate-900 dark:text-white">
                            {u.credits.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-500">
                            {new Date(u.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button 
                            variant="secondary" 
                            size="sm"
                            onClick={() => openEditModal(u)}
                          >
                            <Settings className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
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
                Template Usage Rankings
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

            <div className="glass-panel rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
              {templateStatsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-white/5">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Rank</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Template</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Uses</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Credits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {templateStats.map((t, idx) => (
                      <tr key={t.template_id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`w-6 h-6 inline-flex items-center justify-center rounded-full text-xs font-bold ${
                            idx < 3 
                              ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white'
                              : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400'
                          }`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-900 dark:text-white">
                            {t.template_name || t.template_id}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono text-slate-900 dark:text-white">
                            {t.usage_count.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono text-slate-500">
                            {t.total_credits.toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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