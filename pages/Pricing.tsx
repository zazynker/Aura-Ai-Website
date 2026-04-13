import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Check, Crown, Zap, HelpCircle } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../utils/supabase';

export const Pricing = () => {
  const navigate = useNavigate();
  const { user, updateUser, addToast, browsing, saveBrowsingState } = useStore();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubscribe = () => {
    if (!user) {
      saveBrowsingState({ intendedDestination: '/pricing' });
      navigate('/login');
      return;
    }
    // 非白名单用户显示 Coming Soon
    if (!user.isWhitelisted) {
      addToast('info', 'Payment system coming soon! Stay tuned.');
      return;
    }
    setShowConfirm(true);
  };

  const confirmUpgrade = async () => {
    setIsProcessing(true);
    
    // Simulate payment processing (will be replaced with Paddle)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Merge existing credits with Pro credits
    const currentCredits = user?.credits || 0;
    const newCredits = currentCredits + 3000;
    
    updateUser({ plan: 'Pro', credits: newCredits, maxCredits: newCredits });
    setIsProcessing(false);
    setShowConfirm(false);
    addToast('success', 'Upgraded to Pro! Your credits have been added.');
    
    // Redirect back - fetch template from Supabase if needed
    if (browsing.lastViewedTemplate) {
      const { data: template } = await supabase
        .from('templates')
        .select('*')
        .eq('id', browsing.lastViewedTemplate)
        .single();
      
      if (template) {
        navigate('/modify', {
          state: {
            initialImage: template.image_url,
            initialImageSource: { templateId: template.id, templateName: template.display_name || template.name }
          }
        });
      } else {
        navigate('/');
      }
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen pt-24 px-4 pb-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4 text-slate-900 dark:text-white">Choose Your <span className="text-gradient">Power</span></h1>
        <p className="text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
          Unlock professional AI photography tools.
          <Link to="/credit-rules" title="View billing rules">
            <HelpCircle className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer transition-colors" />
          </Link>
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
          <Button variant="gradient" className="w-full mt-auto" onClick={handleSubscribe} disabled={user?.plan === 'Pro'}>
            {user?.plan === 'Pro' ? 'Manage Subscription' : 'Upgrade to Pro'}
          </Button>
        </div>

        {/* Credit Packs */}
        <div className="glass-panel p-8 rounded-2xl border-slate-200 dark:border-white/5 flex flex-col">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Credit Packs</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">One-time purchase, never expires.</p>
          
          <div className="space-y-3 mb-8 flex-1">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-purple-300 dark:hover:border-purple-500/30 transition-colors cursor-pointer">
              <p className="font-bold text-slate-900 dark:text-white">500 Credits</p>
              <Button variant="secondary" size="sm" className="font-bold">$7</Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-purple-300 dark:hover:border-purple-500/30 transition-colors cursor-pointer">
              <p className="font-bold text-slate-900 dark:text-white">1,000 Credits</p>
              <Button variant="secondary" size="sm" className="font-bold">$12</Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-purple-300 dark:hover:border-purple-500/30 transition-colors cursor-pointer">
              <p className="font-bold text-slate-900 dark:text-white">2,000 Credits</p>
              <Button variant="secondary" size="sm" className="font-bold">$22</Button>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)} title="Confirm Upgrade">
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            You are about to upgrade to the <span className="text-slate-900 dark:text-white font-bold">Pro Plan</span>. 
            This will charge <span className="text-slate-900 dark:text-white font-bold">$29.00</span> to your default payment method.
          </p>
          <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-xl border border-slate-200 dark:border-white/10">
             <div className="flex items-center gap-3">
               <div className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 flex items-center justify-center">
                 <Zap className="w-5 h-5 text-purple-500 dark:text-purple-400" />
               </div>
               <div>
                 <p className="text-sm font-semibold text-slate-900 dark:text-white">3,000 Credits</p>
                 <p className="text-xs text-slate-500 dark:text-slate-400">Added to your balance</p>
               </div>
             </div>
             <span className="text-green-500 dark:text-green-400 text-sm font-medium">+3,000</span>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button variant="gradient" className="flex-1" onClick={confirmUpgrade} isLoading={isProcessing}>Confirm Payment</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};