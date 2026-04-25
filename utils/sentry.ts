import * as Sentry from '@sentry/react';

/**
 * Initialize Sentry error monitoring
 * Call this before rendering the React app
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  
  // Only initialize if DSN is configured
  if (!dsn) {
    console.log('Sentry DSN not configured, skipping initialization');
    return;
  }

  // Only initialize in production, or if explicitly enabled
  const isDev = import.meta.env.DEV;
  if (isDev && !import.meta.env.VITE_SENTRY_ENABLE_DEV) {
    console.log('Sentry disabled in development');
    return;
  }

  Sentry.init({
    dsn,
    
    // Environment tag (production/development)
    environment: import.meta.env.MODE,
    
    // Only send errors, not performance data (saves quota)
    tracesSampleRate: 0,
    
    // Don't send PII by default
    sendDefaultPii: false,
    
    // Filter out common noise
    ignoreErrors: [
      // Browser extensions
      'top.GLOBALS',
      'originalCreateNotification',
      'canvas.contentDocument',
      'MyApp_RemoveAllHighlights',
      'http://tt.telehealth-platform.com/',
      'jigsaw is not defined',
      'ComboSearch is not defined',
      'atomicFindClose',
      
      // Facebook
      'fb_xd_fragment',
      
      // Chrome extensions
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      
      // Safari
      /webkit-masked-url/,
      
      // Network errors
      'Network request failed',
      'Failed to fetch',
      'Load failed',
      'NetworkError',
      
      // User-caused (closing browser, etc.)
      'AbortError',
      'ResizeObserver loop',
    ],
    
    // Before sending, filter out some events
    beforeSend(event, hint) {
      // Don't send errors from localhost unless explicitly enabled
      if (window.location.hostname === 'localhost' && !import.meta.env.VITE_SENTRY_ENABLE_DEV) {
        return null;
      }
      
      return event;
    },
  });

  console.log('Sentry initialized');
}

/**
 * Manually capture an exception
 * Use this in catch blocks for important errors
 */
export function captureException(error: Error, context?: Record<string, any>) {
  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Manually capture a message
 * Use this for important events that aren't errors
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  Sentry.captureMessage(message, level);
}

/**
 * Set user context for better error tracking
 * Call this after user logs in
 */
export function setUser(user: { id: string; email?: string }) {
  Sentry.setUser(user);
}

/**
 * Clear user context
 * Call this after user logs out
 */
export function clearUser() {
  Sentry.setUser(null);
}

// Re-export ErrorBoundary for use in App.tsx
export { ErrorBoundary } from '@sentry/react';