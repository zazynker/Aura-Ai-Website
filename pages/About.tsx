import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Info, ChevronDown, Camera, Sparkles, Layout, Download, Mail } from 'lucide-react';

const faqs = [
  {
    q: 'What is Lazora?',
    a: 'Lazora is an AI-powered product photography platform designed for e-commerce sellers and brand owners. It helps you create professional, studio-style product photos in seconds — reducing the need for photographers, studios, and expensive equipment.',
  },
  {
    q: 'Who is Lazora for?',
    a: 'Lazora is built for e-commerce sellers, brand managers, marketing teams, and anyone who needs high-quality product images at scale. It is especially popular among beauty, skincare, fragrance, and cosmetics brands, but works great for any product category including food, electronics, fashion, and furniture.',
  },
  {
    q: 'What types of product photos can I create?',
    a: 'You can generate professional product photography with various backgrounds, lighting styles, and compositions. Choose from 500+ photography templates or customize your own scenes. Common use cases include e-commerce listings, social media content, advertising creatives, and brand lookbooks.',
  },
  {
    q: 'How does it work?',
    a: 'Simply upload your product image, choose a photography template or describe the scene you want, and Lazora\'s AI will generate a professional product photo for you. You can then download the result in high resolution for immediate use.',
  },
  {
    q: 'What are credits and how do they work?',
    a: 'Credits are consumed when you generate images. Higher resolution outputs cost more credits. The Free plan includes 120 welcome credits (one-time). The Pro plan ($29/month) includes 3,000 credits per month with rollover. You can also purchase Credit Packs that never expire.',
  },
  {
    q: 'How is payment handled?',
    a: 'All payments are securely processed by our payment partner, which acts as our Merchant of Record. Our payment partner handles billing, invoicing, currency conversion, and sales tax on our behalf. We never see or store your credit card information.',
  },
  {
    q: 'Can I get a refund?',
    a: 'Yes, we offer refunds within 7 days of purchase if you have used fewer than 5 credits. Refunds are processed through our payment partner and typically take 5–10 business days. Please see our Terms of Service for full refund policy details.',
  },
  {
    q: 'Is my data secure?',
    a: 'Yes. Your data is primarily stored on secure servers in the European Union via Supabase. We use encrypted data transmission (HTTPS/TLS) and do not sell your personal information. We do not use your images to train our own AI models. See our Privacy Policy for details.',
  },
  {
    q: 'What content is not allowed?',
    a: 'Lazora is strictly a product photography tool. We prohibit the generation of any content that is pornographic, violent, hateful, fraudulent, or infringes on intellectual property. Accounts violating these rules will be terminated. Full details are in our Terms of Service.',
  },
  {
    q: 'How can I contact support?',
    a: 'You can reach us anytime at support@lazoraai.com. We typically respond within 24 hours.',
  },
];

const FaqItem: React.FC<{ q: string; a: string }> = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden transition-all">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
      >
        <span className="font-medium text-slate-900 dark:text-white text-[15px] pr-4">{q}</span>
        <ChevronDown className={`w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-4 text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
          {a}
        </div>
      )}
    </div>
  );
};

export const About = () => {
  const navigate = useNavigate();

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
              <Info className="w-5 h-5 text-white" />
            </div>
            <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-widest">Company</span>
          </div>
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-3">About Lazora</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">AI-Powered Product Photography Platform</p>
        </div>

        {/* About Section */}
        <div className="space-y-8">

          {/* Mission */}
          <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-white/10">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-[15px]">
              Lazora is a professional AI product photography platform built for e-commerce sellers, brand owners, and marketing teams.
              We help businesses create stunning, studio-style product photos in seconds — reducing the need for photographers, physical studios, and expensive equipment.
            </p>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-[15px] mt-3">
              Whether you're launching a new skincare line, updating your online store, or creating social media content,
              Lazora gives you the tools to produce professional visuals that drive sales and build brand trust.
            </p>
          </div>

          {/* What We Do — Feature Highlights */}
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">What We Do</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { icon: Camera, title: 'Professional Product Photography', desc: 'Generate high-quality, studio-style product photos with AI-powered lighting, shadows, and compositions.' },
                { icon: Layout, title: '500+ Photography Templates', desc: 'Choose from a curated library of professional scenes designed for cosmetics, skincare, food, electronics, and more.' },
                { icon: Sparkles, title: 'AI Scene Customization', desc: 'Describe the scene you want in plain text and let AI create the perfect product shot for you.' },
                { icon: Download, title: 'High-Resolution Export', desc: 'Download your product photos in up to 4K resolution, optimized for various platforms and use cases.' },
              ].map((f, i) => (
                <div key={i} className="glass-panel rounded-xl p-4 border border-slate-200 dark:border-white/10 flex gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0 border border-purple-100 dark:border-purple-500/20">
                    <f.icon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{f.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Who It's For */}
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">Who It's For</h2>
            <div className="text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed space-y-2">
              <p>Lazora is designed for professionals who need high-quality product imagery at scale:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                {[
                  'E-commerce store owners',
                  'Beauty & skincare brands',
                  'Fragrance & cosmetics companies',
                  'Marketing & creative teams',
                  'Amazon / Shopify sellers',
                  'Social media managers',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* FAQ */}
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">Frequently Asked Questions</h2>
            <div className="space-y-2">
              {faqs.map((faq, i) => (
                <FaqItem key={i} q={faq.q} a={faq.a} />
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">Contact Us</h2>
            <div className="glass-panel rounded-xl p-5 border border-slate-200 dark:border-white/10 flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0 border border-purple-100 dark:border-purple-500/20">
                <Mail className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-300 text-[15px] leading-relaxed">
                  Have questions, feedback, or need support? We'd love to hear from you.
                </p>
                <a href="mailto:support@lazoraai.com" className="inline-flex items-center gap-2 mt-2 text-purple-600 dark:text-purple-400 hover:underline font-medium text-sm">
                  support@lazoraai.com
                </a>
              </div>
            </div>
          </div>

        </div>

        {/* Footer Links */}
        <div className="mt-12 pt-8 border-t border-slate-200 dark:border-white/10 flex flex-wrap gap-4 text-sm text-slate-400 dark:text-slate-500">
          <Link to="/privacy" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
            Privacy Policy
          </Link>
          <span className="text-slate-300 dark:text-slate-600">&middot;</span>
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