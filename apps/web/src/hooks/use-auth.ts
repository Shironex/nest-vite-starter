import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

/** How long the current-user profile stays fresh before refetch (5 minutes). */
export const USER_ME_STALE_TIME = 5 * 60 * 1000;

export function useAuth() {
  const { data, isLoading, error } = useQuery({
    ...trpc.user.me.queryOptions(),
    retry: false,
    staleTime: USER_ME_STALE_TIME,
  });

  // The type flows from the user.me output schema (userProfileOutput in
  // @repo/shared) through the generated AppRouter; no local mirror or cast.
  const user = data ?? null;

  return {
    user,
    isAuthenticated: !!data,
    isLoading,
    error,
  };
}
