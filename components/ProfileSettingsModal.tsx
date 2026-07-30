import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { compressAvatar } from '../utils/avatar';
import {
  checkUsernameAvailability,
  fetchMyProfile,
  removeProfileAvatar,
  updateMyProfile,
  uploadProfileAvatar,
  type UserPublicProfile,
} from '../utils/profileApi';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9 _.-]{2,29}$/;

export const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { user, updateUser, addToast } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [profile, setProfile] = useState<UserPublicProfile | null>(null);
  const [username, setUsername] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>('idle');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAvatarFile(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setAvatarPreview(user.avatarUrl || user.avatar || null);
    setUsername(user.name);
    void fetchMyProfile()
      .then((nextProfile) => {
        if (cancelled || !nextProfile) return;
        setProfile(nextProfile);
        setUsername(nextProfile.username);
        setAvatarPreview(nextProfile.avatarUrl || user.avatarUrl || user.avatar || null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, user?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = username.trim();
    if (!USERNAME_PATTERN.test(trimmed)) {
      setAvailability('invalid');
      return;
    }
    if (trimmed === profile?.username || trimmed === user?.name) {
      setAvailability('available');
      return;
    }
    setAvailability('checking');
    const timer = window.setTimeout(() => {
      void checkUsernameAvailability(trimmed)
        .then((available) => setAvailability(available ? 'available' : 'taken'))
        .catch(() => setAvailability('error'));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [isOpen, profile?.username, user?.name, username]);

  const handleAvatarFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressAvatar(file);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const previewUrl = URL.createObjectURL(compressed);
      previewUrlRef.current = previewUrl;
      setAvatarFile(compressed);
      setAvatarPreview(previewUrl);
    } catch (avatarError) {
      setError(avatarError instanceof Error ? avatarError.message : 'Could not process this avatar.');
    }
  };

  const handleSave = async () => {
    if (!user || !USERNAME_PATTERN.test(username.trim())) return;
    setSaving(true);
    setError(null);
    let uploaded: { publicUrl: string; path: string } | null = null;
    try {
      if (avatarFile) uploaded = await uploadProfileAvatar(user.id, avatarFile);
      const nextProfile = await updateMyProfile({
        username,
        avatarUrl: uploaded?.publicUrl || profile?.avatarUrl || user.avatarUrl || user.avatar || null,
        avatarPath: uploaded?.path || profile?.avatarPath || null,
      });
      if (uploaded && profile?.avatarPath && profile.avatarPath !== uploaded.path) {
        await removeProfileAvatar(profile.avatarPath);
      }
      setProfile(nextProfile);
      updateUser({
        name: nextProfile.username,
        avatar: nextProfile.avatarUrl || undefined,
        avatarUrl: nextProfile.avatarUrl || undefined,
      });
      addToast('success', 'Profile updated.');
      onClose();
    } catch (saveError) {
      if (uploaded) await removeProfileAvatar(uploaded.path);
      setError(saveError instanceof Error ? saveError.message : 'Could not update your profile.');
    } finally {
      setSaving(false);
    }
  };

  const usernameChanged = Boolean(profile && username.trim() !== profile.username);
  const noChanges = !avatarFile && !usernameChanged;
  const remaining = profile?.usernameChangesRemaining ?? 3;
  const saveDisabled = loading
    || saving
    || noChanges
    || availability !== 'available'
    || (usernameChanged && remaining <= 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={saving ? () => undefined : onClose}
      title="Edit profile"
      size="sm"
      footer={(
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="gradient" onClick={() => void handleSave()} isLoading={saving} disabled={saveDisabled}>
            Save changes
          </Button>
        </div>
      )}
    >
      {loading ? (
        <div className="flex min-h-56 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-purple-500" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void handleAvatarFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative h-28 w-28 overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-lg ring-2 ring-purple-300 transition hover:ring-purple-500 dark:border-slate-900 dark:bg-slate-800"
              aria-label="Upload a new avatar"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="mx-auto h-9 w-9 text-slate-400" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                <Camera className="h-6 w-6 text-white" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 text-sm font-medium text-purple-600 hover:text-purple-700 dark:text-purple-400"
            >
              Upload new avatar
            </button>
            <p className="mt-1 text-center text-xs text-slate-400">
              Automatically center-cropped and compressed to 512 x 512 WebP.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Username
            </label>
            <div className="relative">
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={30}
                className={`w-full rounded-xl border bg-white px-4 py-3 pr-10 text-sm text-slate-900 outline-none transition dark:bg-slate-900 dark:text-white ${
                  availability === 'taken' || availability === 'invalid' || availability === 'error'
                    ? 'border-red-400 focus:ring-2 focus:ring-red-400/30'
                    : 'border-slate-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700'
                }`}
                placeholder="Choose a public username"
              />
              {availability === 'checking' && (
                <Loader2 className="absolute right-3 top-3.5 h-4 w-4 animate-spin text-slate-400" />
              )}
              {availability === 'available' && (
                <Check className="absolute right-3 top-3.5 h-4 w-4 text-emerald-500" />
              )}
            </div>
            <div className="mt-2 flex items-start justify-between gap-3 text-xs">
              <p className={availability === 'taken' || availability === 'invalid' || availability === 'error' ? 'text-red-500' : 'text-slate-400'}>
                {availability === 'taken'
                  ? 'That username is already taken.'
                  : availability === 'invalid'
                    ? 'Use 3-30 letters, numbers, spaces, dots, hyphens, or underscores.'
                    : availability === 'error'
                      ? 'Username availability could not be checked.'
                      : 'This name is public and appears on your published templates.'}
              </p>
              <span className="shrink-0 text-slate-400">{username.trim().length}/30</span>
            </div>
          </div>

          <div className={`rounded-xl border p-3 text-xs ${
            remaining > 0
              ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300'
          }`}>
            You have <strong>{remaining} of 3</strong> username changes remaining in the rolling 12-month period.
            {profile?.nextUsernameChangeResetAt && remaining < 3 && (
              <span> The next change becomes available on {new Date(profile.nextUsernameChangeResetAt).toLocaleDateString()}.</span>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
