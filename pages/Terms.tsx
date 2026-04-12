import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const Terms = () => {
  return (
    <div className="min-h-screen pt-20 pb-16 px-4 md:px-8 bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="max-w-3xl mx-auto">

        {/* Back Button */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        {/* Header */}
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-slate-400 dark:text-slate-500 mb-10">
          Last updated: February 13, 2025
        </p>

        {/* Content */}
        <div className="prose-container space-y-8 text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed">

          {/* 1. Acceptance of Terms */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Lazora (<a href="https://www.lazoraai.com" className="text-purple-600 dark:text-purple-400 hover:underline">www.lazoraai.com</a>), you agree to be bound by these Terms of Service. If you do not agree to these terms, you must not use our service.
            </p>
            <p className="mt-3">
              These terms constitute a legal agreement between you and Lazora.
            </p>
          </section>

          {/* 2. Service Description */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">2. Service Description</h2>
            <p>
              Lazora is an AI-powered product photography service that allows users to generate, edit, and enhance product images using artificial intelligence. Our services include:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
              <li>AI-powered product image generation from templates</li>
              <li>Image editing and modification with text prompts</li>
              <li>Image history management and downloads</li>
              <li>Various subscription plans with different feature levels and credit allowances</li>
            </ul>
            <p className="mt-3">
              We reserve the right to modify, suspend, or discontinue any part of the service at any time with reasonable notice.
            </p>
          </section>

          {/* 3. Eligibility */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">3. Eligibility</h2>
            <p>
              You must be at least <strong className="text-slate-800 dark:text-slate-200">18 years of age</strong> to use Lazora. By creating an account, you represent and warrant that you are at least 18 years old and have the legal capacity to enter into these terms. Lazora is designed for business professionals such as brand owners, marketers, and e-commerce operators.
            </p>
          </section>

          {/* 4. Account Responsibilities */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">4. Account Responsibilities</h2>
            <p>When you create an account on Lazora, you agree to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
              <li>Provide accurate and complete registration information</li>
              <li>Maintain the security and confidentiality of your login credentials</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
              <li>Accept responsibility for all activities that occur under your account</li>
            </ul>
            <p className="mt-3">
              We reserve the right to suspend or terminate accounts that violate these terms or that we reasonably believe have been compromised.
            </p>
          </section>

          {/* 5. Prohibited Content — CRITICAL for Paddle */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">5. Prohibited Content &amp; Usage</h2>
            <p>
              You agree <strong className="text-slate-800 dark:text-slate-200">not</strong> to use Lazora to generate, upload, or distribute any content that:
            </p>

            <div className="mt-3 p-4 bg-red-50 dark:bg-red-500/5 rounded-xl border border-red-200 dark:border-red-500/10">
              <p className="font-medium text-red-800 dark:text-red-300 mb-2">Strictly prohibited content includes but is not limited to:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-red-700 dark:text-red-300/90">
                <li>Pornographic, sexually explicit, or obscene material</li>
                <li>Content depicting or promoting violence, gore, or physical harm</li>
                <li>Content that exploits, harms, or endangers minors in any way</li>
                <li>Hate speech, content promoting discrimination or harassment based on race, ethnicity, gender, religion, sexual orientation, disability, or any other protected characteristic</li>
                <li>Content that infringes on intellectual property rights (trademarks, copyrights, patents) of others</li>
                <li>Fraudulent, deceptive, or misleading content, including counterfeit products</li>
                <li>Content promoting illegal activities, drugs, or controlled substances</li>
                <li>Content impersonating other individuals, brands, or organizations</li>
                <li>Malware, phishing, or any other malicious content</li>
                <li>Deepfakes or manipulated media intended to deceive</li>
                <li>Content that violates any applicable law or regulation</li>
              </ul>
            </div>

            <p className="mt-4">
              We reserve the right to review generated content and to remove any content that violates these terms without prior notice. Repeated or severe violations will result in immediate account termination without refund.
            </p>
          </section>

          {/* 6. Intellectual Property */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">6. Intellectual Property</h2>

            <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mt-4 mb-2">6.1 Your Content</h3>
            <p>
              You retain ownership of the original images you upload to Lazora. By uploading content, you grant us a limited, non-exclusive license to process your images solely for the purpose of providing our service to you.
            </p>

            <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mt-4 mb-2">6.2 Generated Content</h3>
            <p>
              Subject to your compliance with these terms, you are granted a license to use AI-generated images produced through Lazora for commercial and personal purposes. However, you are solely responsible for ensuring that your use of generated content does not infringe any third-party rights, including but not limited to copyrights, trademarks, and personality/publicity rights.
            </p>
            <p className="mt-2">
              <strong className="text-slate-800 dark:text-slate-200">We do not guarantee that generated content is free from third-party rights claims.</strong> If your uploaded content contains third-party intellectual property, modifying it through our service does not grant you rights to that intellectual property.
            </p>

            <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mt-4 mb-2">6.3 Lazora's Property</h3>
            <p>
              The Lazora platform, including its design, code, templates, branding, logos, and underlying AI technology, remains the exclusive property of Lazora. You may not copy, modify, reverse-engineer, or create derivative works of our platform.
            </p>
          </section>

          {/* 7. Payments & Subscriptions */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">7. Payments &amp; Subscriptions</h2>
            <p>
              All payments for Lazora are processed by <strong className="text-slate-800 dark:text-slate-200">Paddle.com Market Limited</strong>, which serves as our Merchant of Record. Paddle handles all billing, invoicing, currency conversion, and applicable taxes on our behalf.
            </p>

            <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mt-4 mb-2">7.1 Subscription Plans</h3>
            <p>
              Lazora offers various subscription plans with different credit allowances and feature levels. Plan details and pricing are displayed on our <Link to="/pricing" className="text-purple-600 dark:text-purple-400 hover:underline">Pricing page</Link>. We reserve the right to update pricing with reasonable advance notice.
            </p>

            <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mt-4 mb-2">7.2 Credits</h3>
            <p>
              Image generation consumes credits according to your subscription plan. Unused credits do not roll over to the next billing cycle unless explicitly stated in your plan. Credits have no cash value and are non-transferable.
            </p>

            <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mt-4 mb-2">7.3 Automatic Renewal</h3>
            <p>
              <strong className="text-slate-800 dark:text-slate-200">Subscription plans</strong> (such as the Pro Plan) renew automatically at the end of each billing cycle unless cancelled. You can cancel your subscription at any time through your account dashboard or by contacting support. Cancellation takes effect at the end of the current billing period, and you will retain access until then.
            </p>
            <p className="mt-2">
              <strong className="text-slate-800 dark:text-slate-200">Credit Packs</strong> are one-time purchases and do not renew automatically.
            </p>
          </section>

          {/* 8. Refund Policy */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">8. Refund Policy</h2>
            <p className="mb-4">
              All payments and refunds are processed through our payment partner, Paddle. This policy does not affect your statutory consumer rights under applicable law.
            </p>
            <div className="p-4 bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-white/5 space-y-3">
              <div>
                <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mb-1">Pro Subscription</h3>
                <p>
                  You may request a refund within <strong className="text-slate-800 dark:text-slate-200">7 days</strong> of your initial subscription, provided you have not substantially used the service (e.g., you have consumed no or only a minimal amount of credits). If the service has been used, we will evaluate your request based on actual usage and may offer a partial refund or alternative compensation.
                </p>
              </div>
              <div>
                <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mb-1">Credit Packs</h3>
                <p>
                  Credit packs are delivered instantly as digital products and are generally non-refundable. However, we may provide a refund or compensation for duplicate charges, payment errors, or other reasonable special circumstances.
                </p>
              </div>
              <div>
                <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mb-1">Technical Issues</h3>
                <p>
                  If a generation task fails due to platform server errors or system outages and no result is returned, the corresponding credits will be automatically refunded to your account. Issues caused by upload image quality, network connectivity, or content moderation are not covered.
                </p>
              </div>
              <div>
                <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mb-1">How to Request a Refund</h3>
                <p>
                  Contact us at <a href="mailto:support@lazoraai.com" className="text-purple-600 dark:text-purple-400 hover:underline">support@lazoraai.com</a> with your registered email, date of purchase, and reason for refund. We will respond within 5 business days. Refunds are processed through Paddle and typically take 5–10 business days.
                </p>
              </div>
              <div>
                <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mb-1">EU Users</h3>
                <p>
                  Under the EU Consumer Rights Directive, the right of withdrawal for digital content ends once delivery has begun. By completing your purchase, you agree to the immediate provision of digital services and acknowledge that your right of withdrawal will be limited accordingly.
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              For full billing details, see our <Link to="/credit-rules" className="text-purple-600 dark:text-purple-400 hover:underline">Billing Policy</Link>.
            </p>
          </section>

          {/* 9. Disclaimers */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">9. Disclaimers</h2>
            <p>
              Lazora is provided on an <strong className="text-slate-800 dark:text-slate-200">"as is"</strong> and <strong className="text-slate-800 dark:text-slate-200">"as available"</strong> basis. We make no warranties, express or implied, regarding:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
              <li>The quality, accuracy, or suitability of AI-generated images for your specific use case</li>
              <li>Uninterrupted, error-free, or secure access to the service</li>
              <li>Compatibility of generated content with any particular platform, marketplace, or advertising standard</li>
            </ul>
            <p className="mt-3">
              AI-generated images may occasionally contain artifacts, inconsistencies, or unexpected results. You are responsible for reviewing all generated content before use.
            </p>
          </section>

          {/* 10. Limitation of Liability */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">10. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by applicable law, Lazora shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, business opportunities, or goodwill, arising out of or related to your use of our service.
            </p>
            <p className="mt-3">
              Our total aggregate liability to you for any claims arising from or related to the service shall not exceed the total amount you paid to us in the <strong className="text-slate-800 dark:text-slate-200">12 months</strong> preceding the claim.
            </p>
          </section>

          {/* 11. Force Majeure */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">11. Force Majeure</h2>
            <p>
              Lazora shall not be liable for any failure or delay in performing our obligations where such failure or delay results from circumstances beyond our reasonable control, including but not limited to:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
              <li>Natural disasters, acts of God, or extreme weather events</li>
              <li>War, terrorism, riots, or civil unrest</li>
              <li>Government actions, laws, regulations, or sanctions</li>
              <li>Failure or unavailability of third-party AI service providers</li>
              <li>Internet or infrastructure outages beyond our control</li>
              <li>Cyberattacks, including DDoS attacks or security breaches</li>
              <li>Pandemics, epidemics, or public health emergencies</li>
            </ul>
            <p className="mt-3">
              In the event of a force majeure, we will make reasonable efforts to resume service as soon as practicable.
            </p>
          </section>

          {/* 12. Service Termination */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">12. Service Termination</h2>
            <p>
              We reserve the right to suspend or permanently terminate your account if:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
              <li>You violate any provision of these Terms of Service</li>
              <li>You generate or attempt to generate prohibited content</li>
              <li>You engage in fraudulent or abusive behavior</li>
              <li>Your use poses a security risk to our platform or other users</li>
              <li>Required by law or regulation</li>
            </ul>
            <p className="mt-3">
              Upon termination for violations, you forfeit any remaining credits and are not entitled to a refund. We may provide notice before termination when feasible, but reserve the right to act immediately for severe violations.
            </p>
          </section>

          {/* 13. Indemnification */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">13. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Lazora, its affiliates, and service providers from any claims, damages, losses, or expenses (including legal fees) arising from your use of the service, your violation of these terms, or your infringement of any third-party rights.
            </p>
          </section>

          {/* 14. Governing Law */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">14. Governing Law</h2>
            <p>
              These Terms of Service shall be governed by and construed in accordance with the laws of the <strong className="text-slate-800 dark:text-slate-200">Hong Kong Special Administrative Region</strong>, without regard to its conflict of law principles.
            </p>
            <p className="mt-3">
              Any disputes arising from or relating to these terms or your use of the service shall be subject to the exclusive jurisdiction of the courts of Hong Kong SAR. Before initiating any legal proceedings, both parties agree to attempt to resolve disputes through good-faith negotiation.
            </p>
          </section>

          {/* 15. Changes to Terms */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">15. Changes to These Terms</h2>
            <p>
              We may update these Terms of Service from time to time. When we do, we will update the "Last updated" date at the top of this page. For significant changes that affect your rights, we will notify you by email or by posting a prominent notice on our website at least 14 days before the changes take effect.
            </p>
            <p className="mt-3">
              Your continued use of Lazora after changes take effect constitutes acceptance of the revised terms.
            </p>
          </section>

          {/* 16. Contact */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">16. Contact Us</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us:
            </p>
            <div className="mt-3 p-4 bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-white/5">
              <p><strong className="text-slate-800 dark:text-slate-200">Lazora</strong></p>
              <p>Email: <a href="mailto:support@lazoraai.com" className="text-purple-600 dark:text-purple-400 hover:underline">support@lazoraai.com</a></p>
              <p>Website: <a href="https://www.lazoraai.com" className="text-purple-600 dark:text-purple-400 hover:underline">www.lazoraai.com</a></p>
            </div>
          </section>

        </div>

        {/* Footer Links */}
        <div className="mt-12 pt-8 border-t border-slate-200 dark:border-white/5 flex flex-wrap gap-4 text-sm text-slate-400 dark:text-slate-500">
          <Link to="/privacy" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
            Privacy Policy
          </Link>
          <span>·</span>
          <Link to="/" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
            Back to Home
          </Link>
        </div>

      </div>
    </div>
  );
};
