import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const CreditRules = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen pt-24 px-4 pb-12 bg-slate-50 dark:bg-slate-900">
      <div className="max-w-3xl mx-auto">
        <Button 
          variant="ghost" 
          className="mb-8 pl-0 hover:bg-transparent hover:text-purple-600 dark:hover:text-purple-400"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="mb-12">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">How Credits Work</h1>
          <p className="text-slate-500 dark:text-slate-400 text-lg">
            Simple, transparent billing for AI image generation.
          </p>
        </div>
        
        <div className="space-y-12 text-slate-700 dark:text-slate-300 leading-relaxed">
          
          {/* Section 1: How It Works */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">How Billing Works</h2>
            <p className="mb-4">
              Lazora charges credits based on the images you generate. Higher resolution and more complex outputs consume more credits. You'll see the exact cost after each generation.
            </p>
            <p>
              <strong>Input images are always free</strong> — you're only charged for what we create, not what you upload.
            </p>
          </section>

          {/* Section 2: Subscription Plans */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Plans</h2>
            
            <div className="space-y-6">
              <div className="glass-panel p-6 rounded-xl border border-slate-200 dark:border-white/10">
                <h3 className="font-bold text-slate-900 dark:text-white mb-3">Free</h3>
                <p className="mb-2"><strong>120 credits</strong> welcome bonus to try Lazora.</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Up to 1K resolution. Basic templates. Credits don't expire.</p>
              </div>

              <div className="glass-panel p-6 rounded-xl border border-purple-200 dark:border-purple-500/30 bg-purple-50/50 dark:bg-purple-500/5">
                <h3 className="font-bold text-slate-900 dark:text-white mb-3">Pro — $29/month</h3>
                <p className="mb-2"><strong>3,000 credits</strong> per month for professional use.</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Up to 4K resolution. All templates. Unused credits roll over. Commercial license included.</p>
              </div>
            </div>
          </section>

          {/* Section 3: Credit Packs */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Credit Packs</h2>
            <p className="mb-4">Need more credits? Purchase additional packs anytime. They never expire.</p>
            <div className="glass-panel p-6 rounded-xl border border-slate-200 dark:border-white/10">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span>500 Credits</span>
                  <span className="font-bold text-slate-900 dark:text-white">$7</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>1,000 Credits</span>
                  <span className="font-bold text-slate-900 dark:text-white">$12</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>2,000 Credits</span>
                  <span className="font-bold text-slate-900 dark:text-white">$22</span>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: FAQ */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">FAQ</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">What if I run out of credits?</h3>
                <p>You'll be prompted to upgrade to Pro or purchase a credit pack before generating more images.</p>
              </div>
              
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Do credits expire?</h3>
                <p>No. Free credits, purchased credits, and rolled-over Pro credits never expire.</p>
              </div>
              
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">What happens if I cancel Pro?</h3>
                <p>Your remaining credits stay in your account. You can still use them, but you'll lose access to 4K resolution and premium templates.</p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Can I get a refund?</h3>
                <p>Purchased credit packs are non-refundable. For subscription questions, contact support.</p>
              </div>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-slate-200 dark:border-white/10 text-sm text-slate-500 dark:text-slate-400">
          <p>Questions? Contact us at <a href="mailto:support@lazora.ai" className="text-purple-600 dark:text-purple-400 hover:underline">support@lazora.ai</a></p>
        </div>

      </div>
    </div>
  );
};