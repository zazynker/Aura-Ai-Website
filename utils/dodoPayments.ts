/**
 * Dodo Payments Integration
 * Handles checkout creation and payment processing
 */

// Dodo API configuration
const DODO_API_URL = 'https://api.dodopayments.com/v1';
const DODO_API_KEY = import.meta.env.VITE_DODO_API_KEY || '';
console.log('DODO_API_KEY loaded:', DODO_API_KEY ? 'YES' : 'NO'); 
// Product IDs from Dodo Live Mode
export const DODO_PRODUCTS = {
  PRO_MONTHLY: 'pdt_0NcgjVAuBCIs2boj8YVVr',
  CREDITS_500: 'pdt_0NcgjXHAv4YGQGRus5jTK',
  CREDITS_1000: 'pdt_0NcgjZRQg8BmUo91hSPAw',
  CREDITS_2000: 'pdt_0NcgjbbX6J3ziExgmpLvs',
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
  checkout_id: string;
}

/**
 * Create a Dodo checkout session
 */
export async function createCheckout(params: CreateCheckoutParams): Promise<CheckoutResponse> {
  const { productId, customerEmail, customerId, successUrl, cancelUrl, metadata } = params;

  const response = await fetch(`${DODO_API_URL}/checkouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DODO_API_KEY}`,
    },
    body: JSON.stringify({
      product_id: productId,
      customer: {
        email: customerEmail,
        ...(customerId && { customer_id: customerId }),
      },
      success_url: successUrl,
      cancel_url: cancelUrl || successUrl,
      metadata: metadata || {},
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('Dodo checkout error:', error);
    throw new Error(error.message || 'Failed to create checkout');
  }

  return response.json();
}

/**
 * Redirect to Dodo checkout page
 */
export async function redirectToCheckout(params: CreateCheckoutParams): Promise<void> {
  try {
    const checkout = await createCheckout(params);
    window.location.href = checkout.checkout_url;
  } catch (error) {
    console.error('Failed to redirect to checkout:', error);
    throw error;
  }
}

/**
 * Check if Dodo is configured
 */
export function isDodoConfigured(): boolean {
  return !!DODO_API_KEY;
}
