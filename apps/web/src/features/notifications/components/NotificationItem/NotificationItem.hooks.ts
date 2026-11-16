import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { trpc } from '@/lib/trpc';
import { formatRelativeTime } from '@/lib/time';
import type { INotificationItemProps } from './NotificationItem.types';

export interface INotificationItemView {
  readonly relativeTime: string;
  readonly handleClick: () => void;
}

export function useNotificationItem(
  notification: INotificationItemProps['notification'],
): INotificationItemView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Callbacks are passed INTO mutationOptions (not spread around it) so the
  // onMutate context type is inferred instead of pinned to undefined.
  const markReadMutation = useMutation(
    trpc.notifications.markRead.mutationOptions({
      // Optimistic: flip this row to read in the cached page and decrement
      // the badge, roll back on error, then reconcile with the server.
      onMutate: async ({ id }) => {
        const queryKey = trpc.notifications.list.queryKey({});
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        if (previous) {
          queryClient.setQueryData(queryKey, {
            items: previous.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
            unreadCount: Math.max(0, previous.unreadCount - 1),
          });
        }
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) {
          queryClient.setQueryData(trpc.notifications.list.queryKey({}), context.previous);
        }
        // The rollback is visible (row flips back to unread) but unexplained
        // without this; there is no global mutations.onError to fall back on.
        toast.error(t('notifications.markOneFailed'));
      },
      onSettled: () => {
        void queryClient.invalidateQueries(trpc.notifications.list.pathFilter());
      },
    }),
  );

  const handleClick = () => {
    if (!notification.read) {
      markReadMutation.mutate({ id: notification.id });
    }
  };

  return {
    relativeTime: formatRelativeTime(new Date(notification.createdAt).getTime()),
    handleClick,
  };
}
