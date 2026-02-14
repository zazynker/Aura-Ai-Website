
import React from 'react';
import { Link } from 'react-router-dom';

export const Footer = () => {
  return (
    <footer className="w-full border-t border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        
        {/* Left: Copyright */}
        <p className="text-sm text-slate-400 dark:text-slate-500">
          © {new Date().getFullYear()} Lazora. All rights reserved.
        </p>

        {/* Right: Links */}
        <div className="flex items-center gap-4 text-sm text-slate-400 dark:text-slate-500">
          <Link 
            to="/privacy" 
            className="hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            Privacy Policy
          </Link>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <Link 
            to="/terms" 
            className="hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            Terms of Service
          </Link>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <Link 
            to="/about" 
            className="hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            About
          </Link>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <a 
            href="mailto:fangyifan0924@gmail.com" 
            className="hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            Contact
          </a>
        </div>

      </div>
    </footer>
  );
};
