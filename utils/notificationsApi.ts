import { supabase } from './supabase';
import type { CreatorRewardCelebration, CreatorRewardTemplateSummary } from '../types';

export type NotificationType =
  | 'template_approved'
  | 'template_changes_requested'
  | 'creator_credits_earned'
  | 'platform_creator_bonus';

export interface UserNotification {
  id: string;
  type: NotificationType;
  templateId: string | null;
  rewardId: string | null;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  readAt: string | null;
  celebratedAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  type: NotificationType;
  template_id: string | null;
  reward_id: string | null;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  celebrated_at: string | null;
  created_at: string;
}

const normalizeNotification = (row: NotificationRow): UserNotification => ({
  id: row.id,
  type: row.type,
  templateId: row.template_id,
  rewardId: row.reward_id,
  title: row.title,
  body: row.body,
  metadata: row.metadata || {},
  readAt: row.read_at,
  celebratedAt: row.celebrated_at,
  createdAt: row.created_at,
});

export async function fetchMyNotifications(limit = 50): Promise<UserNotification[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const { data, error } = await supabase
    .from('notifications')
    .select('id,type,template_id,reward_id,title,body,metadata,read_at,celebrated_at,created_at')
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  return ((data || []) as NotificationRow[]).map(normalizeNotification);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_read', {
    p_notification_id: notificationId,
  });
  if (error) throw new Error(`Could not mark this notification as read: ${error.message}`);
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_all_notifications_read');
  if (error) throw new Error(`Could not mark notifications as read: ${error.message}`);
}

const toNonNegativeInteger = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const normalizeUsernames = (value: unknown): string[] => (
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
    : []
);

const normalizeCelebrationTemplate = (value: unknown): CreatorRewardTemplateSummary | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.templateId !== 'string' || typeof row.templateName !== 'string') return null;
  return {
    templateId: row.templateId,
    templateName: row.templateName,
    creditsEarned: toNonNegativeInteger(row.creditsEarned),
    userCount: toNonNegativeInteger(row.userCount),
    usernames: normalizeUsernames(row.usernames),
  };
};

export async function claimCreatorRewardCelebration(): Promise<CreatorRewardCelebration | null> {
  const { data, error } = await supabase.rpc('claim_creator_reward_celebration_v2');
  if (error) throw new Error(`Could not load creator rewards: ${error.message}`);
  if (!data || typeof data !== 'object') return null;

  const result = data as Record<string, unknown>;
  if (result.hasRewards !== true) return null;

  const templates = Array.isArray(result.templates)
    ? result.templates.map(normalizeCelebrationTemplate).filter((item): item is CreatorRewardTemplateSummary => item !== null)
    : [];
  const creditsEarned = toNonNegativeInteger(result.creditsEarned);
  if (creditsEarned <= 0 || templates.length === 0) return null;

  return {
    claimedAt: typeof result.claimedAt === 'string' ? result.claimedAt : new Date().toISOString(),
    notificationCount: toNonNegativeInteger(result.notificationCount),
    userCount: toNonNegativeInteger(result.userCount),
    templateCount: toNonNegativeInteger(result.templateCount),
    creditsEarned,
    primaryTemplateId: typeof result.primaryTemplateId === 'string' ? result.primaryTemplateId : null,
    usernames: normalizeUsernames(result.usernames),
    templates,
  };
}
