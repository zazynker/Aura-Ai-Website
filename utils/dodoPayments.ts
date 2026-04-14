/**
 * Dodo Payments Integration
 * Handles checkout creation via Supabase Edge Function
 */

// Supabase Edge Function URL
const SUPABASE_FUNCTION_URL = 'https://qdbixebjariupvcvsqff.supabase.co/functions/v1/create-checkout';

// Product IDs from Dodo Live Mode
export const DODO_PRODUCTS = {
  PRO_MONTHLY: 'pdt_0NcgjVAuBCls2boj8YVVr',
  CREDITS_500: 'pdt_0NcgjXHAv4YGQGRus5jTK',
  CREDITS_1000: 'pdt_0NcgjZRQg8BmUo91hSPAw',
  CREDITS_2000: 'pdt_0Ncgjbbx6J3ziExgmpLvs',
} as const;

// Product details for display
export const PRODUCT_DETAILS = {
  [DODO_PRODUCTS.PRO_MONTHLY]: { name: 'Pro Monthly', credits: 3000, price: 29 },
  [DODO_PRODUCTS.CREDITS_500]: { name: '500 Credits', credits: 500, price: 7 },
  [DODO_PRODUCTS.CREDITS_1000]: { name: '1,000 Credits', credits: 1000, price: 12 },
  [DODO_PRODUCTS.CREDITS_2000]: { name: '2,000 Credits', credits: 2000, price: 22 },
} as const;

interface CreateCheckoutParams {
  productId: string;
  customerEmail: string;
  customerId?: string;
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

interface CheckoutResponse {
  checkout_url: string;
  payment_id: string;
}

/**
 * Create a checkout session via Supabase Edge Function
 */
export async function createCheckout(params: CreateCheckoutParams): Promise<CheckoutResponse> {
  const { productId, customerEmail, customerId, successUrl, cancelUrl, metadata } = params;

  const response = await fetch(SUPABASE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      productId,
      customerEmail,
      customerId,
      successUrl,
      cancelUrl: cancelUrl || successUrl,
      metadata: metadata || {},
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('Checkout error:', error);
    throw new Error(error.error || 'Failed to create checkout');
  }

  return response.json();
}

/**
 * Redirect to Dodo checkout page
 */
export async function redirectToCheckout(params: CreateCheckoutParams): Promise<void> {
  try {
    const checkout = await createCheckout(params);
    console.log('Checkout created:', checkout);
    window.location.href = checkout.checkout_url;
  } catch (error) {
    console.error('Failed to redirect to checkout:', error);
    throw error;
  }
}

/**
 * Check if payment system is configured (always true now since we use Supabase)
 */
export function isDodoConfigured(): boolean {
  return true;
}
