import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';

/**
 * The caller's workspaces.
 *
 * Lives in the `workspace` platform feature, which every domain feature may import
 * (it is listed next to `shared` in `no-cross-feature-imports`): the Workspaces
 * screen and every domain screen that filters or files by workspace read it, and
 * Workspace is the tenancy tier rather than any one of those domains.
 *
 * The list is unpaginated and changes rarely (an organization's workspace list is
 * tens of rows and only an ADMIN adds to it), so it is cached long and refetched on
 * invalidation after a create rather than polled.
 */
export const WORKSPACES_STALE_TIME = 10 * 60 * 1000;

export function useWorkspaceList() {
  return useQuery({
    ...trpc.workspaces.list.queryOptions(),
    staleTime: WORKSPACES_STALE_TIME,
  });
}
