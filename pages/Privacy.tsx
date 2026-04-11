import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';

export const Privacy = () => {
  const navigate = useNavigate();
  const lastUpdated = 'February 13, 2025';
  const companyName = 'Lazora';
  const contactEmail = 'support@lazoraai.com';
  const websiteUrl = 'www.lazoraai.com';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300 pt-24 pb-16 px-4">
      <div className="max-w-3xl mx-auto">

        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors mb-8 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back
        </button>

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-widest">Legal</span>
          </div>
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-3">Privacy Policy</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Last updated: {lastUpdated}</p>
        </div>

        {/* Content */}
        <div className="prose prose-slate dark:prose-invert max-w-none space-y-8">

          {/* Introduction */}
          <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-white/10">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Welcome to {companyName} (<a href={`https://${websiteUrl}`} className="text-purple-600 dark:text-purple-400 hover:underline">{websiteUrl}</a>).
              {' '}{companyName} is an AI-powered product photography generation service.
              This Privacy Policy explains how we collect, use, store, and protect your personal information when you use our website and services.
              By using {companyName}, you agree to the practices described in this policy. If you do not agree, please do not use our services.
            </p>
          </div>

          {/* 1. Information We Collect */}
          <Section title="1. Information We Collect">
            <SubSection title="1.1 Information You Provide">
              <ul>
                <li><strong>Account Information:</strong> When you create an account, we collect your email address and password. If you sign in via Google, we receive your name, email address, and profile picture from Google.</li>
                <li><strong>Uploaded Content:</strong> Images you upload for AI processing, text prompts and editing instructions you provide, and any other content you submit through our service.</li>
                <li><strong>Communication Data:</strong> If you contact us via email at <a href={`mailto:${contactEmail}`} className="text-purple-600 dark:text-purple-400 hover:underline">{contactEmail}</a>, we retain the content of that communication.</li>
              </ul>
            </SubSection>
            <SubSection title="1.2 Information Collected Automatically">
              <ul>
                <li><strong>Usage Data:</strong> Pages visited, features used, generation history, timestamps, and interaction patterns.</li>
                <li><strong>Device &amp; Browser Data:</strong> Browser type, operating system, screen resolution, and language preferences.</li>
                <li><strong>Local Storage:</strong> We use browser local storage to save your preferences (such as theme settings and browsing state). This data stays on your device and is not transmitted to our servers.</li>
              </ul>
            </SubSection>
            <SubSection title="1.3 Payment Information">
              <p>
                All payments are processed by <strong>Paddle.com Market Limited</strong>, which acts as our Merchant of Record.
                This means Paddle is the legal seller of our services and handles all payment processing, invoicing, and sales tax compliance.
                We do <strong>not</strong> directly collect, store, or have access to your credit card numbers or bank account details.
                For information on how Paddle handles your payment data, please refer to{' '}
                <a href="https://www.paddle.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline">Paddle's Privacy Policy</a>.
              </p>
            </SubSection>
          </Section>

          {/* 2. How We Use Your Information */}
          <Section title="2. How We Use Your Information">
            <p>We use the information we collect to:</p>
            <ul>
              <li>Provide, operate, and maintain our AI image generation service</li>
              <li>Process your image generation requests and deliver results</li>
              <li>Manage your account, credits, and subscription</li>
              <li>Process payments and refunds through Paddle</li>
              <li>Communicate with you about your account, service updates, or support requests</li>
              <li>Improve our service, fix bugs, and develop new features</li>
              <li>Prevent misuse, fraud, and enforce our Terms of Service</li>
              <li>Comply with legal obligations</li>
            </ul>
            <p>
              We do <strong>not</strong> sell your personal information to third parties.
              We do <strong>not</strong> use your content to train our own AI models. Our AI providers process data in real time and, to the best of our knowledge, do not retain it for model training purposes.
            </p>
          </Section>

          {/* 3. Third-Party Services */}
          <Section title="3. Third-Party Services">
            <p>We use the following third-party services to operate {companyName}:</p>
            <div className="space-y-3 mt-3">
              <div className="glass-panel rounded-xl p-4 border border-slate-200 dark:border-white/10">
                <p><strong>Paddle</strong> — Payment processing, invoicing, and sales tax. Paddle acts as the Merchant of Record for all transactions. <a href="https://www.paddle.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline">Paddle Privacy Policy</a></p>
              </div>
              <div className="glass-panel rounded-xl p-4 border border-slate-200 dark:border-white/10">
                <p><strong>Supabase</strong> — Authentication and database services. Your account data and generation history are stored on Supabase servers in the European Union (EU). <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline">Supabase Privacy Policy</a></p>
              </div>
              <div className="glass-panel rounded-xl p-4 border border-slate-200 dark:border-white/10">
                <p><strong>Google OAuth</strong> — If you choose to sign in with Google, Google shares your basic profile information with us. <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline">Google Privacy Policy</a></p>
              </div>
              <div className="glass-panel rounded-xl p-4 border border-slate-200 dark:border-white/10">
                <p><strong>AI Image Generation Provider</strong> — Your uploaded images and text prompts are sent to our AI processing provider to generate results. These images are processed in real-time. To the best of our knowledge, they are not retained by the provider for model training.</p>
              </div>
            </div>
          </Section>

          {/* 4. Data Storage & Security */}
          <Section title="4. Data Storage &amp; Security">
            <p>
              Your data is primarily stored on servers located in the <strong>European Union</strong> via Supabase.
              We implement industry-standard security measures including encrypted data transmission (HTTPS/TLS),
              secure authentication protocols, and access controls to protect your information.
            </p>
            <p>
              While we strive to protect your data, no method of transmission or storage is 100% secure.
              We cannot guarantee absolute security.
            </p>
          </Section>

          {/* 5. Data Retention */}
          <Section title="5. Data Retention">
            <p>We retain your data for as long as your account is active or as needed to provide you with our services. Specifically:</p>
            <ul>
              <li><strong>Account data:</strong> Retained until you delete your account.</li>
              <li><strong>Generated images:</strong> Retained for as long as your account is active. Deleted upon account deletion.</li>
              <li><strong>Uploaded images:</strong> Processed in real-time and not intentionally stored permanently by us after processing is complete.</li>
              <li><strong>Payment records:</strong> Retained by Paddle as required by applicable tax and financial regulations.</li>
            </ul>
          </Section>

          {/* 6. Your Rights */}
          <Section title="6. Your Rights">
            <p>Depending on your location, you may have the following rights regarding your personal data:</p>
            <ul>
              <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
              <li><strong>Correction:</strong> Request correction of inaccurate personal data.</li>
              <li><strong>Deletion:</strong> Request deletion of your account and associated data.</li>
              <li><strong>Data Portability:</strong> Request an export of your data in a machine-readable format.</li>
              <li><strong>Objection:</strong> Object to certain types of data processing.</li>
              <li><strong>Withdraw Consent:</strong> Withdraw consent for data processing at any time.</li>
            </ul>
            <p>
              To exercise any of these rights, please contact us at{' '}
              <a href={`mailto:${contactEmail}`} className="text-purple-600 dark:text-purple-400 hover:underline">{contactEmail}</a>.
              We will respond to your request within 30 days, in accordance with applicable laws.
            </p>
          </Section>

          {/* 7. GDPR Compliance */}
          <Section title="7. GDPR Compliance (EEA Users)">
            <p>
              {companyName} acts as the data controller for your personal data.
              If you are located in the European Economic Area (EEA), we process your personal data based on the following legal grounds:
            </p>
            <ul>
              <li><strong>Contract Performance:</strong> Processing necessary to provide you with our services.</li>
              <li><strong>Legitimate Interest:</strong> Processing for service improvement, security, and fraud prevention.</li>
              <li><strong>Consent:</strong> Processing based on your explicit consent (e.g., marketing emails, if applicable).</li>
              <li><strong>Legal Obligation:</strong> Processing necessary to comply with applicable laws.</li>
            </ul>
            <p>
              You have the right to lodge a complaint with a supervisory authority in your country of residence
              if you believe we have violated your data protection rights.
            </p>
          </Section>

          {/* 8. Cookies & Local Storage */}
          <Section title="8. Cookies &amp; Local Storage">
            <p>
              {companyName} uses browser local storage to save your user preferences (such as theme, browsing state, and session data).
              We do not currently use tracking cookies for analytics purposes. However, certain third-party services (such as Paddle) may use cookies as part of their functionality.
              You can clear your browser's local storage at any time through your browser settings.
            </p>
            <p>
              Please refer to Paddle's cookie policy for details on their cookie usage.
            </p>
          </Section>

          {/* 9. Age Restriction */}
          <Section title="9. Age Restriction">
            <p>
              Users must be at least <strong>18</strong> years old to use our services.
              {companyName} is designed for business professionals and is not intended for use by minors.
              We do not knowingly collect personal information from individuals under 18.
              If we become aware that a user under 18 has provided us with personal data,
              we will take steps to delete that information promptly.
            </p>
          </Section>

          {/* 10. International Data Transfers */}
          <Section title="10. International Data Transfers">
            <p>
              Your data may be transferred to and processed in countries outside your country of residence,
              including within the European Union (where our primary database is hosted) and other jurisdictions
              where our service providers operate. We ensure that such transfers are conducted in compliance
              with applicable data protection laws and that appropriate safeguards are in place.
            </p>
          </Section>

          {/* 11. Changes to This Policy */}
          <Section title="11. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date
              at the top of this page. For significant changes, we will notify you by email or by posting a prominent
              notice on our website. Your continued use of {companyName} after any changes constitutes acceptance of the updated policy.
            </p>
          </Section>

          {/* 12. Contact Us */}
          <Section title="12. Contact Us">
            <p>If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:</p>
            <div className="glass-panel rounded-xl p-4 border border-slate-200 dark:border-white/10 mt-3">
              <p className="text-slate-700 dark:text-slate-200"><strong>{companyName}</strong></p>
              <p className="text-slate-600 dark:text-slate-300">Email: <a href={`mailto:${contactEmail}`} className="text-purple-600 dark:text-purple-400 hover:underline">{contactEmail}</a></p>
              <p className="text-slate-600 dark:text-slate-300">Website: <a href={`https://${websiteUrl}`} className="text-purple-600 dark:text-purple-400 hover:underline">{websiteUrl}</a></p>
            </div>
          </Section>

        </div>

        {/* Footer Links */}
        <div className="mt-12 pt-8 border-t border-slate-200 dark:border-white/10 flex flex-wrap gap-4 text-sm text-slate-400 dark:text-slate-500">
          <Link to="/terms" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
            Terms of Service
          </Link>
          <span className="text-slate-300 dark:text-slate-600">&middot;</span>
          <Link to="/" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
            Back to Home
          </Link>
        </div>

      </div>
    </div>
  );
};

// Helper components
const Section = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="space-y-3">
    <h2 className="text-xl font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">{title}</h2>
    <div className="text-slate-600 dark:text-slate-300 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:ml-5 [&_ul]:space-y-1.5 [&_li]:text-slate-600 [&_li]:dark:text-slate-300">
      {children}
    </div>
  </div>
);

const SubSection = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="space-y-2">
    <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
    <div className="[&_ul]:list-disc [&_ul]:ml-5 [&_ul]:space-y-1.5">{children}</div>
  </div>
);
