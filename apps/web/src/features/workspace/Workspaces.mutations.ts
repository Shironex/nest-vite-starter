import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc, queryClient as sharedQueryClient } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';

/**
 * Add a workspace. ADMIN-only at the router; the UI hides the affordance
 * for everyone else but the server is the boundary that enforces it.
 *
 * Carries an Idempotency-Key: without one, a double-submit races the
 * `@@unique([tenantId, name])` constraint and the second attempt surfaces as an
 * ALREADY_EXISTS error for a Workspace the user did in fact just create.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  const { idempotencyKey, reset } = useIdempotencyKey();

  return useMutation(
    trpc.workspaces.create.mutationOptions({
      trpc: { context: { idempotencyKey } },
      onSuccess: async () => {
        reset();
        await queryClient.invalidateQueries({ queryKey: trpc.workspaces.list.pathKey() });
      },
    }),
  );
}

/**
 * Update a workspace's name or registration data. ADMIN-only at the
 * router, same as create. The Idempotency-Key makes a double-submit or a
 * network retry collapse onto one server-side write (and one audit row).
 */
export function useUpdateWorkspace() {
  const queryClient = useQueryClient();
  const { idempotencyKey, reset } = useIdempotencyKey();

  return useMutation(
    trpc.workspaces.update.mutationOptions({
      trpc: { context: { idempotencyKey } },
      onSuccess: async () => {
        reset();
        await queryClient.invalidateQueries({ queryKey: trpc.workspaces.list.pathKey() });
      },
    }),
  );
}

/** Invalidate the Workspace list from outside React (route loaders, stores). */
export function invalidateWorkspaceList(): Promise<void> {
  return sharedQueryClient.invalidateQueries({ queryKey: trpc.workspaces.list.pathKey() });
}
