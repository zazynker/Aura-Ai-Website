import * as Sentry from '@sentry/react';

/**
 * Initialize Sentry error monitoring
 * Call this before rendering the React app
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  
  // Only initialize if DSN is configured
  if (!dsn) {
    console.log('[Sentry] DSN not configured, skipping');
    return;
  }

  try {
    Sentry.init({
      dsn,
      
      // Environment tag
      environment: import.meta.env.MODE || 'production',
      
      // Disable performance monitoring to save quota
      tracesSampleRate: 0,
      
      // Don't send PII
      sendDefaultPii: false,
    });
    
    console.log('[Sentry] Initialized successfully');
  } catch (error) {
    console.error('[Sentry] Failed to initialize:', error);
  }
}

/**
 * Manually capture an exception
 */
export function captureException(error: Error, context?: Record<string, any>) {
  Sentry.captureException(error, { extra: context });
}

/**
 * Manually capture a message
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  Sentry.captureMessage(message, level);
}

/**
 * Set user context for better error tracking
 */
export function setUser(user: { id: string; email?: string }) {
  Sentry.setUser(user);
}

/**
 * Clear user context
 */
export function clearUser() {
  Sentry.setUser(null);
}