import React, { useEffect, useRef, useState } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useStore } from '../context/StoreContext';
import { fetchUserCredits } from '../utils/api';
import { DODO_PRODUCTS, openDodoOverlayCheckout } from '../utils/dodoPayments';
import { initDodoCheckout } from '../utils/dodoOverlayCheckout';
import confetti from 'canvas-confetti';

interface WelcomeGiftModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const OFFERS: ReadonlyArray<{
  productId: string;
  credits: number;
  price: string;
  best?: boolean;
}> = [
  { productId: DODO_PRODUCTS.GIFT_120, credits: 120, price: '$1.99' },
  { productId: DODO_PRODUCTS.GIFT_250, credits: 250, price: '$2.99' },
  { productId: DODO_PRODUCTS.GIFT_600, credits: 600, price: '$5.99', best: true },
];

export const WelcomeGiftModal: React.FC<WelcomeGiftModalProps> = ({ isOpen, onClose }) => {
  const { user, updateUser, addToast } = useStore();
  const [processing, setProcessing] = useState<string | null>(null);
  const [waitingForCredits, setWaitingForCredits] = useState(false);
  const pollRunRef = useRef(0);

  useEffect(() => {
    initDodoCheckout('live');
    return () => { pollRunRef.current += 1; };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10000 };
    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;
    const interval = window.setInterval(() => {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) {
        window.clearInterval(interval);
        return;
      }
      const particleCount = 50 * (timeLeft / duration);
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
      confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);
    return () => window.clearInterval(interval);
  }, [isOpen]);

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
      <div className="text-center py-2">
        <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 text-purple-500 rounded-full flex items-center justify-center mx-auto mb-4">
          {waitingForCredits ? <Loader2 className="h-8 w-8 animate-spin" /> : <Gift className="h-8 w-8" />}
        </div>
        <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
          {waitingForCredits ? 'Confirming your payment…' : 'Exclusive New User Offer'}
        </h4>
        <div className="bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 px-4 py-3 rounded-lg mb-6 text-sm font-semibold border border-indigo-100 dark:border-indigo-800/30">
          Get a head start! You can only choose ONE option, and it is only available ONCE per account.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-1">
          {OFFERS.map(offer => {
            const active = processing === offer.productId;
            return (
              <button
                key={offer.productId}
                type="button"
                disabled={Boolean(processing) || waitingForCredits}
                onClick={() => void purchase(offer.productId)}
                className={`relative rounded-xl border-2 p-3 text-center transition-all disabled:cursor-not-allowed disabled:opacity-60 flex flex-col items-center justify-between h-full group overflow-hidden ${
                  offer.best
                    ? 'border-pink-300 dark:border-pink-500/50 hover:border-pink-500 dark:hover:border-pink-400 bg-gradient-to-b from-pink-50 to-white dark:from-pink-900/20 dark:to-slate-800 shadow-lg shadow-pink-100 dark:shadow-pink-900/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-purple-400 dark:hover:border-purple-500 bg-white dark:bg-slate-800'
                }`}
              >
                {offer.best && (
                  <span className="absolute top-0 inset-x-0 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[9px] font-bold py-0.5 text-center uppercase tracking-wider">
                    Best value
                  </span>
                )}
                <div className={offer.best ? 'mb-3 mt-4' : 'mb-3 mt-2'}>
                  <p className="text-2xl font-black text-slate-900 dark:text-white my-1">{offer.credits}</p>
                  <p className="text-xs font-normal text-slate-500 uppercase tracking-wide">credits</p>
                </div>
                <div className={`w-full min-h-10 flex items-center justify-center rounded-xl font-bold group-hover:scale-105 transition-transform ${offer.best
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md'
                  : 'border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                }`}>
                    {active ? <Loader2 className="h-5 w-5 animate-spin" /> : offer.price}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
