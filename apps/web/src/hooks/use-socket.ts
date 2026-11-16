import { useEffect } from 'react';
import { toast } from '@repo/ui/sonner';
import { SocketEvents } from '@repo/shared/events';
import type { NotificationPayload, ActivityPayload } from '@repo/shared/events';
import { NOTIFICATION_LIST_DEFAULT_LIMIT } from '@repo/shared/constants';
import type { NotificationItemOutput } from '@repo/shared/schemas';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { i18n } from '@/lib/i18n';
import { trpc, queryClient } from '@/lib/trpc';
import { useSocketStore } from '@/stores/socket-store';

/** Consecutive failed connection attempts tolerated before telling the user. */
const MAX_SILENT_CONNECT_FAILURES = 3;

const CONNECTION_LOST_TOAST_ID = 'socket-connection-lost';

/**
 * Merge a live socket notification into the cached `notifications.list` page.
 * The DB row already exists (the dispatch worker persists BEFORE emitting),
 * so this only mirrors it into the cache: prepend as unread, keep the page
 * bounded, bump unreadCount. When the cache is empty/unhydrated there is
 * nothing to merge into; invalidate so the next read hydrates from the API.
 * The socket `timestamp` (epoch ms) maps to the wire `createdAt` ISO string
 * here, at the boundary.
 */
function mergeNotificationIntoCache(payload: NotificationPayload): void {
  const queryKey = trpc.notifications.list.queryKey({});
  const cached = queryClient.getQueryData(queryKey);
  if (!cached) {
    void queryClient.invalidateQueries(trpc.notifications.list.pathFilter());
    return;
  }

  const item: NotificationItemOutput = {
    id: payload.id,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    read: false,
    createdAt: new Date(payload.timestamp).toISOString(),
  };
  // A worker retry can re-emit an already-delivered row: replace instead of
  // duplicating, and only count it as new unread when it was absent.
  const alreadyPresent = cached.items.some((n) => n.id === item.id);
  queryClient.setQueryData(queryKey, {
    items: [item, ...cached.items.filter((n) => n.id !== item.id)].slice(
      0,
      NOTIFICATION_LIST_DEFAULT_LIMIT,
    ),
    unreadCount: alreadyPresent ? cached.unreadCount : cached.unreadCount + 1,
  });
}

/**
 * Manages the Socket.io client lifecycle tied to authentication state.
 * Call once in the top-level authenticated layout.
 */
export function useSocket(isAuthenticated: boolean): void {
  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      useSocketStore.getState().clearAll();
      return;
    }

    const socket = getSocket();
    const { setStatus, addActivity } = useSocketStore.getState();

    setStatus('connecting');

    // Connection loss is otherwise signaled only by the indicator dot: after
    // a few consecutive failed attempts, surface it once with a manual
    // reconnect action. The counter and the once-guard reset on connect.
    let consecutiveFailures = 0;
    let lossToastShown = false;

    // Connection lifecycle events
    const onConnect = () => {
      consecutiveFailures = 0;
      lossToastShown = false;
      toast.dismiss(CONNECTION_LOST_TOAST_ID);
      setStatus('connected');
    };
    const onDisconnect = () => setStatus('disconnected');
    const onConnectError = () => {
      setStatus('disconnected');
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_SILENT_CONNECT_FAILURES && !lossToastShown) {
        lossToastShown = true;
        toast.error(i18n.t('common:connection.lostTitle'), {
          id: CONNECTION_LOST_TOAST_ID,
          // This toast carries the ONLY reconnect affordance in the app: the
          // ConnectionIndicator dot has no action. On sonner's default 4s a
          // keyboard or screen-reader user would have to press alt+T, tab to
          // the action and activate it inside four seconds. It is dismissed
          // programmatically in onConnect, so it never outstays the outage.
          duration: Infinity,
          description: i18n.t('common:connection.lostDescription'),
          action: {
            label: i18n.t('common:connection.reconnect'),
            onClick: () => {
              setStatus('connecting');
              socket.connect();
            },
          },
        });
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    // Socket.io Manager-level reconnection event
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));

    // Application events
    socket.on(SocketEvents.NOTIFICATION, (payload: NotificationPayload) => {
      mergeNotificationIntoCache(payload);
      // Show Sonner toast by notification type
      const toastFn =
        payload.type === 'error'
          ? toast.error
          : payload.type === 'warning'
            ? toast.warning
            : payload.type === 'success'
              ? toast.success
              : toast.info;
      toastFn(payload.title, { description: payload.message });
    });

    socket.on(SocketEvents.ACTIVITY, (payload: ActivityPayload) => {
      addActivity(payload);
    });

    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_attempt');
      socket.off(SocketEvents.NOTIFICATION);
      socket.off(SocketEvents.ACTIVITY);
      disconnectSocket();
      // Only the ephemeral socket state resets here. The notifications query
      // cache is NOT cleared: the data is durable (DB-backed) and logout
      // already runs queryClient.clear() (SidebarUserNav).
      useSocketStore.getState().clearAll();
    };
  }, [isAuthenticated]);
}
