import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Image as ImageIcon, Calendar, Crown, ChevronDown, ChevronUp, ArrowLeft, CreditCard, AlertCircle, TrendingUp, Copy, Loader2, CheckCircle2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useStore } from '../context/StoreContext';
import { 
  fetchActiveSubscription, 
  fetchBillingHistory, 
  fetchUsageStats, 
  cancelAutoRenewal, 
  requestRefund,
  SubscriptionInfo,
  BillingHistoryItem,
  UsageStats
} from '../utils/subscription_api';

export interface ManageSubscriptionPageProps {
  user: {
    plan: 'Free' | 'Pro';
    credits: number;
    maxCredits: number;
    email: string;
    createdAt: string;
  };
  subscription?: {
    type: 'monthly' | 'yearly';
    nextBillingDate: string;
    amount: number;
    isCancelled: boolean;
    cancelledAt?: string;
  };
  stats: {
    imagesGeneratedThisMonth: number;
    imagesGeneratedLastMonth: number;
  };
  usageData: {
    daily: Array<{ date: string; credits: number }>;
    weekly: Array<{ week: string; credits: number }>;
    monthly: Array<{ month: string; credits: number }>;
  };
  billingHistory: Array<{
    id: string;
    orderId: string;
    date: string;
    description: string;
    amount: number;
    status: 'paid' | 'refunded' | 'cancelled' | 'active subscription';
    orderType: 'subscription' | 'credits';
    productType?: string;
    nextBillingDate?: string;
    isAutoRenewalCancelled?: boolean;
    refundEligible: boolean;
    refundIneligibleReason?: string;
    creditsUsed?: number;
    creditsGranted?: number;
    purchaseDate: string;
  }>;
  onCancelAutoRenewal: (orderId: string) => Promise<void>;
  onRequestRefund: (refundData: {
    orderId: string;
    reason: string;
    details?: string;
    contactEmail: string;
  }) => Promise<void>;
  onUpgrade: () => void;
  onBuyCredits: () => void;
  onBack: () => void;
}

export const ManageSubscriptionView: React.FC<ManageSubscriptionPageProps> = (props) => {
  const { user, subscription, stats, usageData, billingHistory, onCancelAutoRenewal, onRequestRefund, onUpgrade, onBuyCredits, onBack } = props;
// 🔴 添加调试日志
console.log('=== ManageSubscriptionView Props ===');
console.log('billingHistory prop:', billingHistory);
console.log('usageData prop:', usageData);
console.log('stats prop:', stats);
  const [showBillingHistory, setShowBillingHistory] = useState(false);
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // Cancel Order Modal States
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ManageSubscriptionPageProps['billingHistory'][0] | null>(null);
  
  // Radio option: 'auto-renewal' | 'refund'
  const [cancelType, setCancelType] = useState<'auto-renewal' | 'refund'>('refund');
  
  // Success Modals
  const [isAutoRenewalSuccessOpen, setIsAutoRenewalSuccessOpen] = useState(false);
  const [isRefundSuccessOpen, setIsRefundSuccessOpen] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundDetails, setRefundDetails] = useState('');
  const [refundEmail, setRefundEmail] = useState(user.email);
  const [refundError, setRefundError] = useState('');

  const creditsPercentage = Math.min(100, Math.max(0, (user.credits / Math.max(user.maxCredits, 1)) * 100));

  const chartData = usageData[timeframe] as any[];
  const totalCredits = chartData.reduce((sum, item) => sum + item.credits, 0);
  const avgCredits = Math.round(totalCredits / Math.max(1, chartData.length));
  const peakItem = chartData.reduce((max, item) => item.credits > max.credits ? item : max, chartData[0] || { credits: 0 });
  const peakLabel = peakItem.date || peakItem.week || peakItem.month;

  const handleOpenCancelModal = (order: ManageSubscriptionPageProps['billingHistory'][0]) => {
    setSelectedOrder(order);
    
    // Set default cancel type
    if (order.orderType === 'subscription') {
      setCancelType('auto-renewal');
    } else {
      setCancelType('refund');
    }

    setRefundReason('');
    setRefundDetails('');
    setRefundEmail(user.email);
    setRefundError('');
    setIsCancelModalOpen(true);
  };

  const handleCancelAutoRenewalSubmit = async () => {
    if (!selectedOrder) return;
    setIsSubmitting(true);
    try {
      await onCancelAutoRenewal(selectedOrder.id);
      setIsCancelModalOpen(false);
      setIsAutoRenewalSuccessOpen(true);
    } catch (e) {
      setRefundError('An error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitRefund = async () => {
    if (!refundReason) {
      setRefundError('Please select a reason for the refund.');
      return;
    }
    if (!refundEmail) {
      setRefundError('Please provide a contact email.');
      return;
    }
    if (!selectedOrder) return;

    setIsSubmitting(true);
    setRefundError('');
    try {
      await onRequestRefund({
        orderId: selectedOrder.id,
        reason: refundReason,
        details: refundDetails,
        contactEmail: refundEmail,
      });
      setIsCancelModalOpen(false);
      setIsRefundSuccessOpen(true);
    } catch (e) {
      setRefundError('An error occurred while submitting your refund request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pt-24 px-4 pb-12 bg-slate-50 dark:bg-slate-900">
      <div className="max-w-4xl mx-auto">
        <Button 
          variant="ghost" 
          className="mb-8 pl-0 hover:bg-transparent hover:text-purple-600 dark:hover:text-purple-400"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="mb-10">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Subscription & Usage</h1>
          <p className="text-slate-500 dark:text-slate-400 text-lg">
            Manage your plan and track your creative journey
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {/* Card A: Credits Overview */}
          <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-white/10 flex flex-col">
            <div className="flex items-center gap-3 mb-6 relative">
              <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-purple-600 dark:text-purple-400">
                <Zap className="w-5 h-5 fill-current" />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Credits Overview</h3>
            </div>
            <div className="mb-2">
              <span className="text-3xl font-bold text-slate-900 dark:text-white">{user.credits}</span>
              <span className="text-slate-500 dark:text-slate-400 font-medium"> / {user.maxCredits}</span>
            </div>
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full mb-3 overflow-hidden">
              <div 
                className={`h-full rounded-full ${creditsPercentage < 10 ? 'bg-red-500' : 'bg-gradient-to-r from-purple-500 to-pink-500'}`}
                style={{ width: `${creditsPercentage}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-auto">
              {user.plan === 'Pro' ? 'Credits refresh monthly' : 'One-time welcome bonus'}
            </p>
          </div>

          {/* Card B: This Month's Activity */}
          <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-white/10 flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-pink-100 dark:bg-pink-900/40 flex items-center justify-center text-pink-600 dark:text-pink-400">
                <ImageIcon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white">This Month</h3>
            </div>
            <div className="mb-2">
              <span className="text-3xl font-bold text-slate-900 dark:text-white">{stats.imagesGeneratedThisMonth}</span>
              <span className="text-slate-500 dark:text-slate-400 font-medium"> images</span>
            </div>
            <div className="mt-auto">
              {stats.imagesGeneratedThisMonth >= stats.imagesGeneratedLastMonth ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-900/20 inline-block px-2 py-1 rounded-md">
                  +{stats.imagesGeneratedThisMonth - stats.imagesGeneratedLastMonth} from last month
                </p>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Generated this month
                </p>
              )}
            </div>
          </div>

          {/* Card C: Your Plan */}
          <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-white/10 flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <Crown className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Your Plan</h3>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {user.plan === 'Pro' ? 'Pro Plan' : 'Free Plan'}
              </span>
              {user.plan === 'Pro' && <Crown className="w-6 h-6 text-yellow-500" />}
            </div>
            <div className="mb-2">
               {user.plan === 'Pro' && subscription ? (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Billed {subscription.type}
                  </p>
                ) : (
                  <button 
                    onClick={onUpgrade}
                    className="text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center"
                  >
                    Upgrade &rarr;
                  </button>
                )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-auto border-t border-slate-100 dark:border-white/10 pt-4">
              {user.plan === 'Pro' && subscription 
                ? subscription.isCancelled 
                  ? `Cancels on ${new Date(subscription.nextBillingDate).toLocaleDateString()}` 
                  : `Next billing: ${new Date(subscription.nextBillingDate).toLocaleDateString()}`
                : 'Unlock premium features'
              }
            </p>
          </div>
        </div>

        {/* Usage Analytics */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-white/10 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Usage Analytics</h2>
            </div>
            
            <div className="flex bg-slate-100 dark:bg-slate-800/50 p-1 rounded-full border border-slate-200 dark:border-white/5">
              {(['daily', 'weekly', 'monthly'] as const).map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                    timeframe === tf 
                      ? 'bg-purple-500 text-white shadow-sm' 
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {tf.charAt(0).toUpperCase() + tf.slice(1)}
                </button>
              ))}
            </div>
          </div>
          
          <div className="h-[250px] w-full mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCredits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey={timeframe === 'daily' ? 'date' : timeframe === 'weekly' ? 'week' : 'month'} 
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  dy={10}
                />
                <YAxis 
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  dx={-10}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                  }}
                  itemStyle={{ color: '#c084fc', fontWeight: 'bold' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="credits" 
                  stroke="#8B5CF6" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorCredits)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          
          <div className="pt-4 border-t border-slate-100 dark:border-white/10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400 justify-center sm:justify-start">
            <span>Total current period: <strong className="text-slate-900 dark:text-white">{totalCredits.toLocaleString()} credits</strong></span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-600">|</span>
            <span>Average: <strong className="text-slate-900 dark:text-white">{avgCredits.toLocaleString()}/{timeframe === 'daily' ? 'day' : timeframe === 'weekly' ? 'week' : 'month'}</strong></span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-600">|</span>
            <span>Peak usage: <strong className="text-slate-900 dark:text-white">{peakItem.credits} credits</strong> on {peakLabel}</span>
          </div>
        </div>

        {/* Billing History (Collapsible) */}
        <div className="glass-panel overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 mb-8">
          <button 
            onClick={() => setShowBillingHistory(!showBillingHistory)}
            className="w-full flex items-center justify-between p-6 bg-transparent hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3">
              <CreditCard className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Billing History</h2>
            </div>
            {showBillingHistory ? (
              <ChevronUp className="w-5 h-5 text-slate-400" />
            ) : (
               <ChevronDown className="w-5 h-5 text-slate-400" />
            )}
          </button>
          
          {showBillingHistory && (
            <div className="border-t border-slate-100 dark:border-white/5">
              {billingHistory.length > 0 ? (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-6 py-3 font-medium">Order ID</th>
                      <th className="px-6 py-3 font-medium">Date</th>
                      <th className="px-6 py-3 font-medium">Description</th>
                      <th className="px-6 py-3 font-medium text-right">Amount</th>
                      <th className="px-6 py-3 font-medium text-center">Status</th>
                      <th className="px-6 py-3 font-medium text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {billingHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 font-mono text-xs text-slate-600 dark:text-slate-400">
                            {item.orderId}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(item.orderId);
                              }}
                              className="focus:outline-none hover:text-slate-900 dark:hover:text-white"
                              title="Copy Order ID"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                          {item.date}
                        </td>
                        <td className="px-6 py-4 text-slate-900 dark:text-white font-medium">
                          {item.description}
                        </td>
                        <td className="px-6 py-4 text-right text-slate-900 dark:text-white font-medium">
                          ${item.amount.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            item.status === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            item.status === 'active subscription' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                            'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {item.status !== 'refunded' && item.status !== 'cancelled' ? (
                            <button 
                              onClick={() => handleOpenCancelModal(item)}
                              className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 focus:outline-none"
                            >
                              Cancel
                            </button>
                          ) : (
                            <button 
                              disabled
                              className="text-xs font-semibold text-slate-400 dark:text-slate-600 cursor-not-allowed focus:outline-none"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                  No billing history available yet.
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Cancel Order Modal */}
      <Modal 
        isOpen={isCancelModalOpen} 
        onClose={() => setIsCancelModalOpen(false)} 
        title="Cancel Order"
        footer={
          selectedOrder && (
            <div className="flex justify-end gap-3 w-full">
              <Button variant="outline" onClick={() => setIsCancelModalOpen(false)}>
                Cancel
              </Button>
              {cancelType === 'auto-renewal' ? (
                <Button 
                  variant="gradient" 
                  onClick={handleCancelAutoRenewalSubmit} 
                  disabled={isSubmitting || selectedOrder.isAutoRenewalCancelled}
                >
                  {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</> : 'Confirm Cancellation'}
                </Button>
              ) : (
                 <Button 
                  variant="gradient" 
                  onClick={handleSubmitRefund} 
                  disabled={isSubmitting || !selectedOrder.refundEligible || !refundReason || !refundEmail}
                  className="disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:from-slate-400 disabled:to-slate-400"
                >
                  {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</> : 'Submit Request'}
                </Button>
              )}
            </div>
          )
        }
      >
        {selectedOrder && (
          <div className="space-y-6">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-white/5 text-sm">
              <div className="grid grid-cols-2 gap-y-2">
                <div className="text-slate-500 dark:text-slate-400">Order:</div>
                <div className="text-slate-900 dark:text-white font-mono">{selectedOrder.orderId}</div>
                <div className="text-slate-500 dark:text-slate-400">Date:</div>
                <div className="text-slate-900 dark:text-white">{selectedOrder.date}</div>
                <div className="text-slate-500 dark:text-slate-400">Amount:</div>
                <div className="text-slate-900 dark:text-white font-medium">${selectedOrder.amount.toFixed(2)}</div>
                <div className="text-slate-500 dark:text-slate-400">Description:</div>
                <div className="text-slate-900 dark:text-white">{selectedOrder.description}</div>
              </div>
            </div>

            <div className="space-y-3">
              {selectedOrder.orderType === 'subscription' && (
                <label className={`block border rounded-xl p-4 transition-colors ${
                  selectedOrder.isAutoRenewalCancelled
                    ? 'border-slate-200 dark:border-white/5 opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800/30'
                    : cancelType === 'auto-renewal' 
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/10 cursor-pointer' 
                      : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <input 
                        type="radio" 
                        name="cancel_type" 
                        value="auto-renewal"
                        disabled={selectedOrder.isAutoRenewalCancelled}
                        checked={cancelType === 'auto-renewal'}
                        onChange={() => setCancelType('auto-renewal')}
                        className="w-4 h-4 text-purple-600 border-slate-300 focus:ring-purple-500 dark:border-slate-600 dark:bg-slate-700 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white text-sm">Cancel Auto-Renewal</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {selectedOrder.isAutoRenewalCancelled 
                          ? 'Auto-renewal has already been cancelled for this subscription.'
                          : `Your Pro benefits will continue until ${selectedOrder.nextBillingDate ? new Date(selectedOrder.nextBillingDate).toLocaleDateString() : 'the end of the cycle'}. You won't be charged again.`
                        }
                      </div>
                      {selectedOrder.isAutoRenewalCancelled && (
                        <div className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Already cancelled
                        </div>
                      )}
                    </div>
                  </div>
                </label>
              )}

                <label className={`block border rounded-xl p-4 transition-colors ${
                  !selectedOrder.refundEligible 
                    ? 'border-slate-200 dark:border-white/5 opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800/30' 
                    : cancelType === 'refund'
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/10 cursor-pointer'
                      : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <input 
                        type="radio" 
                        name="cancel_type" 
                        value="refund"
                        disabled={!selectedOrder.refundEligible}
                        checked={cancelType === 'refund'}
                        onChange={() => setCancelType('refund')}
                        className="w-4 h-4 text-purple-600 border-slate-300 focus:ring-purple-500 dark:border-slate-600 dark:bg-slate-700 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white text-sm">Cancel Order & Request Refund</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Cancel this order and request a full refund.
                      </div>
                      {!selectedOrder.refundEligible && selectedOrder.refundIneligibleReason && (
                        <div className="text-xs text-red-500 dark:text-red-400 mt-2 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          {selectedOrder.refundIneligibleReason}
                        </div>
                      )}
                    </div>
                  </div>
                </label>
            </div>

            <div className={`grid transition-all duration-300 ease-in-out ${cancelType === 'refund' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <hr className="border-slate-200 dark:border-white/10 mb-6" />
                <div className="space-y-4 px-1 pb-1">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Reason <span className="text-red-500">*</span>
                    </label>
                    <select 
                      className={`w-full bg-slate-50 dark:bg-slate-800/80 border ${refundError && !refundReason ? 'border-red-500' : 'border-slate-200 dark:border-white/10'} rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white`}
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                    >
                      <option value="" disabled>Select a reason...</option>
                      <option value="Product doesn't meet my needs">Product doesn't meet my needs</option>
                      <option value="Found a better alternative">Found a better alternative</option>
                      <option value="Too expensive">Too expensive</option>
                      <option value="Technical issues">Technical issues</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Details <span className="text-slate-400 dark:text-slate-500 font-normal">(optional)</span>
                    </label>
                    <textarea 
                      className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white resize-none"
                      rows={3}
                      maxLength={500}
                      placeholder="Please provide more details..."
                      value={refundDetails}
                      onChange={(e) => setRefundDetails(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Contact Email <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="email"
                      className={`w-full bg-slate-50 dark:bg-slate-800/80 border ${refundError && !refundEmail ? 'border-red-500' : 'border-slate-200 dark:border-white/10'} rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white`}
                      placeholder="your@email.com"
                      value={refundEmail}
                      onChange={(e) => setRefundEmail(e.target.value)}
                    />
                  </div>
                  {refundError && <div className="text-red-500 text-sm mt-2">{refundError}</div>}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/30 p-4 rounded-xl border border-slate-200 dark:border-white/5">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white mb-2">
                {cancelType === 'auto-renewal' ? '📋 Cancellation Policy' : '📋 Refund Policy'}
              </h4>
              {cancelType === 'auto-renewal' ? (
                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 pl-6 list-disc">
                  <li>Your subscription remains active until {selectedOrder.nextBillingDate ? new Date(selectedOrder.nextBillingDate).toLocaleDateString() : 'the next billing date'}</li>
                  <li>You will lose any Pro plan privileges at the end of the billing cycle</li>
                  <li>You will not be charged again unless you resubscribe</li>
                </ul>
              ) : (
                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 pl-6 list-disc">
                  <li>Full refund strictly within 14 days of purchase</li>
                  <li>Ineligible if any credits from the order have been used</li>
                  <li>Standard processing time varies from 5-10 business days</li>
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Auto-Renewal Success Modal */}
      <Modal isOpen={isAutoRenewalSuccessOpen} onClose={() => setIsAutoRenewalSuccessOpen(false)}>
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Auto-Renewal Cancelled</h3>
          <p className="text-slate-500 dark:text-slate-400 mb-4 px-4 text-sm">
            Your auto-renewal has been correctly cancelled. You can continue to use your benefits until the end of your billing cycle. After that, your plan will be changed to Free.
          </p>
          <Button variant="gradient" className="mt-4" onClick={() => setIsAutoRenewalSuccessOpen(false)}>
            Got It
          </Button>
        </div>
      </Modal>

      {/* Refund Success Modal */}
      <Modal isOpen={isRefundSuccessOpen} onClose={() => setIsRefundSuccessOpen(false)}>
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Refund Request Submitted</h3>
          <p className="text-slate-500 dark:text-slate-400 mb-4 px-4 text-sm">
            Your refund request has been received and will be processed within 3-5 business days. 
            <br className="mt-2" />
            If you don't receive a response, please contact us at: <a href="mailto:support@lazoraai.com" className="text-purple-600 dark:text-purple-400 hover:underline">support@lazoraai.com</a>
          </p>
          <Button variant="gradient" className="mt-4" onClick={() => setIsRefundSuccessOpen(false)}>
            Got It
          </Button>
        </div>
      </Modal>

    </div>
  );
};

// Container Component connecting to actual app state
export const ManageSubscription = () => {
  const { user } = useStore();
  const navigate = useNavigate();

  // Loading and data states
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [activeSubscription, setActiveSubscription] = useState<SubscriptionInfo | null>(null);
  const [billingHistory, setBillingHistory] = useState<BillingHistoryItem[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);

  // Fetch all data on mount
  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const [subscriptionResult, billingResult, usageResult] = await Promise.all([
          fetchActiveSubscription(),
          fetchBillingHistory(),
          fetchUsageStats()
        ]);
        
        // 🔴 添加调试日志
        console.log('=== ManageSubscription API Results ===');
        console.log('subscriptionResult:', subscriptionResult);
        console.log('billingResult:', billingResult);
        console.log('usageResult:', usageResult);
        
        // Check for errors
        if (subscriptionResult.error && billingResult.error && usageResult.error) {
          setError('Failed to load subscription data. Please try again.');
          return;
        }
        
        setActiveSubscription(subscriptionResult.data);
        setBillingHistory(billingResult.data);
        setUsageStats(usageResult.data);
        
        // 🔴 添加调试日志
        console.log('=== State After Set ===');
        console.log('activeSubscription set to:', subscriptionResult.data);
        console.log('billingHistory set to:', billingResult.data);
        console.log('usageStats set to:', usageResult.data);
      } catch (err) {
        console.error('Failed to load subscription data:', err);
        setError('Failed to load subscription data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [user, navigate]);

  if (!user) return null;

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen pt-24 px-4 pb-12 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Loading subscription data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen pt-24 px-4 pb-12 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-4" />
          <p className="text-slate-900 dark:text-white font-medium mb-2">Error</p>
          <p className="text-slate-500 dark:text-slate-400 mb-4">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // Transform data for the view component
  const subscription = activeSubscription ? {
    type: activeSubscription.type,
    nextBillingDate: activeSubscription.nextBillingDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    amount: activeSubscription.amount,
    isCancelled: activeSubscription.isCancelled,
    cancelledAt: activeSubscription.cancelledAt,
  } : undefined;

  const stats = {
    imagesGeneratedThisMonth: usageStats?.imagesThisMonth || 0,
    imagesGeneratedLastMonth: usageStats?.imagesLastMonth || 0,
  };

  // Transform usage data - handle empty arrays
  const usageData = {
    daily: (usageStats?.daily || []).map(d => ({ date: d.date, credits: d.credits })),
    weekly: (usageStats?.weekly || []).map(w => ({ week: w.week, credits: w.credits })),
    monthly: (usageStats?.monthly || []).map(m => ({ month: m.month, credits: m.credits })),
  };

  // If no usage data, provide minimal fallback to prevent chart errors
  if (usageData.daily.length === 0) {
    usageData.daily = [{ date: 'Today', credits: 0 }];
  }
  if (usageData.weekly.length === 0) {
    usageData.weekly = [{ week: 'This Week', credits: 0 }];
  }
  if (usageData.monthly.length === 0) {
    usageData.monthly = [{ month: 'This Month', credits: 0 }];
  }

  const formattedBillingHistory: ManageSubscriptionPageProps['billingHistory'] = billingHistory.map(record => ({
    id: record.id,
    orderId: record.orderId,
    date: record.date,
    description: record.description,
    amount: record.amount,
    status: record.status,
    orderType: record.orderType,
    productType: record.productType,
    nextBillingDate: activeSubscription?.nextBillingDate,
    isAutoRenewalCancelled: activeSubscription?.isCancelled,
    refundEligible: record.refundEligible,
    refundIneligibleReason: record.refundIneligibleReason,
    creditsUsed: record.creditsUsed,
    creditsGranted: record.creditsGranted,
    purchaseDate: record.purchaseDate,
  }));

  const handleCancelAutoRenewal = async (orderId: string) => {
    // Find the subscription_id from billing history
    const record = billingHistory.find(r => r.id === orderId);
    if (!record?.subscriptionId) {
      throw new Error('Subscription ID not found');
    }
    
    const result = await cancelAutoRenewal(record.subscriptionId);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to cancel subscription');
    }
    
    // Refresh data after cancellation
    const [subscriptionResult, billingResult] = await Promise.all([
      fetchActiveSubscription(),
      fetchBillingHistory()
    ]);
    setActiveSubscription(subscriptionResult.data);
    setBillingHistory(billingResult.data);
  };

  const handleRequestRefund = async (data: {
    orderId: string;
    reason: string;
    details?: string;
    contactEmail: string;
  }) => {
    const result = await requestRefund({
      purchaseId: data.orderId,
      reason: data.reason,
      details: data.details,
      contactEmail: data.contactEmail,
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to request refund');
    }
    
    // Refresh billing history after refund request
    const billingResult = await fetchBillingHistory();
    setBillingHistory(billingResult.data);
  };

  return (
    <ManageSubscriptionView 
      user={{
        plan: user.plan as 'Free' | 'Pro',
        credits: user.credits,
        maxCredits: user.maxCredits || (user.plan === 'Pro' ? 3000 : 100),
        email: user.email,
        createdAt: user.createdAt || new Date().toISOString()
      }}
      subscription={subscription}
      stats={stats}
      usageData={usageData}
      billingHistory={formattedBillingHistory}
      onCancelAutoRenewal={handleCancelAutoRenewal}
      onRequestRefund={handleRequestRefund}
      onUpgrade={() => navigate('/pricing')}
      onBuyCredits={() => navigate('/pricing')}
      onBack={() => navigate(-1)}
    />
  );
};