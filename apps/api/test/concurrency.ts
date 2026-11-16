/**
 * Concurrency helpers for specs that have to FORCE an overlap rather than hope
 * for one.
 *
 * A lock, a guard or a uniqueness rule only fails under contention, and a spec
 * that starts two operations one after the other never reaches the window the
 * bug lives in: `membership-lock.isolation.spec.ts` took both locks inside ONE
 * transaction and so could not observe waiting at all. These two primitives
 * make the overlap a fact of the test instead of a timing accident.
 *
 * They live here, next to the fixtures, so the ordinary suite can use them too;
 * `security-spec/harness.ts` re-exports them for the security lane.
 */

/**
 * A meeting point for `parties` callers.
 *
 * Every caller awaits the returned function; none of them proceeds until the
 * last one has arrived. Use it to pin the exact interleaving a case needs (for
 * example "transaction A holds the lock and transaction B has started") instead
 * of sleeping and hoping.
 *
 * Arrivals past `parties` resolve immediately, so a barrier is safe to await in
 * a loop that runs more times than it has parties.
 */
export function barrier(parties: number): () => Promise<void> {
  if (!Number.isInteger(parties) || parties < 1) {
    throw new Error(`barrier(parties) needs a positive integer, got ${String(parties)}`);
  }

  let arrived = 0;
  let open: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });

  return () => {
    arrived += 1;
    if (arrived >= parties) {
      open?.();
    }
    return reached;
  };
}

/**
 * Run `task` `count` times, all released at the same instant, and report every
 * outcome.
 *
 * `Promise.all` over an array of started promises is NOT the same thing: each
 * task there begins as the array is built, so the first one can be several
 * awaits ahead by the time the last starts. Here each task waits on a shared
 * barrier first, so they contend. `allSettled` because the interesting answer
 * is usually "one won and the rest were refused", which `Promise.all` would
 * throw away on the first rejection.
 */
export function raceAll<T>(
  count: number,
  task: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const arrive = barrier(count);

  return Promise.allSettled(
    Array.from({ length: count }, async (_unused, index) => {
      await arrive();
      return task(index);
    }),
  );
}

/**
 * Wait `ms`, for the one thing a barrier cannot express: "the other transaction
 * is now BLOCKED inside Postgres".
 *
 * A barrier can pin that both sides have started; nothing in the client can
 * observe that the far side is waiting on a lock, because a waiting statement
 * produces no event until it is granted. So a contention case parks the holder
 * for long enough that the waiter has certainly reached the lock, then asserts
 * on the ORDER the two sides recorded, which is what actually proves the
 * serialization. Keep it short: it is a floor on the test's runtime.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
