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
  console.log('[DodoCheckout] Event received:', event);

  switch (event.type) {
    case 'payment.success':
      console.log('[DodoCheckout] Payment successful!');
      if (currentCallbacks.onSuccess && event.data?.payment_id) {
        currentCallbacks.onSuccess(event.data.payment_id as string);
      }
      break;

    case 'payment.failed':
      console.log('[DodoCheckout] Payment failed');
      if (currentCallbacks.onFailed) {
        currentCallbacks.onFailed(event.data);
      }
      break;

    case 'checkout.closed':
      console.log('[DodoCheckout] Checkout closed');
      if (currentCallbacks.onClosed) {
        currentCallbacks.onClosed();
      }
      currentCallbacks = {};
      break;

    default:
      console.log('[DodoCheckout] Event:', event.type);
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