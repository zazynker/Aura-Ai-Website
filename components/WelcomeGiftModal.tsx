import React, { useEffect, useRef, useState } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useStore } from '../context/StoreContext';
import { fetchUserCredits } from '../utils/api';
import { DODO_PRODUCTS, openDodoOverlayCheckout } from '../utils/dodoPayments';
import { initDodoCheckout } from '../utils/dodoOverlayCheckout';

interface WelcomeGiftModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const OFFERS = [
  { productId: DODO_PRODUCTS.GIFT_120, credits: 120, price: '$1.99' },
  { productId: DODO_PRODUCTS.GIFT_250, credits: 250, price: '$2.99' },
  { productId: DODO_PRODUCTS.GIFT_600, credits: 600, price: '$5.99', best: true },
] as const;

export const WelcomeGiftModal: React.FC<WelcomeGiftModalProps> = ({ isOpen, onClose }) => {
  const { user, updateUser, addToast } = useStore();
  const [processing, setProcessing] = useState<string | null>(null);
  const [waitingForCredits, setWaitingForCredits] = useState(false);
  const pollRunRef = useRef(0);

  useEffect(() => {
    initDodoCheckout('live');
    return () => { pollRunRef.current += 1; };
  }, []);

  const syncUser = async () => {
    const { data } = await fetchUserCredits();
    if (!data) return null;
    updateUser({
      credits: data.credits,
      maxCredits: data.maxCredits,
      plan: data.plan === 'Pro' ? 'Pro' : 'Free',
      welcomeGiftEligible: data.welcomeGiftEligible,
      welcomeGiftRedeemed: data.welcomeGiftRedeemed,
      welcomeGiftExpiresAt: data.welcomeGiftExpiresAt,
      welcomeGiftReason: data.welcomeGiftReason,
    });
    return data;
  };

  const waitForWebhook = async () => {
    const run = ++pollRunRef.current;
    setWaitingForCredits(true);
    for (let attempt = 0; attempt < 15 && run === pollRunRef.current; attempt += 1) {
      const latest = await syncUser();
      if (latest?.welcomeGiftRedeemed) {
        setWaitingForCredits(false);
        setProcessing(null);
        addToast('success', `${latest.credits} credits available. Welcome gift activated!`);
        onClose();
        return;
      }
      await new Promise(resolve => window.setTimeout(resolve, 2000));
    }
    if (run === pollRunRef.current) {
      setWaitingForCredits(false);
      setProcessing(null);
      addToast('info', 'Payment received. Credits may take a moment to appear.');
    }
  };

  const purchase = async (productId: string) => {
    if (!user || processing || user.welcomeGiftRedeemed || !user.welcomeGiftEligible) return;
    setProcessing(productId);
    try {
      const origin = window.location.origin;
      await openDodoOverlayCheckout(
        {
          productId,
          customerEmail: user.email,
          customerId: user.id,
          successUrl: `${origin}/#/pricing?payment=success`,
          cancelUrl: `${origin}/#/pricing?payment=cancelled`,
          country: 'US',
        },
        {
          onSuccess: () => { void waitForWebhook(); },
          onFailed: () => {
            setProcessing(null);
            addToast('error', 'Payment failed. Please try again.');
          },
          onClosed: () => {
            if (!waitingForCredits) setProcessing(null);
          },
        },
      );
    } catch (error) {
      console.error('Welcome gift checkout failed:', error);
      setProcessing(null);
      addToast('error', error instanceof Error ? error.message : 'Unable to start payment.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={processing ? () => undefined : onClose} title="Welcome Gift">
      <div className="relative overflow-hidden p-1 sm:p-2">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300">
          {waitingForCredits ? <Loader2 className="h-8 w-8 animate-spin" /> : <Gift className="h-8 w-8" />}
        </div>
        <h3 className="text-center text-xl font-bold text-slate-900 dark:text-white">
          {waitingForCredits ? 'Confirming your payment…' : 'Exclusive New User Offer'}
        </h3>
        <p className="mx-auto mt-3 max-w-lg rounded-xl bg-indigo-50 px-4 py-3 text-center text-sm font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          Choose one offer. It is available once per account during your first 30 days.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {OFFERS.map(offer => {
            const active = processing === offer.productId;
            return (
              <button
                key={offer.productId}
                type="button"
                disabled={Boolean(processing) || waitingForCredits}
                onClick={() => void purchase(offer.productId)}
                className={`relative rounded-2xl border-2 bg-white p-4 text-center transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-900 ${
                  offer.best
                    ? 'border-pink-400 shadow-lg shadow-pink-500/15'
                    : 'border-slate-200 hover:border-purple-300 dark:border-slate-700 dark:hover:border-purple-500'
                }`}
              >
                {offer.best && (
                  <span className="absolute inset-x-0 top-0 rounded-t-xl bg-gradient-to-r from-purple-500 to-pink-500 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                    Best value
                  </span>
                )}
                <div className={offer.best ? 'pt-5' : ''}>
                  <div className="text-3xl font-black text-slate-900 dark:text-white">{offer.credits}</div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">Credits</div>
                  <div className="mt-5 flex h-11 items-center justify-center rounded-xl border border-slate-200 font-bold text-slate-900 dark:border-slate-700 dark:text-white">
                    {active ? <Loader2 className="h-5 w-5 animate-spin" /> : offer.price}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
