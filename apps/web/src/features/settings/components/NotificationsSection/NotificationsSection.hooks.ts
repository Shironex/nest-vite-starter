import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { ALL_NOTIFICATION_CATEGORIES } from '@repo/shared/schemas';
import type { NotificationCategory, NotificationChannelMatrix } from '@repo/shared/schemas';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  INotificationCategoryRowView,
  INotificationsSectionView,
  NotificationChannelKey,
} from './NotificationsSection.types';

/**
 * The channels actually WIRED per category in v1. The wire schema stores all
 * three flags for every category (forward-compatible), but
 * the event categories deliver in-app only today.
 * A toggle for a channel that delivers nothing would be a promise the app
 * cannot keep, so unwired cells are not rendered at all.
 */
const WIRED_CHANNELS: Record<NotificationCategory, readonly NotificationChannelKey[]> = {
  WORKSPACE_CREATED: ['inApp'],
  ADMIN_ACTIONS: ['inApp'],
};

/**
 * The caller's per-category notification channel matrix.
 *
 * Each flip round-trips the WHOLE matrix (the wire schema is an exhaustive
 * record, the same contract as the reminder-ladder editor), built from the
 * server state with one flag changed. While the save is in flight the
 * switches render the OPTIMISTIC matrix from the mutation variables and stay
 * disabled, then settle on whatever the server answered after the
 * invalidation, so a failed save snaps visibly back.
 *
 * `preferencesUpdate` carries IdempotencyMiddleware server-side; the key is
 * minted and reset here, mirroring `useUpdateReminderPolicy`.
 */
export function useNotificationsSection(): INotificationsSectionView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const preferences = useQuery(trpc.notifications.preferencesGet.queryOptions());
  const { idempotencyKey, reset } = useIdempotencyKey();

  const update = useMutation(
    trpc.notifications.preferencesUpdate.mutationOptions({
      trpc: { context: { idempotencyKey } },
      onSuccess: async () => {
        reset();
        await queryClient.invalidateQueries({
          queryKey: trpc.notifications.preferencesGet.pathKey(),
        });
      },
    }),
  );

  const saved = preferences.data?.channels;
  // Optimistic while in flight: the matrix being saved is what the user just
  // asked for, and showing the stale value until the refetch lands would make
  // every flip feel dropped.
  const channels = update.isPending ? (update.variables?.channels ?? saved) : saved;

  function onToggle(
    category: NotificationCategory,
    channel: NotificationChannelKey,
    checked: boolean,
  ): void {
    if (channels === undefined) return;
    const next: NotificationChannelMatrix = {
      ...channels,
      [category]: { ...channels[category], [channel]: checked },
    };
    update.mutate(
      { channels: next },
      {
        onSuccess: () => {
          toast.success(t('notificationPrefs.saveSuccess'));
        },
        onError: (error) => {
          toast.error(translateAppError(error) ?? t('errors.unexpected'));
        },
      },
    );
  }

  const rows: INotificationCategoryRowView[] =
    channels === undefined
      ? []
      : ALL_NOTIFICATION_CATEGORIES.map((category) => ({
          category,
          label: t(`notificationPrefs.categories.${category}.label`),
          description: t(`notificationPrefs.categories.${category}.description`),
          toggles: WIRED_CHANNELS[category].map((channel) => ({
            channel,
            id: `notification-prefs-${category}-${channel}`,
            label: t(`notificationPrefs.channels.${channel}`),
            checked: channels[category][channel],
          })),
        }));

  return {
    rows,
    isLoading: preferences.isPending,
    hasLoadError: preferences.isError,
    isSaving: update.isPending,
    labels: {
      title: t('notificationPrefs.title'),
      description: t('notificationPrefs.description'),
      loadError: t('notificationPrefs.loadError'),
    },
    onToggle,
  };
}
