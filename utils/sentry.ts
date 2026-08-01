type SentryModule = typeof import('@sentry/react');

let sentryModulePromise: Promise<SentryModule> | null = null;

const loadSentry = (): Promise<SentryModule> => {
  if (!sentryModulePromise) {
    sentryModulePromise = import('@sentry/react');
  }
  return sentryModulePromise;
};

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

  void loadSentry()
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE || 'production',
        tracesSampleRate: 0,
        sendDefaultPii: false,
      });
      console.log('[Sentry] Initialized successfully');
    })
    .catch((error) => console.error('[Sentry] Failed to initialize:', error));
}

/**
 * Manually capture an exception
 */
export function captureException(error: Error, context?: Record<string, any>) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  void loadSentry().then((Sentry) => {
    Sentry.captureException(error, { extra: context });
  });
}

/**
 * Manually capture a message
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  void loadSentry().then((Sentry) => {
    Sentry.captureMessage(message, level);
  });
}

/**
 * Set user context for better error tracking
 */
export function setUser(user: { id: string; email?: string }) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  void loadSentry().then((Sentry) => Sentry.setUser(user));
}

/**
 * Clear user context
 */
export function clearUser() {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  void loadSentry().then((Sentry) => Sentry.setUser(null));
}
