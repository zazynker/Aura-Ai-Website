/**
 * Dodo Payments Overlay Checkout Integration
 * 弹窗式支付，用户无需离开页面
 */

import { DodoPayments } from 'dodopayments-checkout';

// 记录 SDK 是否已初始化
let isInitialized = false;

export interface CheckoutCallbacks {
  onSuccess?: (paymentId: string) => void;
  onFailed?: (error: unknown) => void;
  onClosed?: () => void;
}

// 当前回调存储
let currentCallbacks: CheckoutCallbacks = {};

/**
 * 初始化 Dodo Checkout SDK
 */
export function initDodoCheckout(mode: 'test' | 'live' = 'live'): void {
  if (isInitialized) {
    console.log('[DodoCheckout] Already initialized');
    return;
  }

  try {
    DodoPayments.Initialize({
      mode,
      displayType: 'overlay',
      onEvent: handleCheckoutEvent,
    });
    
    isInitialized = true;
    console.log(`[DodoCheckout] Initialized in ${mode} mode`);
  } catch (error) {
    console.error('[DodoCheckout] Failed to initialize:', error);
    throw error;
  }
}

/**
 * 处理支付事件
 */
function handleCheckoutEvent(event: any): void {
  console.log('[DodoCheckout] Event received:', JSON.stringify(event, null, 2));

  // 尝试多种可能的事件结构
  const eventType = event.type || event.event || event.eventType || event.name;
  const eventData = event.data || event.payload || event;

  console.log('[DodoCheckout] Event type:', eventType);

  switch (eventType) {
    case 'payment.success':
    case 'payment_success':
    case 'success':
      console.log('[DodoCheckout] Payment successful!');
      if (currentCallbacks.onSuccess) {
        const paymentId = eventData?.payment_id || eventData?.paymentId || 'unknown';
        currentCallbacks.onSuccess(paymentId);
      }
      currentCallbacks = {};
      break;

    case 'payment.failed':
    case 'payment_failed':
    case 'failed':
    case 'error':
      console.log('[DodoCheckout] Payment failed');
      if (currentCallbacks.onFailed) {
        currentCallbacks.onFailed(eventData);
      }
      currentCallbacks = {};
      break;

    case 'checkout.closed':
    case 'closed':
    case 'close':
    case 'dismissed':
    case 'cancelled':
    case 'cancel':
      console.log('[DodoCheckout] Checkout closed');
      if (currentCallbacks.onClosed) {
        currentCallbacks.onClosed();
      }
      currentCallbacks = {};
      break;

    default:
      console.log('[DodoCheckout] Unhandled event type:', eventType);
      // 如果事件类型未知但弹窗可能已关闭，也重置状态
      break;
  }
}

/**
 * 打开弹窗支付
 */
export function openOverlayCheckout(
  checkoutUrl: string, 
  callbacks?: CheckoutCallbacks
): void {
  if (!isInitialized) {
    initDodoCheckout('live');
  }

  currentCallbacks = callbacks || {};

  try {
    DodoPayments.Checkout.open({ checkoutUrl });
    console.log('[DodoCheckout] Overlay opened');
  } catch (error) {
    console.error('[DodoCheckout] Failed to open:', error);
    throw error;
  }
}