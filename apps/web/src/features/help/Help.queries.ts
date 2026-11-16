import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

/**
 * The caller's guided-tour progress: which tours they have already been shown.
 *
 * One read for the whole app. It backs the auto-start decision in the topbar
 * launcher and the status column in the settings list, and both mount inside
 * the authenticated shell, so TanStack Query serves the second from the cache
 * the first filled.
 */
export function useTourProgress() {
  return useQuery(trpc.help.progressGet.queryOptions());
}
