import { initDodoCheckout } from '../utils/dodoOverlayCheckout';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Crown, Loader2, Gift } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { WelcomeGiftModal } from '../components/WelcomeGiftModal';
import { supabase } from '../utils/supabase';
import { DODO_PRODUCTS, openDodoOverlayCheckout, isDodoConfigured } from '../utils/dodoPayments';
import confetti from 'canvas-confetti';

export const Pricing = () => {
  const navigate = useNavigate();
  const { user, updateUser, addToast, saveBrowsingState } = useStore();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'yearly' | 'monthly'>('yearly');
  const [showGiftModal, setShowGiftModal] = useState(false);

  const fireConfetti = () => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

    const randomInRange = (min, max) => Math.random() * (max - min) + min;

    const interval = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      });
    }, 250);
  };

  // 预初始化 Dodo Checkout SDK
  React.useEffect(() => {
    initDodoCheckout('live');
  }, []);

  const getBaseUrl = () => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return 'https://lazoraai.com';
  };

  const handlePurchase = async (productId: string) => {
    if (!user) {
      saveBrowsingState({ intendedDestination: '/pricing' });
      navigate('/login');
      return;
    }

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
          country: 'US',
        },
        {
          onSuccess: async (paymentId) => {
            console.log('Payment successful:', paymentId);
            addToast('success', 'Payment successful! Your credits will be added shortly.');
            setIsProcessing(null);
            
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

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const paymentStatus = params.get('payment');

    if (paymentStatus === 'success') {
      addToast('success', 'Payment successful! Your credits will be added shortly.');
      window.history.replaceState({}, '', window.location.pathname + '#/pricing');
      
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

  const getProProductId = () => {
    return billingCycle === 'yearly' ? DODO_PRODUCTS.PRO_YEARLY : DODO_PRODUCTS.PRO_MONTHLY;
  };

  const isProProcessing = isProcessing === DODO_PRODUCTS.PRO_YEARLY || isProcessing === DODO_PRODUCTS.PRO_MONTHLY;

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
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">Pro <Crown className="w-5 h-5 text-yellow-500 dark:text-yellow-400" /></h3>
          
          {/* Billing Cycle Toggle */}
          <div className="flex bg-slate-200/50 dark:bg-slate-800/50 p-1 rounded-lg mb-6">
            <button 
              onClick={() => setBillingCycle('yearly')}
              className={`flex-1 relative py-2 px-3 rounded-md text-sm font-semibold transition-all ${
                billingCycle === 'yearly' 
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Yearly
              {billingCycle === 'yearly' && (
                <span className="absolute -top-2 -right-2 bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  -38%
                </span>
              )}
            </button>
            <button 
              onClick={() => setBillingCycle('monthly')}
              className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-all ${
                billingCycle === 'monthly' 
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Monthly
            </button>
          </div>

          {/* Price Display */}
          <div className="mb-6">
            {billingCycle === 'yearly' ? (
              <>
                <div className="flex items-end gap-2">
                  <p className="text-3xl font-bold text-slate-900 dark:text-white">$19.9</p>
                  <span className="text-sm text-slate-500 dark:text-slate-400 font-normal mb-1">/mo</span>
                  <span className="text-sm text-slate-400 line-through mb-1">$29</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Billed annually at $238.80 · Auto-renews yearly
                </p>
              </>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <p className="text-3xl font-bold text-slate-900 dark:text-white">$29</p>
                  <span className="text-sm text-slate-500 dark:text-slate-400 font-normal mb-1">/mo</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Billed monthly · Auto-renews each month
                </p>
              </>
            )}
          </div>

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
  onClick={() => {
    if (user?.plan === 'Pro') {
      navigate('/subscription');
    } else {
      handlePurchase(getProProductId());
    }
  }} 
  disabled={isProcessing !== null}
>
  {isProProcessing ? (
    <span className="flex items-center justify-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" />
      Processing...
    </span>
  ) : user?.plan === 'Pro' ? (
    'Manage Subscription'
  ) : (
    billingCycle === 'yearly' ? 'Subscribe Yearly' : 'Subscribe Monthly'
  )}
</Button>
          
          {/* Cancel anytime notice */}
          <p className="text-xs text-center text-slate-400 dark:text-slate-500 mt-3">
            Cancel anytime
          </p>
        </div>

        {/* Credit Packs */}
        <div className="glass-panel p-8 rounded-2xl border-slate-200 dark:border-white/5 flex flex-col relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Credit Packs</h3>
            
            {/* Wiggling Gift Box */}
            {user?.welcomeGiftEligible && !user?.welcomeGiftRedeemed && <button 
              onClick={() => {
                setShowGiftModal(true);
                fireConfetti();
              }}
              className="group relative -mt-2 -mr-2 p-3 text-purple-500 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300 transition-colors cursor-pointer"
              title="New User Gift"
            >
              <div className="absolute inset-0 bg-purple-100 dark:bg-purple-900/30 rounded-full scale-0 group-hover:scale-100 transition-transform duration-300 origin-center" />
              <Gift className="w-8 h-8 animate-wiggle relative z-10" />
              <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-800 z-20" />
            </button>}
          </div>
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

      <WelcomeGiftModal isOpen={showGiftModal} onClose={() => setShowGiftModal(false)} />
    </div>
  );
};
