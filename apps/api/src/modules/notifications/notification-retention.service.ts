import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/database/prisma.service';
import { APP_TIME_ZONE, nowMs } from '../../common/clock';
import * as Sentry from '@sentry/nestjs';
import {
  notificationRetentionDeletedTotal,
  cronSweepFailuresTotal,
  cronSweepLastSuccessTimestampSeconds,
} from '../metrics/metrics.registry';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rows removed per round trip. `deleteMany` cannot LIMIT, so each pass first
 * selects a bounded id batch and deletes by primary key, keeping the delete's
 * lock footprint and WAL burst bounded on a large backlog. Same batching as
 * AuditRetentionService.
 */
export const NOTIFICATION_RETENTION_BATCH_SIZE = 5000;

/**
 * Defensive cap per sweep (~1M rows/day at the batch size above). A backlog
 * beyond it drains across consecutive daily ticks instead of holding one
 * long-running sweep open against the table.
 */
export const NOTIFICATION_RETENTION_MAX_BATCHES = 200;

/**
 * Retention sweep for the Notification table: deletes rows older than
 * NOTIFICATION_RETENTION_DAYS regardless of read state: the bell is a
 * recent-items surface, not an archive, and 90 days (the default) is already
 * generous for "you have a notification".
 *
 * Follows the repo cron contract (see TokenCleanupService and
 * AuditRetentionService):
 *   - Idempotent by predicate (createdAt < cutoff), so it races safely when
 *     @Cron fires on every replica.
 *   - Best-effort: `sweep()` NEVER throws; a failed tick logs and returns 0.
 *   - Emits notification_retention_deleted_total so the work is observable.
 *
 * Scheduled at 5AM, one hour after the audit sweep, so the two daily batched
 * deletes never contend for the same maintenance window.
 *
 * Uses `prismaService.client`: Notification is not a tenant-scoped model, so
 * the tenant-scope extension passes it through untouched even without a
 * request context, and the lint-guarded `unscoped` escape hatch stays unused.
 */
@Injectable()
export class NotificationRetentionService {
  private readonly logger = new Logger(NotificationRetentionService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.retentionDays = this.configService.get<number>('NOTIFICATION_RETENTION_DAYS', 90);
  }

  // The hour is wall-clock time in the app time zone (APP_TIME_ZONE).
  @Cron(CronExpression.EVERY_DAY_AT_5AM, {
    name: 'notification-retention',
    timeZone: APP_TIME_ZONE,
  })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /**
   * Delete Notification rows older than the retention cutoff in bounded
   * batches. Returns the total count deleted (0 on failure).
   */
  async sweep(): Promise<number> {
    try {
      const cutoff = new Date(nowMs() - this.retentionDays * DAY_MS);
      let totalDeleted = 0;

      for (let batch = 0; batch < NOTIFICATION_RETENTION_MAX_BATCHES; batch++) {
        // Oldest first so every pass works the same end of the createdAt index.
        const expired = await this.prismaService.client.notification.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: NOTIFICATION_RETENTION_BATCH_SIZE,
        });
        if (expired.length === 0) {
          break;
        }

        const { count } = await this.prismaService.client.notification.deleteMany({
          where: { id: { in: expired.map((row) => row.id) } },
        });
        totalDeleted += count;

        // A short batch means the predicate is drained; skip the extra query.
        if (expired.length < NOTIFICATION_RETENTION_BATCH_SIZE) {
          break;
        }
      }

      if (totalDeleted > 0) {
        notificationRetentionDeletedTotal.inc(totalDeleted);
        this.logger.log(
          `notification-retention removed ${totalDeleted} notification row(s) older than ${this.retentionDays} day(s)`,
        );
      }
      // Liveness, not work: this marks that a tick COMPLETED, which no other
      // signal here can. A sweep that stops being scheduled leaves the deleted
      // counter flat, and a flat counter is also what a quiet day looks like.
      cronSweepLastSuccessTimestampSeconds.set({ sweep: 'notification-retention' }, nowMs() / 1000);
      return totalDeleted;
    } catch (error) {
      this.logger.error(
        'notification-retention sweep failed (will retry next tick)',
        error instanceof Error ? error.stack : String(error),
      );
      cronSweepFailuresTotal.inc({ sweep: 'notification-retention' });
      Sentry.captureException(error, { tags: { sweep: 'notification-retention' } });
      return 0;
    }
  }
}
