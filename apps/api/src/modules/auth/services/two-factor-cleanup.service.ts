import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { now, nowMs } from '../../../common/clock';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  cronSweepFailuresTotal,
  cronSweepLastSuccessTimestampSeconds,
  twoFactorPendingCleanupDeletedTotal,
} from '../../metrics/metrics.registry';
import { PENDING_ENROLLMENT_EXPIRY_MS } from '../auth.constants';
import { SecondFactorStatus } from '../repositories/second-factor.repository';

/** Label under which this sweep's failures are counted / traced. */
const SWEEP_LABEL = 'two-factor-pending-cleanup';

/**
 * Hourly hygiene sweep for abandoned TOTP enrollments: a PENDING SecondFactor
 * row is created when a user starts enrollment (secret provisioned) but never
 * confirms the first code. `activate()` already rejects a PENDING row older than
 * `PENDING_ENROLLMENT_EXPIRY_MS` (1h), so that is the CORRECTNESS backstop; this
 * sweep is only the cleanup that stops abandoned rows accumulating.
 *
 * Uses `prismaService.client`: SecondFactor is USER-scoped credential data,
 * deliberately absent from TENANT_SCOPED_MODELS, so the tenant-scope extension
 * passes its queries through untouched even without a request context, so no
 * `unscoped` escape hatch needed (mirrors UserPurgeService on the non-scoped
 * User model).
 *
 * Follows the repo `@Cron` contract (see TokenCleanupService):
 *   - Idempotent by predicate (`status = PENDING AND createdAt < cutoff`), so it
 *     races safely when `@Cron` fires on every replica.
 *   - Best-effort: `sweep()` NEVER throws; a failed tick logs, counts, and
 *     returns 0 so the scheduler is never crashed by maintenance.
 *   - Emits `two_factor_pending_cleanup_deleted_total` (and, on failure,
 *     `cron_sweep_failures_total{sweep}`) so the work is observable.
 */
@Injectable()
export class TwoFactorCleanupService {
  private readonly logger = new Logger(TwoFactorCleanupService.name);

  constructor(private readonly prismaService: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: SWEEP_LABEL })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /**
   * Delete PENDING enrollment rows past the 1-hour activation window. Returns
   * the count deleted (0 on failure).
   */
  async sweep(): Promise<number> {
    try {
      const cutoff = new Date(now().getTime() - PENDING_ENROLLMENT_EXPIRY_MS);
      const { count } = await this.prismaService.client.secondFactor.deleteMany({
        where: { status: SecondFactorStatus.PENDING, createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        twoFactorPendingCleanupDeletedTotal.inc(count);
        this.logger.log(`two-factor-pending-cleanup removed ${count} stale PENDING factor(s)`);
      }
      // Liveness, not work: this marks that a tick COMPLETED, which no other
      // signal here can. A sweep that stops being scheduled leaves the deleted
      // counter flat, and a flat counter is also what a quiet day looks like.
      cronSweepLastSuccessTimestampSeconds.set({ sweep: SWEEP_LABEL }, nowMs() / 1000);
      return count;
    } catch (error) {
      this.logger.error(
        'two-factor-pending-cleanup sweep failed (will retry next tick)',
        error instanceof Error ? error.stack : String(error),
      );
      cronSweepFailuresTotal.inc({ sweep: SWEEP_LABEL });
      Sentry.captureException(error, { tags: { sweep: SWEEP_LABEL } });
      return 0;
    }
  }
}
