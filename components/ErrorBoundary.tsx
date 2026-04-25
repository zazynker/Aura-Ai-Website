// components/ErrorBoundary.tsx
import React from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { captureException } from '../utils/sentry';
import { AlertTriangle, RefreshCw } from 'lucide-react';

function ErrorFallback({ error }: { error: Error }) {
  const handleReload = () => window.location.reload();
  const handleGoHome = () => {
    window.location.href = '/#/';
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
        </div>
        
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
          Oops! Something went wrong
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">
          We're sorry, but something unexpected happened. Our team has been notified.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={handleReload}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Page
          </button>
          <button
            onClick={handleGoHome}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-medium rounded-xl transition-colors"
          >
            Go to Home
          </button>
        </div>
        
        {import.meta.env.DEV && (
          <details className="mt-8 text-left">
            <summary className="text-sm text-slate-500 cursor-pointer">
              Technical Details
            </summary>
            <pre className="mt-2 p-4 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs text-red-600 dark:text-red-400 overflow-auto max-h-48">
              {error.message}
              {'\n\n'}
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function logError(error: Error, info: { componentStack?: string | null }) {
  captureException(error, { componentStack: info.componentStack });
  console.error('ErrorBoundary caught:', error);
}

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ReactErrorBoundary FallbackComponent={ErrorFallback} onError={logError}>
      {children}
    </ReactErrorBoundary>
  );
}

export default ErrorBoundary;