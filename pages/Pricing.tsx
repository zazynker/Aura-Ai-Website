import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Check, Crown, Zap, Loader2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../utils/supabase';
import { DODO_PRODUCTS, PRODUCT_DETAILS, openDodoOverlayCheckout, isDodoConfigured } from '../utils/dodoPayments';

export const Pricing = () => {
  const navigate = useNavigate();
  const { user, updateUser, addToast, browsing, saveBrowsingState } = useStore();
  const [isProcessing, setIsProcessing] = useState<string | null>(null); // Track which product is processing

  // Get the success/cancel URL base
  const getBaseUrl = () => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return 'https://lazoraai.com';
  };

  // Handle purchase for any product
  const handlePurchase = async (productId: string) => {
    // Check if user is logged in
    if (!user) {
      saveBrowsingState({ intendedDestination: '/pricing' });
      navigate('/login');
      return;
    }

    // Check if Dodo is configured
    if (!isDodoConfigured()) {
      addToast('error', 'Payment system is not configured. Please try again later.');
      return;
    }

    setIsProcessing(productId);

    try {
      const baseUrl = getBaseUrl();
      
      await openDodoOverlayCheckout(
        {
          productId,
          customerEmail: user.email,
          customerId: user.id,
          successUrl: `${baseUrl}/#/pricing?payment=success&product=${productId}`,
          cancelUrl: `${baseUrl}/#/pricing?payment=cancelled`,
          metadata: {
            user_id: user.id,
            user_email: user.email,
          },
        },
        {
          onSuccess: async (paymentId) => {
            console.log('Payment successful:', paymentId);
            addToast('success', 'Payment successful! Your credits will be added shortly.');
            setIsProcessing(null);
            
            // Refresh user credits after delay (webhook needs time to process)
            setTimeout(async () => {
              if (user?.id) {
                const { data } = await supabase
                  .from('users')
                  .select('credits, plan')
                  .eq('id', user.id)
                  .single();
                
                if (data) {
                  updateUser({ credits: data.credits, plan: data.plan });
                }
              }
            }, 3000);
          },
          onFailed: (error) => {
            console.error('Payment failed:', error);
            addToast('error', 'Payment failed. Please try again.');
            setIsProcessing(null);
          },
          onClosed: () => {
            console.log('Checkout closed');
            setIsProcessing(null);
          },
        }
      );
    } catch (error) {
      console.error('Payment error:', error);
      addToast('error', 'Failed to start payment. Please try again.');
      setIsProcessing(null);
    }
  };

  // Check URL params for payment result (on page load)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const paymentStatus = params.get('payment');
    const productId = params.get('product');

    if (paymentStatus === 'success') {
      addToast('success', 'Payment successful! Your credits will be added shortly.');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname + '#/pricing');
      
      // Optionally refresh user data after a short delay
      setTimeout(async () => {
        if (user?.id) {
          const { data } = await supabase
            .from('users')
            .select('credits, plan')
            .eq('id', user.id)
            .single();
          
          if (data) {
            updateUser({ credits: data.credits, plan: data.plan });
          }
        }
      }, 2000);
    } else if (paymentStatus === 'cancelled') {
      addToast('info', 'Payment was cancelled.');
      window.history.replaceState({}, '', window.location.pathname + '#/pricing');
    }
  }, []);

  return (
    <div className="min-h-screen pt-24 px-4 pb-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4 text-slate-900 dark:text-white">Choose Your <span className="text-gradient">Power</span></h1>
        <p className="text-slate-500 dark:text-slate-400">
          Unlock professional AI photography tools.
        </p>
      </div>

      <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-8 items-start">
        {/* Free */}
        <div className="glass-panel p-8 rounded-2xl border-slate-200 dark:border-white/5 flex flex-col">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Free</h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-white mb-6">$0</p>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
              <Check className="w-4 h-4 text-green-500 dark:text-green-400 shrink-0 mt-0.5" /> 
              <span><strong className="text-slate-900 dark:text-white">120 Credits</strong> (one-time welcome bonus)</span>
            </li>
            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm"><Check className="w-4 h-4 text-green-500 dark:text-green-400 shrink-0" /> Up to 1K resolution</li>
            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm"><Check className="w-4 h-4 text-green-500 dark:text-green-400 shrink-0" /> Basic templates</li>
            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
              <Check className="w-4 h-4 text-green-500 dark:text-green-400 shrink-0 mt-0.5" /> 
              <span>Remaining credits kept upon Pro upgrade</span>
            </li>
          </ul>
          <Button variant="secondary" className="w-full mt-auto" disabled={user?.plan === 'Free'}>
            {user?.plan === 'Free' ? 'Current Plan' : 'Downgrade'}
          </Button>
        </div>

        {/* Pro */}
        <div className="glass-panel p-8 rounded-2xl border-purple-200 dark:border-purple-500/50 relative transform md:-translate-y-4 shadow-2xl shadow-purple-200/50 dark:shadow-purple-900/20 bg-purple-50/50 dark:bg-transparent flex flex-col">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wider shadow-lg">
            Most Popular
          </div>
          {user?.plan === 'Pro' && (
             <div className="absolute top-4 right-4 text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-500/10 px-2 py-1 rounded">Current Plan</div>
          )}
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">Pro <Crown className="w-5 h-5 text-yellow-500 dark:text-yellow-400" /></h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-white mb-6">$29<span className="text-sm text-slate-500 dark:text-slate-400 font-normal">/mo</span></p>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm">
              <Check className="w-4 h-4 text-purple-500 dark:text-purple-400 shrink-0 mt-0.5" /> 
              <span><strong className="text-slate-900 dark:text-white">3,000 Credits / month</strong> (rollover enabled)</span>
            </li>
            <li className="flex items-center gap-3 text-slate-700 dark:text-slate-200 text-sm"><Check className="w-4 h-4 text-purple-500 dark:text-purple-400 shrink-0" /> Up to 4K Ultra HD resolution</li>
            <li className="flex items-center gap-3 text-slate-700 dark:text-slate-200 text-sm"><Check className="w-4 h-4 text-purple-500 dark:text-purple-400 shrink-0" /> All premium templates</li>
            <li className="flex items-center gap-3 text-slate-700 dark:text-slate-200 text-sm"><Check className="w-4 h-4 text-purple-500 dark:text-purple-400 shrink-0" /> Priority generation</li>
            <li className="flex items-center gap-3 text-slate-700 dark:text-slate-200 text-sm"><Check className="w-4 h-4 text-purple-500 dark:text-purple-400 shrink-0" /> Commercial license</li>
          </ul>
          <Button 
            variant="gradient" 
            className="w-full mt-auto" 
            onClick={() => handlePurchase(DODO_PRODUCTS.PRO_MONTHLY)} 
            disabled={user?.plan === 'Pro' || isProcessing !== null}
          >
            {isProcessing === DODO_PRODUCTS.PRO_MONTHLY ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </span>
            ) : user?.plan === 'Pro' ? (
              'Manage Subscription'
            ) : (
              'Upgrade to Pro'
            )}
          </Button>
        </div>

        {/* Credit Packs */}
        <div className="glass-panel p-8 rounded-2xl border-slate-200 dark:border-white/5 flex flex-col">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Credit Packs</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">One-time purchase, never expires.</p>
          
          <div className="space-y-3 mb-8 flex-1">
            {/* 500 Credits */}
            <div 
              className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-purple-300 dark:hover:border-purple-500/30 transition-colors cursor-pointer"
              onClick={() => !isProcessing && handlePurchase(DODO_PRODUCTS.CREDITS_500)}
            >
              <p className="font-bold text-slate-900 dark:text-white">500 Credits</p>
              <Button 
                variant="secondary" 
                size="sm" 
                className="font-bold"
                disabled={isProcessing !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePurchase(DODO_PRODUCTS.CREDITS_500);
                }}
              >
                {isProcessing === DODO_PRODUCTS.CREDITS_500 ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  '$7'
                )}
              </Button>
            </div>

            {/* 1000 Credits */}
            <div 
              className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-purple-300 dark:hover:border-purple-500/30 transition-colors cursor-pointer"
              onClick={() => !isProcessing && handlePurchase(DODO_PRODUCTS.CREDITS_1000)}
            >
              <p className="font-bold text-slate-900 dark:text-white">1,000 Credits</p>
              <Button 
                variant="secondary" 
                size="sm" 
                className="font-bold"
                disabled={isProcessing !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePurchase(DODO_PRODUCTS.CREDITS_1000);
                }}
              >
                {isProcessing === DODO_PRODUCTS.CREDITS_1000 ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  '$12'
                )}
              </Button>
            </div>

            {/* 2000 Credits */}
            <div 
              className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-purple-300 dark:hover:border-purple-500/30 transition-colors cursor-pointer"
              onClick={() => !isProcessing && handlePurchase(DODO_PRODUCTS.CREDITS_2000)}
            >
              <p className="font-bold text-slate-900 dark:text-white">2,000 Credits</p>
              <Button 
                variant="secondary" 
                size="sm" 
                className="font-bold"
                disabled={isProcessing !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePurchase(DODO_PRODUCTS.CREDITS_2000);
                }}
              >
                {isProcessing === DODO_PRODUCTS.CREDITS_2000 ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  '$22'
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};