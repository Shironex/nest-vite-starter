import type { Queue } from 'bullmq';

/**
 * Removes every job scheduler on `queue` that produces one of `jobNames` under
 * an id other than those in `keepIds`, and returns how many it removed.
 *
 * Call it right after upserting the canonical schedulers. It catches the
 * entries a producer left behind under an old id, above all the legacy
 * repeatables that `queue.add(name, data, { repeat })` registered before
 * BullMQ 6: BullMQ 5 keys those by an md5 hash, BullMQ 6 does not recognize that
 * key as legacy and reads it as a live scheduler, so without this every sweep
 * would fire twice per tick, forever. Removing a scheduler also removes its
 * pending delayed tick.
 */
export async function removeStaleJobSchedulers(
  queue: Pick<Queue, 'getJobSchedulers' | 'removeJobScheduler'>,
  jobNames: readonly string[],
  keepIds: readonly string[],
): Promise<number> {
  const schedulers = await queue.getJobSchedulers();
  const stale = schedulers.filter(
    (scheduler) => jobNames.includes(scheduler.name) && !keepIds.includes(scheduler.key),
  );
  for (const scheduler of stale) {
    await queue.removeJobScheduler(scheduler.key);
  }
  return stale.length;
}
