import { useEffect } from 'react';
import { toast } from '@repo/ui/sonner';
import { SocketEvents } from '@repo/shared/events';
import type { ActivityPayload } from '@repo/shared/events';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { i18n } from '@/lib/i18n';
import { useSocketStore } from '@/stores/socket-store';

/** Consecutive failed connection attempts tolerated before telling the user. */
const MAX_SILENT_CONNECT_FAILURES = 3;

const CONNECTION_LOST_TOAST_ID = 'socket-connection-lost';

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
    socket.on(SocketEvents.ACTIVITY, (payload: ActivityPayload) => {
      addActivity(payload);
    });

    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_attempt');
      socket.off(SocketEvents.ACTIVITY);
      disconnectSocket();
      useSocketStore.getState().clearAll();
    };
  }, [isAuthenticated]);
}
