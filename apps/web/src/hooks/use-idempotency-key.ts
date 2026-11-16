import { useCallback, useState } from 'react';

/**
 * A stable Idempotency-Key for one user action.
 *
 * The api caches a successful mutation response for 24h against
 * `sha256(key + body)` scoped to the user, tenant and procedure path
 * (`apps/api/src/common/idempotency/idempotency.middleware.ts`). That only
 * dedupes anything if the SAME key comes back on a retry, which rules out
 * generating one inside the transport layer: a link runs again on every retry
 * and would mint a fresh key each time, so the second submit would be accepted
 * as new work.
 *
 * So the key is owned by the mutation hook instead. It is passed to tRPC
 * through `mutationOptions({ trpc: { context: { idempotencyKey } } })`, the
 * only supported way to reach the links, since TanStack's per-call
 * `mutate(vars, opts)` has no passthrough for it. That means the key must be a
 * render-visible value rather than a ref: `reset()` has to re-render so the
 * NEXT `mutationOptions(...)` carries a fresh key.
 *
 *   const { idempotencyKey, reset } = useIdempotencyKey();
 *   useMutation(trpc.x.create.mutationOptions({
 *     trpc: { context: { idempotencyKey } },
 *     onSuccess: reset,
 *   }));
 *
 * The key stays put for the lifetime of the component until `reset()`, which is
 * what makes a double-click, a network retry and a user-initiated "try again"
 * after a 500 all collapse onto one server-side record, while a genuinely new
 * submission (after a success) gets a new one.
 */
export interface IIdempotencyKey {
  /** The current key. Stable until `reset()`. */
  readonly idempotencyKey: string;
  /** Start a new logical action. Wire to a mutation's `onSuccess`. */
  readonly reset: () => void;
}

/**
 * `crypto.randomUUID` is impure, so it is called from a state initializer and
 * from an event handler, never bare in render, which `react-hooks/purity`
 * rejects and which would mint a new key on every re-render anyway.
 */
export function useIdempotencyKey(): IIdempotencyKey {
  const [idempotencyKey, setKey] = useState<string>(() => crypto.randomUUID());

  const reset = useCallback(() => {
    setKey(crypto.randomUUID());
  }, []);

  return { idempotencyKey, reset };
}
