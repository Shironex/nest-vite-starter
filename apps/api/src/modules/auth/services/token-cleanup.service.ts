import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { now } from '../../../common/clock';
import * as Sentry from '@sentry/nestjs';
import { TokenRepository } from '../repositories/token.repository';

/**
 * Reference scheduled maintenance sweep and the `@Cron` convention (every other
 * cron reuses the ScheduleModule registration, none re-registers it).
 *
 * Contract for any cron in this codebase:
 *   - Idempotent by predicate, so it races safely on every replica (@Cron fires
 *     on ALL replicas; a job that must run exactly once across the fleet uses a
 *     BullMQ repeatable instead; see common/queue/CONVENTIONS.md).
 *   - Best-effort: `sweep()` NEVER throws. A failed maintenance tick must not
 *     crash the scheduler or surface anywhere; it logs and returns 0.
 *   - Logs what it removed so the work is observable.
 *
 * Tests call `sweep()` directly; the `@Cron` decorator only schedules once
 * ScheduleModule bootstraps, so it never fires on the test clock.
 */
@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private readonly tokenRepository: TokenRepository) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'token-cleanup' })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /**
   * Delete all expired tokens. Returns the count deleted (0 on failure).
   */
  async sweep(): Promise<number> {
    try {
      const deleted = await this.tokenRepository.deleteExpired(now());
      if (deleted > 0) {
        this.logger.log(`token-cleanup removed ${deleted} expired token(s)`);
      }
      return deleted;
    } catch (error) {
      this.logger.error(
        'token-cleanup sweep failed (will retry next tick)',
        error instanceof Error ? error.stack : String(error),
      );
      Sentry.captureException(error, { tags: { sweep: 'token-cleanup' } });
      return 0;
    }
  }
}
