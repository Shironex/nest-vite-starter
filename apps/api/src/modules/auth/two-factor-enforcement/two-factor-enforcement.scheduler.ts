import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { APP_TIME_ZONE } from '../../../common/clock';
import { removeStaleJobSchedulers, withJobContext } from '../../../common/queue';
import {
  TWO_FACTOR_ENFORCEMENT_CRON,
  TWO_FACTOR_ENFORCEMENT_JOB_NAMES,
  TWO_FACTOR_ENFORCEMENT_QUEUE_NAME,
  TWO_FACTOR_ENFORCEMENT_SCHEDULER_ID,
} from './two-factor-enforcement.constants';

/**
 * Producer side of the two-factor-enforcement queue: on module init it registers
 * the single DAILY job scheduler that drives the sweep. This is the first
 * fleet-wide BullMQ schedule in the codebase; everything periodic before it
 * used `@Cron` (which fires on every replica). The sweep uses a job scheduler so
 * the enforcement fan-out (session revocation + reminder emails) runs exactly
 * once across the fleet per tick; it is still idempotent by predicate as a
 * backstop.
 *
 * `upsertJobScheduler` keys the schedule on its id, so re-registering the
 * identical spec on every boot, on every replica, updates the one scheduler
 * instead of stacking duplicates. Any other scheduler still producing the sweep
 * (the pre-BullMQ-6 legacy repeatable) is removed right after, so the sweep
 * never fires twice per tick.
 */
@Injectable()
export class TwoFactorEnforcementScheduler implements OnModuleInit {
  private readonly logger = new Logger(TwoFactorEnforcementScheduler.name);

  constructor(
    @InjectQueue(TWO_FACTOR_ENFORCEMENT_QUEUE_NAME)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // withJobContext wraps the (empty) payload so the worker re-enters an
    // ALS/trace context even though the scheduler runs outside any request.
    // `tz` makes the pattern's hour wall-clock time in the app time zone.
    await this.queue.upsertJobScheduler(
      TWO_FACTOR_ENFORCEMENT_SCHEDULER_ID,
      { pattern: TWO_FACTOR_ENFORCEMENT_CRON, tz: APP_TIME_ZONE },
      { name: TWO_FACTOR_ENFORCEMENT_JOB_NAMES.SWEEP, data: withJobContext({}) },
    );
    const staleRemoved = await removeStaleJobSchedulers(
      this.queue,
      [TWO_FACTOR_ENFORCEMENT_JOB_NAMES.SWEEP],
      [TWO_FACTOR_ENFORCEMENT_SCHEDULER_ID],
    );
    this.logger.log(
      `Registered daily two-factor-enforcement sweep (pattern="${TWO_FACTOR_ENFORCEMENT_CRON}", staleRemoved=${staleRemoved})`,
    );
  }
}
