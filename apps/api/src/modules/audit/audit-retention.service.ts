import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { PrismaService } from '../../common/database/prisma.service';
import { APP_TIME_ZONE, nowMs } from '../../common/clock';
import * as Sentry from '@sentry/nestjs';
import {
  auditRetentionDeletedTotal,
  cronSweepFailuresTotal,
  cronSweepLastSuccessTimestampSeconds,
} from '../metrics/metrics.registry';
import { AuditService } from './audit.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rows removed per round trip. `deleteMany` cannot LIMIT, so each pass first
 * selects a bounded id batch and deletes by primary key, keeping the delete's
 * lock footprint and WAL burst bounded on a large backlog.
 */
export const AUDIT_RETENTION_BATCH_SIZE = 5000;

/**
 * Defensive cap per sweep (~1M rows/day at the batch size above). A backlog
 * beyond it drains across consecutive daily ticks instead of holding one
 * long-running sweep open against the table.
 */
export const AUDIT_RETENTION_MAX_BATCHES = 200;

/**
 * Retention sweep for the append-only AuditLog table: deletes rows older than
 * AUDIT_LOG_RETENTION_DAYS (GDPR storage limitation). This cron is the ONLY
 * sanctioned delete path for AuditLog rows; everything else treats the table
 * as immutable (see the model doc in packages/database/prisma/schema.prisma).
 * Records with a statutory retention period belong in their own store with
 * their own retention, not in this table.
 *
 * Follows the repo cron contract (see TokenCleanupService):
 *   - Idempotent by predicate (createdAt < cutoff), so it races safely when
 *     @Cron fires on every replica.
 *   - Best-effort: `sweep()` NEVER throws; a failed tick logs and returns 0.
 *   - Emits audit_retention_deleted_total so the work is observable.
 *
 * AND leaves its own row. Metrics are the wrong medium for the question this
 * sweep raises at an inspection: `audit_retention_deleted_total` resets on every
 * restart, and a log line naming the retention DAY COUNT only implies the rule,
 * so "which rows went, on what date, under which cutoff" has nothing durable
 * behind it. One `audit.retention.sweep` row per run carries that, written AFTER
 * the deletes so the pass cannot erase its own evidence: the row's createdAt is
 * necessarily newer than the cutoff that chose the rows, so it survives until a
 * sweep a full retention period later, by which time it has done its job.
 *
 * Uses `prismaService.client`: AuditLog is not a tenant-scoped model, so the
 * tenant-scope extension passes it through untouched even without a request
 * context, and the lint-guarded `unscoped` escape hatch stays unused.
 */
@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {
    this.retentionDays = this.configService.get<number>('AUDIT_LOG_RETENTION_DAYS', 365);
  }

  // The hour is wall-clock time in the app time zone (APP_TIME_ZONE).
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'audit-log-retention', timeZone: APP_TIME_ZONE })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /**
   * Delete AuditLog rows older than the retention cutoff in bounded batches.
   * Returns the total count deleted (0 on failure).
   */
  async sweep(): Promise<number> {
    try {
      const cutoff = new Date(nowMs() - this.retentionDays * DAY_MS);
      let totalDeleted = 0;

      for (let batch = 0; batch < AUDIT_RETENTION_MAX_BATCHES; batch++) {
        // Oldest first so every pass works the same end of the createdAt index.
        const expired = await this.prismaService.client.auditLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: AUDIT_RETENTION_BATCH_SIZE,
        });
        if (expired.length === 0) {
          break;
        }

        const { count } = await this.prismaService.client.auditLog.deleteMany({
          where: { id: { in: expired.map((row) => row.id) } },
        });
        totalDeleted += count;

        // A short batch means the predicate is drained; skip the extra query.
        if (expired.length < AUDIT_RETENTION_BATCH_SIZE) {
          break;
        }
      }

      if (totalDeleted > 0) {
        auditRetentionDeletedTotal.inc(totalDeleted);
      }
      // Logged on EVERY tick, deletions or not, and naming the cutoff INSTANT
      // rather than the day count: "older than 365 days" is a rule, and the
      // question after the fact is which rows the rule actually selected.
      this.logger.log(
        `audit-log-retention removed ${totalDeleted} audit row(s) created before ${cutoff.toISOString()} (retention ${this.retentionDays} day(s))`,
      );

      // System sweep: no request context, so every field is explicit and the
      // actor stays null (the scheduler, not a person). Written after the
      // deletes; see the class docblock for why the ordering is the point.
      // `log` rather than `logOrThrow`: a lost row must not turn a completed
      // retention pass into a failed one that then retries the whole delete.
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUDIT_RETENTION_SWEEP,
        userId: null,
        tenantId: null,
        workspaceId: null,
        targetType: 'AuditLog',
        metadata: {
          cutoff: cutoff.toISOString(),
          retentionDays: this.retentionDays,
          deleted: totalDeleted,
        },
      });

      cronSweepLastSuccessTimestampSeconds.set({ sweep: 'audit-retention' }, nowMs() / 1000);
      return totalDeleted;
    } catch (error) {
      this.logger.error(
        'audit-log-retention sweep failed (will retry next tick)',
        error instanceof Error ? error.stack : String(error),
      );
      // Compliance path: without Sentry + a counter a daily failure here has
      // no alertable signal and can run broken for months.
      cronSweepFailuresTotal.inc({ sweep: 'audit-retention' });
      Sentry.captureException(error, { tags: { sweep: 'audit-retention' } });
      return 0;
    }
  }
}
