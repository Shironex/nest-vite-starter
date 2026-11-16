import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { USER_ME_STALE_TIME } from '@/hooks/use-auth';

/**
 * The dashboard's reads: who is signed in, and what has happened lately.
 *
 * Every key comes from the tRPC option proxy, never a hand-written array, and
 * every result type flows from the procedure's output schema through the
 * generated `AppRouter`; nothing here is cast or mirrored locally.
 */

/**
 * The authenticated user, for the greeting.
 *
 * retry/staleTime mirror `useAuth`: both observers share the `user.me` cache
 * entry, so diverging options would cause surprise refetches.
 */
export function useDashboardUser() {
  return useQuery({
    ...trpc.user.me.queryOptions(),
    retry: false,
    staleTime: USER_ME_STALE_TIME,
  });
}

/**
 * The signed-in user's notification history, which is what the activity feed
 * renders.
 *
 * THE INPUT MUST STAY `{}`. `use-socket` merges live NOTIFICATION events into
 * `trpc.notifications.list.queryKey({})` specifically, so any other input would
 * address a different cache entry and the feed would stop appending live rows,
 * which is the exact defect this read was added to fix. The bell reads the
 * same entry, so the two never disagree and only one request is made.
 */
export function useRecentNotifications() {
  return useQuery(trpc.notifications.list.queryOptions({}));
}
