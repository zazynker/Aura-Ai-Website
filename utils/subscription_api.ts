/**
 * Subscription API
 * 订阅相关的 API 调用
 */

import { supabase } from './supabase';
import { env } from '../config/env';

// ============================================
// Types
// ============================================

export interface SubscriptionInfo {
  id: string;
  subscriptionId: string;
  type: 'monthly' | 'yearly';
  status: 'active' | 'cancelled' | 'expired';
  nextBillingDate: string;
  amount: number;
  isCancelled: boolean;
  cancelledAt?: string;
  creditsPerMonth: number;
}

export interface BillingHistoryItem {
  id: string;
  orderId: string;
  date: string;
  description: string;
  amount: number;
  status: 'paid' | 'refunded' | 'cancelled' | 'active subscription';
  orderType: 'subscription' | 'credits';
  productType: string;
  nextBillingDate?: string;
  isAutoRenewalCancelled?: boolean;
  refundEligible: boolean;
  refundIneligibleReason?: string;
  creditsUsed: number;
  creditsGranted: number;
  purchaseDate: string;
  paymentId?: string;
  subscriptionId?: string;
}

export interface UsageStats {
  daily: Array<{ date: string; credits: number }>;
  weekly: Array<{ week: string; credits: number }>;
  monthly: Array<{ month: string; credits: number }>;
  imagesThisMonth: number;
  imagesLastMonth: number;
}

export interface RefundParams {
  purchaseId: string;
  reason: string;
  details?: string;
  contactEmail: string;
}

// ============================================
// API Functions
// ============================================

/**
 * 获取用户的活跃订阅信息
 */
export async function fetchActiveSubscription(): Promise<{
  data: SubscriptionInfo | null;
  error: string | null;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: null, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('active_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching subscription:', error);
      return { data: null, error: error.message };
    }

    if (!data) {
      return { data: null, error: null };
    }

    // Map database fields to frontend format
    const subscription: SubscriptionInfo = {
      id: data.id,
      subscriptionId: data.subscription_id,
      type: data.product_type.includes('yearly') ? 'yearly' : 'monthly',
      status: data.status,
      nextBillingDate: data.next_issue_at,
      amount: data.product_type.includes('yearly') ? 238.80 : 29.00,
      isCancelled: data.status === 'cancelled',
      cancelledAt: data.cancelled_at,
      creditsPerMonth: data.credits_per_month,
    };

    return { data: subscription, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch subscription' };
  }
}

/**
 * 获取用户的账单历史
 * 调用 Supabase RPC 函数 get_billing_history
 */
export async function fetchBillingHistory(): Promise<{
  data: BillingHistoryItem[];
  error: string | null;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: [], error: 'Not authenticated' };
    }

    const { data, error } = await supabase.rpc('get_billing_history', {
      p_user_id: user.id
    });

    if (error) {
      console.error('Error fetching billing history:', error);
      return { data: [], error: error.message };
    }

    // Map database format to frontend format
    const billingHistory: BillingHistoryItem[] = (data || []).map((item: any) => ({
      id: item.id,
      orderId: item.order_id,
      date: new Date(item.purchase_date).toLocaleDateString('en-US'),
      description: item.description,
      amount: item.amount_cents / 100,
      status: item.status as BillingHistoryItem['status'],
      orderType: item.order_type as 'subscription' | 'credits',
      productType: item.product_type,
      refundEligible: item.refund_eligible,
      refundIneligibleReason: item.refund_ineligible_reason,
      creditsUsed: item.credits_used || 0,
      creditsGranted: item.credits_granted || 0,
      purchaseDate: item.purchase_date,
      paymentId: item.payment_id,
      subscriptionId: item.subscription_id,
    }));

    return { data: billingHistory, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: [], error: 'Failed to fetch billing history' };
  }
}

/**
 * 获取用户的使用统计
 * 调用 Supabase RPC 函数 get_usage_stats
 */
export async function fetchUsageStats(): Promise<{
  data: UsageStats | null;
  error: string | null;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { data: null, error: 'Not authenticated' };
    }

    const { data, error } = await supabase.rpc('get_usage_stats', {
      p_user_id: user.id
    });

    if (error) {
      console.error('Error fetching usage stats:', error);
      return { data: null, error: error.message };
    }

    // The RPC returns a JSON object with daily, weekly, monthly arrays
    const stats: UsageStats = {
      daily: data?.daily || [],
      weekly: data?.weekly || [],
      monthly: data?.monthly || [],
      imagesThisMonth: data?.imagesThisMonth || 0,
      imagesLastMonth: data?.imagesLastMonth || 0,
    };

    return { data: stats, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { data: null, error: 'Failed to fetch usage stats' };
  }
}

/**
 * 取消自动续费
 * 调用 Edge Function cancel-subscription
 */
export async function cancelAutoRenewal(subscriptionId: string): Promise<{
  success: boolean;
  nextBillingDate?: string;
  error: string | null;
}> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch(
      `${env.supabase.url}/functions/v1/cancel-subscription`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ subscriptionId }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.error || 'Failed to cancel subscription' };
    }

    return {
      success: true,
      nextBillingDate: result.nextBillingDate,
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to cancel subscription' };
  }
}

/**
 * 检查退款资格
 */
export async function checkRefundEligibility(purchaseId: string): Promise<{
  eligible: boolean;
  reason?: string;
  error: string | null;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { eligible: false, error: 'Not authenticated' };
    }

    const { data: purchase, error } = await supabase
      .from('purchases')
      .select('*')
      .eq('id', purchaseId)
      .eq('user_id', user.id)
      .single();

    if (error || !purchase) {
      return { eligible: false, error: 'Purchase not found' };
    }

    // Check refund eligibility rules
    const purchaseDate = new Date(purchase.created_at);
    const now = new Date();
    const daysSincePurchase = (now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24);

    if (purchase.is_refunded) {
      return { eligible: false, reason: 'Already refunded', error: null };
    }

    if (daysSincePurchase > 14) {
      return { eligible: false, reason: 'Purchase older than 14 days', error: null };
    }

    const creditsUsed = purchase.credits_granted - purchase.credits_remaining;
    if (creditsUsed > 0) {
      return {
        eligible: false,
        reason: `Credits have been used (${creditsUsed}/${purchase.credits_granted})`,
        error: null,
      };
    }

    return { eligible: true, error: null };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { eligible: false, error: 'Failed to check eligibility' };
  }
}

/**
 * 申请退款
 * 调用 Edge Function create-refund
 */
export async function requestRefund(params: RefundParams): Promise<{
  success: boolean;
  refundId?: string;
  error: string | null;
}> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch(
      `${env.supabase.url}/functions/v1/create-refund`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          purchaseId: params.purchaseId,
          reason: params.reason,
          details: params.details,
          contactEmail: params.contactEmail,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.error || 'Failed to request refund' };
    }

    return {
      success: true,
      refundId: result.refundId,
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { success: false, error: 'Failed to request refund' };
  }
}

/**
 * 获取完整的订阅页面数据
 * 一次性获取所有需要的数据
 */
export async function fetchSubscriptionPageData(): Promise<{
  subscription: SubscriptionInfo | null;
  billingHistory: BillingHistoryItem[];
  usageStats: UsageStats | null;
  error: string | null;
}> {
  try {
    const [subscriptionResult, billingResult, usageResult] = await Promise.all([
      fetchActiveSubscription(),
      fetchBillingHistory(),
      fetchUsageStats(),
    ]);

    // If any critical error occurred
    if (subscriptionResult.error && billingResult.error && usageResult.error) {
      return {
        subscription: null,
        billingHistory: [],
        usageStats: null,
        error: 'Failed to load subscription data',
      };
    }

    return {
      subscription: subscriptionResult.data,
      billingHistory: billingResult.data,
      usageStats: usageResult.data,
      error: null,
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return {
      subscription: null,
      billingHistory: [],
      usageStats: null,
      error: 'Failed to load subscription data',
    };
  }
}