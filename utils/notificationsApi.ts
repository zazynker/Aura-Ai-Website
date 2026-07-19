import { supabase } from './supabase';

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
