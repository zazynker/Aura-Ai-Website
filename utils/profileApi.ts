import { supabase } from './supabase';

export const PROFILE_AVATARS_BUCKET = 'profile-avatars';

export interface UserPublicProfile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  avatarPath: string | null;
  usernameChangesUsed: number;
  usernameChangesRemaining: number;
  nextUsernameChangeResetAt: string | null;
}

type ProfileRpcRow = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  avatar_path: string | null;
  username_changes_used: number | string | null;
  username_changes_remaining: number | string | null;
  next_username_change_reset_at: string | null;
};

const mapProfile = (value: unknown): UserPublicProfile | null => {
  const row = (Array.isArray(value) ? value[0] : value) as ProfileRpcRow | null;
  if (!row?.user_id || !row.username) return null;
  return {
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url,
    avatarPath: row.avatar_path,
    usernameChangesUsed: Number(row.username_changes_used || 0),
    usernameChangesRemaining: Number(row.username_changes_remaining ?? 3),
    nextUsernameChangeResetAt: row.next_username_change_reset_at,
  };
};

const profileErrorMessage = (error: { message?: string; code?: string }): string => {
  const message = error.message || '';
  if (message.includes('USERNAME_TAKEN') || error.code === '23505') {
    return 'That username is already taken.';
  }
  if (message.includes('USERNAME_CHANGE_LIMIT_REACHED')) {
    return 'You have used all 3 username changes available in the last year.';
  }
  if (message.includes('USERNAME_INVALID') || error.code === '22023') {
    return 'Use 3-30 letters, numbers, spaces, dots, hyphens, or underscores.';
  }
  return message || 'Could not update your profile.';
};

export async function fetchMyProfile(): Promise<UserPublicProfile | null> {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) {
    console.warn('Public profile is unavailable:', error.message);
    return null;
  }
  return mapProfile(data);
}

export async function checkUsernameAvailability(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_username_availability', {
    p_username: username.trim(),
  });
  if (error) throw new Error(profileErrorMessage(error));
  return Boolean(data);
}

export async function uploadProfileAvatar(
  userId: string,
  file: File,
): Promise<{ publicUrl: string; path: string }> {
  const path = `${userId}/avatar-${Date.now()}.webp`;
  const { data, error } = await supabase.storage
    .from(PROFILE_AVATARS_BUCKET)
    .upload(path, file, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });
  if (error) throw new Error(`Avatar upload failed: ${error.message}`);
  const publicUrl = supabase.storage
    .from(PROFILE_AVATARS_BUCKET)
    .getPublicUrl(data.path).data.publicUrl;
  return { publicUrl, path: data.path };
}

export async function removeProfileAvatar(path?: string | null): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([path]);
  if (error) console.warn('Old avatar cleanup failed:', error.message);
}

export async function updateMyProfile(input: {
  username: string;
  avatarUrl: string | null;
  avatarPath: string | null;
}): Promise<UserPublicProfile> {
  const { data, error } = await supabase.rpc('update_my_profile', {
    p_username: input.username.trim(),
    p_avatar_url: input.avatarUrl,
    p_avatar_path: input.avatarPath,
  });
  if (error) throw new Error(profileErrorMessage(error));
  const profile = mapProfile(data);
  if (!profile) throw new Error('The updated profile could not be read back.');
  const { error: metadataError } = await supabase.auth.updateUser({
    data: {
      name: profile.username,
      avatar_url: profile.avatarUrl,
    },
  });
  if (metadataError) {
    console.warn('Auth profile metadata could not be synchronized:', metadataError.message);
  }
  return profile;
}

export async function fetchPublicProfiles(
  userIds: string[],
): Promise<Map<string, { username: string; avatarUrl: string | null }>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id,username,avatar_url')
    .in('user_id', ids);
  if (error) {
    console.warn('Creator profiles are unavailable:', error.message);
    return new Map();
  }
  return new Map((data || []).map((row) => [
    row.user_id,
    { username: row.username, avatarUrl: row.avatar_url },
  ]));
}
