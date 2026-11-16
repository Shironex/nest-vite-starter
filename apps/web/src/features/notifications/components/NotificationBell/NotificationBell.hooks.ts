import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import type { INotificationBellView } from './NotificationBell.types';

export function useNotificationBell(): INotificationBellView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Postgres is the source of truth for the bell: hydrate from the API and
  // let use-socket merge live events into this same cache entry. The query
  // runs unconditionally because the bell mounts only inside the
  // authenticated layout (routes/_authenticated.tsx); an auth-flag gate here
  // would never observe an unauthenticated mount.
  const { data, isLoading } = useQuery(trpc.notifications.list.queryOptions({}));

  // Callbacks are passed INTO mutationOptions (not spread around it) so the
  // onMutate context type is inferred instead of pinned to undefined.
  const markAllReadMutation = useMutation(
    trpc.notifications.markAllRead.mutationOptions({
      // Optimistic: flip the cached page to read and zero the badge, roll
      // back on error, then reconcile with the server either way.
      onMutate: async () => {
        const queryKey = trpc.notifications.list.queryKey({});
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        if (previous) {
          queryClient.setQueryData(queryKey, {
            items: previous.items.map((item) => ({ ...item, read: true })),
            unreadCount: 0,
          });
        }
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) {
          queryClient.setQueryData(trpc.notifications.list.queryKey({}), context.previous);
        }
        // The rollback is visible (badge snaps back) but unexplained without
        // this; there is no global mutations.onError to fall back on.
        toast.error(t('notifications.markAllFailed'));
      },
      onSettled: () => {
        void queryClient.invalidateQueries(trpc.notifications.list.pathFilter());
      },
    }),
  );

  const notifications = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const hasUnread = unreadCount > 0;
  const badgeLabel = unreadCount > 9 ? '9+' : String(unreadCount);
  const ariaLabel = hasUnread
    ? t('notifications.bellLabelUnread', { count: unreadCount })
    : t('notifications.bellLabel');
  // Gated on isLoading so the first fetch renders skeleton rows instead of a
  // false "No notifications" flash (the sibling first-load convention).
  const isEmpty = !isLoading && notifications.length === 0;

  return {
    notifications,
    badgeLabel,
    ariaLabel,
    isEmpty,
    isLoading,
    hasUnread,
    onMarkAllAsRead: () => {
      markAllReadMutation.mutate();
    },
  };
}
