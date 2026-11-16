import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ActivityPayload } from '@repo/shared/events';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type ActivityItem = ActivityPayload;

const MAX_ACTIVITIES = 20;

/**
 * Ephemeral socket-session state only: connection status plus the live
 * activity ticker. Notifications no longer live here; Postgres is their
 * source of truth and the bell reads them through TanStack Query
 * (`trpc.notifications.list`); `use-socket` merges live NOTIFICATION events
 * into that query cache instead of a store.
 */
interface ISocketState {
  status: ConnectionStatus;
  activities: ActivityItem[];
}

interface ISocketActions {
  setStatus: (status: ConnectionStatus) => void;
  addActivity: (activity: ActivityItem) => void;
  clearAll: () => void;
}

type SocketStore = ISocketState & ISocketActions;

export const useSocketStore = create<SocketStore>()(
  devtools(
    (set) => ({
      status: 'disconnected',
      activities: [],

      setStatus: (status) => set({ status }, undefined, 'socket/setStatus'),

      addActivity: (activity) =>
        set(
          (state) => ({
            activities: [activity, ...state.activities].slice(0, MAX_ACTIVITIES),
          }),
          undefined,
          'socket/addActivity',
        ),

      clearAll: () =>
        set(
          {
            status: 'disconnected',
            activities: [],
          },
          undefined,
          'socket/clearAll',
        ),
    }),
    { name: 'socket' },
  ),
);
