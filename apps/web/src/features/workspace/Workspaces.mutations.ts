import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc, queryClient as sharedQueryClient } from '@/lib/trpc';

/**
 * Add a workspace. ADMIN-only at the router; the UI hides the affordance
 * for everyone else but the server is the boundary that enforces it.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.workspaces.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.workspaces.list.pathKey() });
      },
    }),
  );
}

/**
 * Update a workspace's name or registration data. ADMIN-only at the
 * router, same as create.
 */
export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation(
    trpc.workspaces.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.workspaces.list.pathKey() });
      },
    }),
  );
}

/** Invalidate the Workspace list from outside React (route loaders, stores). */
export function invalidateWorkspaceList(): Promise<void> {
  return sharedQueryClient.invalidateQueries({ queryKey: trpc.workspaces.list.pathKey() });
}
