import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import { Interval } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE_METRICS_INTERVAL_MS, QUEUE_NAMES } from './queue.constants';
import { InvariantError } from '../errors/invariant-error';

export interface IQueueCounts {
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
  readonly delayed: number;
}

/**
 * Periodically reads job counts for every registered queue and caches the
 * latest counts so the queue health indicator can read failed-depth without a
 * live Redis round-trip on every probe (which would make `/health` flap on a
 * transient Redis blip).
 *
 * EVERY QUEUE MEANS EVERY QUEUE, and the set is read from `QUEUE_NAMES` rather
 * than written out here. A queue missing from this loop sits outside the DLQ
 * alarm, since the health indicator reads `getSnapshots()`, so its failures
 * would go unnoticed until someone asks why a job never ran. Driving off the
 * registry keeps that true: the next queue added to `QUEUE_NAMES` is watched
 * without anyone remembering this file exists.
 *
 * WHY ModuleRef AND NOT @InjectQueue. Constructor injection cannot iterate: a
 * decorator needs the name at authoring time, which is the hand-written list
 * this is replacing. Resolving `getQueueToken(name)` non-strictly also keeps the
 * dependency arrow pointing the right way: with `@InjectQueue`,
 * `QueueObservabilityModule` has to import each feature module that owns a
 * queue, and this file has to import their name constants. Observability
 * legitimately needs a cross-cutting view of every queue; it should not need a
 * dependency edge to each feature that owns one.
 *
 * The scrape is best-effort: a failure must never crash the app. `collect()` is
 * exercised directly in tests; `@Interval` only schedules it once ScheduleModule
 * is bootstrapped, so it never fires on the test clock. Resolution, by contrast,
 * is NOT best-effort: a name in `QUEUE_NAMES` that no module registered is a
 * wiring defect that would silently re-open the same blind spot, so it fails the
 * boot instead.
 */
@Injectable()
export class QueueMetricsService implements OnModuleInit {
  private readonly logger = new Logger(QueueMetricsService.name);
  private readonly snapshots = new Map<string, IQueueCounts>();
  private readonly queues: Queue[] = [];

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    for (const name of Object.values(QUEUE_NAMES)) {
      try {
        // `strict: false` searches the whole application container rather than
        // this module's own injector, which is what lets the observability layer
        // see queues owned by feature modules without importing them.
        this.queues.push(this.moduleRef.get<Queue>(getQueueToken(name), { strict: false }));
      } catch (error) {
        throw new InvariantError(
          `Queue "${name}" is declared in QUEUE_NAMES but no module registered it, so it would sit outside the DLQ alarm. Add registerQueueWithDefaults(name, defaults) in the module that owns it.`,
          { cause: error },
        );
      }
    }
  }

  @Interval(QUEUE_METRICS_INTERVAL_MS)
  async collect(): Promise<void> {
    for (const queue of this.queues) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
        const snapshot: IQueueCounts = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        };
        this.snapshots.set(queue.name, snapshot);
      } catch (error) {
        // A count scrape must never take the app down.
        this.logger.warn(
          'Failed to collect job counts for queue',
          { queue: queue.name },
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /** Latest cached counts for a queue, or undefined before the first scrape. */
  getSnapshot(queueName: string): IQueueCounts | undefined {
    return this.snapshots.get(queueName);
  }

  /** All cached snapshots, keyed by queue name. */
  getSnapshots(): ReadonlyMap<string, IQueueCounts> {
    return this.snapshots;
  }
}
