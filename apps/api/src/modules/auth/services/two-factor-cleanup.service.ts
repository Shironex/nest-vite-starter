import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { now } from '../../../common/clock';
import { PrismaService } from '../../../common/database/prisma.service';
import { PENDING_ENROLLMENT_EXPIRY_MS } from '../auth.constants';
import { SecondFactorStatus } from '../repositories/second-factor.repository';

/** Label under which this sweep is scheduled and its failures are traced. */
const SWEEP_LABEL = 'two-factor-pending-cleanup';

/**
 * Hourly hygiene sweep for abandoned TOTP enrollments: a PENDING SecondFactor
 * row is created when a user starts enrollment (secret provisioned) but never
 * confirms the first code. `activate()` already rejects a PENDING row older than
 * `PENDING_ENROLLMENT_EXPIRY_MS` (1h), so that is the CORRECTNESS backstop; this
 * sweep is only the cleanup that stops abandoned rows accumulating.
 *
 * Follows the repo `@Cron` contract (see TokenCleanupService):
 *   - Idempotent by predicate (`status = PENDING AND createdAt < cutoff`), so it
 *     races safely when `@Cron` fires on every replica.
 *   - Best-effort: `sweep()` NEVER throws; a failed tick logs, reports to
 *     Sentry, and returns 0 so the scheduler is never crashed by maintenance.
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
        this.logger.log(`two-factor-pending-cleanup removed ${count} stale PENDING factor(s)`);
      }
      return count;
    } catch (error) {
      this.logger.error(
        'two-factor-pending-cleanup sweep failed (will retry next tick)',
        error instanceof Error ? error.stack : String(error),
      );
      Sentry.captureException(error, { tags: { sweep: SWEEP_LABEL } });
      return 0;
    }
  }
}
