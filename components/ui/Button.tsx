import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'gradient' | 'danger';
  isLoading?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  isLoading,
  className = '',
  size = 'md',
  disabled,
  ...props
}) => {
  // Updated focus:ring-offset-slate-900 to focus:ring-offset-white dark:focus:ring-offset-slate-900
  const baseStyles = 'relative inline-flex items-center justify-center rounded-xl font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variants = {
    primary: 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 focus:ring-slate-900 dark:focus:ring-white',
    secondary: 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 focus:ring-slate-500',
    ghost: 'bg-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5',
    gradient: 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:shadow-lg hover:shadow-purple-500/30 hover:scale-[1.02] focus:ring-purple-500',
    danger: 'bg-gradient-to-r from-red-600 to-red-500 text-white hover:shadow-lg hover:shadow-red-500/30 focus:ring-red-500',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-5 py-2.5 text-base',
    lg: 'px-6 py-3.5 text-lg',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </button>
  );
};