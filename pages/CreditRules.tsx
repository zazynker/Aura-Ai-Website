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
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Billing Policy</h1>
          <p className="text-slate-500 dark:text-slate-400 text-lg">
            Simple, transparent billing for AI image generation.
          </p>
        </div>
        
        <div className="space-y-12 text-slate-700 dark:text-slate-300 leading-relaxed">
          
          {/* Section 1: How It Works */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">How Credits Work</h2>
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

          {/* Section 4: Refunds */}
          <section id="refunds">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Refunds</h2>
            <p className="mb-4">
              All payments and refunds are processed through our payment partner, Paddle. This policy does not affect your statutory consumer rights under applicable law.
            </p>
            
            <div className="space-y-6">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Pro Subscription</h3>
                <p className="mb-2">
                  You may request a refund within <strong>7 days</strong> of your initial subscription, provided you have not substantially used the service (e.g., you have consumed no or only a minimal amount of credits).
                </p>
                <p>
                  If the service has been used, we will evaluate your request based on actual usage and may offer a partial refund or alternative compensation.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Credit Packs</h3>
                <p className="mb-2">
                  Credit packs are delivered instantly as digital products and are generally non-refundable.
                </p>
                <p>
                  However, we may provide a refund or compensation for duplicate charges, payment errors, or other reasonable special circumstances. Please contact us with details of your situation.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Technical Issues</h3>
                <p>
                  If a generation task fails due to platform server errors or system outages and no result is returned, the corresponding credits will be automatically refunded to your account. Issues caused by upload image quality, network connectivity, or content moderation are not covered.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Cancellation</h3>
                <p>
                  You may cancel your subscription at any time. Cancellation will take effect at the end of your current billing cycle. Cancellation itself does not automatically result in a refund, but if you have special circumstances, please contact us and we will do our best to provide a fair solution.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">How to Request a Refund</h3>
                <p>
                  Please email <a href="mailto:support@lazora.ai" className="text-purple-600 dark:text-purple-400 hover:underline">support@lazora.ai</a> with your registered email address, date of purchase, and reason for refund. We will respond within 5 business days. Refunds will be returned to your original payment method, typically within 5-10 business days.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">EU Users</h3>
                <p>
                  Under the EU Consumer Rights Directive, the right of withdrawal for digital content ends once delivery has begun. By completing your purchase, you agree to the immediate provision of digital services and acknowledge that your right of withdrawal will be limited accordingly. This does not affect your right to request a refund under this policy or applicable law.
                </p>
              </div>
            </div>
          </section>

          {/* Section 5: FAQ */}
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