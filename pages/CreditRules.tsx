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
          Back to Pricing
        </Button>

        <div className="mb-12">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Credit & Billing Rules</h1>
          <p className="text-slate-500 dark:text-slate-400 text-lg">
            Detailed information about how credits are calculated and consumed.
          </p>
        </div>
        
        <div className="space-y-12 text-slate-700 dark:text-slate-300 leading-relaxed">
          
          {/* Section 1: Overview */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">1. Overview</h2>
            <p>
              Lazora uses a credit-based billing system for AI image generation. Credits are calculated based on <strong>actual token consumption</strong> from the AI model — this ensures fair and transparent pricing that directly reflects the computational resources used.
            </p>
          </section>

          {/* Section 2: Credit Consumption Table */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">2. Credit Calculation</h2>
            <p className="mb-4">
              Credits are calculated from the actual tokens consumed by the AI model using this formula:
            </p>
            <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-white/10 my-6 text-center">
              <code className="text-lg font-mono text-purple-600 dark:text-purple-400">
                Credits = ⌈ Tokens Used ÷ 50 ⌉
              </code>
            </div>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              The table below shows <strong>estimated</strong> credits per image. Actual consumption may vary slightly based on image complexity and content.
            </p>
            <div className="glass-panel overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 my-6">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                  <tr>
                    <th className="p-4 font-semibold text-slate-900 dark:text-white">Resolution</th>
                    <th className="p-4 font-semibold text-slate-900 dark:text-white">Est. Tokens</th>
                    <th className="p-4 font-semibold text-slate-900 dark:text-white text-right">Est. Credits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                  <tr className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="p-4">512px</td>
                    <td className="p-4 text-slate-500">~747</td>
                    <td className="p-4 text-right font-bold text-slate-900 dark:text-white">~15</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="p-4">1K (1024px)</td>
                    <td className="p-4 text-slate-500">~1,120</td>
                    <td className="p-4 text-right font-bold text-slate-900 dark:text-white">~22</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="p-4">2K (2048px)</td>
                    <td className="p-4 text-slate-500">~1,680</td>
                    <td className="p-4 text-right font-bold text-slate-900 dark:text-white">~34</td>
                  </tr>
                  <tr className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="p-4">4K (4096px)</td>
                    <td className="p-4 text-slate-500">~2,520</td>
                    <td className="p-4 text-right font-bold text-slate-900 dark:text-white">~50</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              After each generation, you'll see the exact credits deducted and tokens consumed in the notification.
            </p>
          </section>

          {/* Section 3: Subscription Plans */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">3. Subscription Plans</h2>
            
            <div className="mb-6">
              <h3 className="font-bold text-slate-900 dark:text-white mb-2">Free Plan</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>120 credits</strong> one-time welcome bonus upon registration</li>
                <li>Credits do not replenish — once used, they're gone</li>
                <li>Remaining credits are preserved when upgrading to Pro</li>
                <li>Maximum resolution: 1K (1024px)</li>
                <li>Access to basic templates only</li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-slate-900 dark:text-white mb-2">Pro Plan — $29/month</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>2,900 credits</strong> per month</li>
                <li>Unused credits roll over indefinitely</li>
                <li>Maximum resolution: 4K (4096px)</li>
                <li>Access to all premium templates</li>
                <li>Priority generation queue</li>
                <li>Commercial usage license included</li>
              </ul>
            </div>
          </section>

          {/* Section 4: Credit Packs */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">4. Credit Packs (One-time Purchase)</h2>
            <p className="mb-4">Need more credits? Purchase additional packs anytime:</p>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li><strong>500 credits</strong> — $7 ($0.014/credit)</li>
              <li><strong>1,000 credits</strong> — $12 ($0.012/credit)</li>
              <li><strong>2,000 credits</strong> — $22 ($0.011/credit)</li>
            </ul>
            <p>
              Purchased credits <strong>never expire</strong> and can be used alongside your subscription or free credits.
            </p>
          </section>

          {/* Section 5: Examples */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">5. Usage Examples</h2>
            <div className="glass-panel p-6 rounded-xl border border-slate-200 dark:border-white/10 space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-white/10">
                <span>Replace Product: 4 images at 1K</span>
                <span className="font-bold text-slate-900 dark:text-white">4 × 22 = 88 credits</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-white/10">
                <span>Upscale to 4K: 1 image</span>
                <span className="font-bold text-slate-900 dark:text-white">1 × 50 = 50 credits</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-white/10">
                <span>Text to Image: 2 images at 2K</span>
                <span className="font-bold text-slate-900 dark:text-white">2 × 34 = 68 credits</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Quick preview: 1 image at 512px</span>
                <span className="font-bold text-slate-900 dark:text-white">1 × 15 = 15 credits</span>
              </div>
            </div>
          </section>

          {/* Section 6: FAQ */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">6. FAQ</h2>
            
            <div className="space-y-6">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Q: What happens if I don't have enough credits?</h3>
                <p>A: You'll see a prompt to upgrade to Pro or purchase a credit pack before generating.</p>
              </div>
              
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Q: Do my credits expire?</h3>
                <p>A: Free welcome credits and purchased credits never expire. Pro subscription credits roll over each month indefinitely while your subscription is active.</p>
              </div>
              
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Q: What happens to my credits if I cancel Pro?</h3>
                <p>A: Your remaining credits stay in your account. You can still use them, but you'll lose access to Pro features like 4K resolution and premium templates.</p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2">Q: Can I get a refund for unused credits?</h3>
                <p>A: Purchased credit packs are non-refundable. For subscription cancellations, please refer to our Terms of Service.</p>
              </div>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-slate-200 dark:border-white/10 text-sm text-slate-500 dark:text-slate-400">
          <p className="mb-2">Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <p>Questions? Contact us at <a href="mailto:support@lazora.ai" className="text-purple-600 dark:text-purple-400 hover:underline">support@lazora.ai</a></p>
        </div>

      </div>
    </div>
  );
};