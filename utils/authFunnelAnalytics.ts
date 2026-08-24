import { supabase } from './supabase';

export type AuthFunnelEventName =
  | 'signup_viewed' | 'login_viewed' | 'signup_google_clicked' | 'login_google_clicked'
  | 'signup_email_submitted' | 'login_email_submitted' | 'signup_validation_failed'
  | 'signup_email_sent' | 'signup_failed' | 'login_success' | 'login_failed'
  | 'confirmation_resend_requested' | 'confirmation_resent'
  | 'confirmation_resend_failed' | 'auth_success' | 'signup_completed' | 'quick_use_auth_requested'
  | 'quick_use_restored';

interface FunnelSession { id: string; createdAt: number }

const SESSION_KEY = 'lazora_auth_funnel_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PENDING_AUTH_KEY = 'lazora_auth_attempt_pending';

export interface PendingAuthAttempt {
  authMethod: string;
  entryContext: string;
  intent: 'signup' | 'login';
  startedAt: number;
}

export const markAuthAttemptPending = (
  authMethod: string,
  entryContext: string,
  intent: 'signup' | 'login',
): void => {
  try {
    localStorage.setItem(PENDING_AUTH_KEY, JSON.stringify({ authMethod, entryContext, intent, startedAt: Date.now() }));
  } catch {
    // Authentication still works when storage is unavailable.
  }
};

export const consumePendingAuthAttempt = (): PendingAuthAttempt | null => {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_AUTH_KEY) || 'null') as PendingAuthAttempt | null;
    localStorage.removeItem(PENDING_AUTH_KEY);
    if (!pending || !['signup', 'login'].includes(pending.intent) || Date.now() - pending.startedAt > SESSION_MAX_AGE_MS) return null;
    return pending;
  } catch {
    return null;
  }
};

const getFunnelSessionId = (): string => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as FunnelSession | null;
    if (parsed?.id && Date.now() - parsed.createdAt < SESSION_MAX_AGE_MS) return parsed.id;
  } catch {
    // Replace malformed or unavailable storage with a new anonymous id.
  }
  const next = { id: crypto.randomUUID(), createdAt: Date.now() };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* analytics is optional */ }
  return next.id;
};

export const trackAuthFunnelEvent = (
  eventName: AuthFunnelEventName,
  details: { authMethod?: string; entryContext?: string; errorCode?: string } = {},
): void => {
  void supabase.rpc('log_auth_funnel_event', {
    p_event_name: eventName,
    p_session_id: getFunnelSessionId(),
    p_auth_method: details.authMethod || null,
    p_entry_context: details.entryContext || null,
    p_error_code: details.errorCode || null,
  }).then(({ error }) => {
    if (error) console.warn('Unable to record auth funnel event:', error.message);
  });
};
