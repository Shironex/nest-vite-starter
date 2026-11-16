import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { useAuth } from '@/hooks/use-auth';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { useAvatarUrl } from '@/hooks/use-avatar-url';
import { getInitials } from '@/lib/avatar';
import type { IProfileSectionView } from './ProfileSection.types';

export function useProfileSection(): IProfileSectionView | null {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  // Monotonic id so a slow first upload can't clobber the state of a newer one
  // when their mutations resolve out of order.
  const latestUploadId = useRef(0);

  // isLoading/isError are surfaced to the view: first load renders a skeleton
  // instead of flashing initials, and a failed lookup falls back to initials.
  const persistedAvatar = useAvatarUrl(user?.avatarUrl);

  const { idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();

  /*
   * The per-call `onSuccess` below stays where it is (it closes over the
   * upload id that decides whether this result is still current), so the key
   * is reset from the mutation-level handler instead: the two run together and
   * only this one has to fire even when a newer upload superseded this one.
   */
  const updateAvatarMutation = useMutation(
    trpc.user.updateAvatar.mutationOptions({
      trpc: { context: { idempotencyKey } },
      onSuccess: resetIdempotencyKey,
    }),
  );

  const handleUploadComplete = useCallback(
    (key: string, url: string) => {
      const uploadId = ++latestUploadId.current;
      setAvatarPreview(url);
      updateAvatarMutation.mutate(
        { avatarUrl: key },
        {
          onSuccess: () => {
            if (uploadId !== latestUploadId.current) return; // superseded by a newer upload
            // Invalidate user.me to refetch profile with the new avatarUrl.
            // pathFilter() tracks the router shape so a rename can't silently no-op.
            queryClient.invalidateQueries(trpc.user.me.pathFilter());
            toast.success(t('settings.profile.avatarUpdated'));
          },
          onError: () => {
            if (uploadId !== latestUploadId.current) return;
            // Roll back the optimistic preview - the avatar was NOT persisted.
            setAvatarPreview(null);
            toast.error(t('settings.profile.avatarUpdateFailed'));
          },
        },
      );
    },
    [updateAvatarMutation, queryClient, t],
  );

  const handleUploadError = useCallback((error: string) => {
    toast.error(error);
  }, []);

  if (!user) return null;

  const displayAvatarUrl = avatarPreview ?? persistedAvatar.url;

  return {
    displayName: user.displayName ?? t('settings.profile.notSet'),
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    initials: getInitials(user.displayName, user.email),
    displayAvatarUrl,
    // A fresh optimistic preview takes precedence over the URL lookup states.
    avatarLoading: !avatarPreview && persistedAvatar.isLoading,
    avatarError: !avatarPreview && persistedAvatar.isError,
    onUploadComplete: handleUploadComplete,
    onUploadError: handleUploadError,
  };
}
