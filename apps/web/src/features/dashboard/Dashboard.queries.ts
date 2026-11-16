import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { USER_ME_STALE_TIME } from '@/hooks/use-auth';

/**
 * The dashboard's read: who is signed in.
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
