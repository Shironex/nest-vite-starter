import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';

/**
 * Record how one tour ended.
 *
 * Called from an effect (the auto-start path) as well as from a click, so the
 * handlers live on `useMutation` rather than on the call site: a per-call
 * `onSuccess` is only delivered while the issuing observer still has listeners,
 * and a tour that finishes across a route change would lose its own
 * invalidation. That is what `repo/effect-fired-mutation-must-bind-callbacks`
 * exists to stop.
 *
 * A failed save is deliberately silent. The user finished a tour; telling them
 * the bookkeeping failed helps nobody, and the only consequence is that the
 * tour is offered once more.
 *
 * `help.progressSave` carries IdempotencyMiddleware because the first save of a
 * user's life is a row CREATE, so this hook mints the key that middleware needs
 * and resets it on success: without one the middleware sees no header and does
 * nothing at all. A second tour ending in the same mount therefore gets a fresh
 * key, and a retry of the same one collapses onto the first record.
 */
export function useSaveTourProgress() {
  const queryClient = useQueryClient();
  const { idempotencyKey, reset } = useIdempotencyKey();

  return useMutation(
    trpc.help.progressSave.mutationOptions({
      trpc: { context: { idempotencyKey } },
      onSuccess: reset,
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.help.progressGet.pathKey() });
      },
    }),
  );
}

/** Forget every tour, so all of them are offered again. */
export function useResetTourProgress() {
  const queryClient = useQueryClient();
  return useMutation(
    trpc.help.progressResetAll.mutationOptions({
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.help.progressGet.pathKey() });
      },
    }),
  );
}
