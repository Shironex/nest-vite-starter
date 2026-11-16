import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { PrismaService } from '../../common/database/prisma.service';
import { APP_TIME_ZONE, MS_PER_DAY, nowMs } from '../../common/clock';
import * as Sentry from '@sentry/nestjs';
import { AuditService } from '../audit/audit.service';
import { AuditPiiScrubService } from '../audit/audit-pii-scrub.service';
import { errorStack } from '../../common/utils/error';

/**
 * Defensive cap on rows per sweep, mirroring the retention services: a
 * backlog beyond it drains across consecutive daily ticks instead of holding
 * one long-running sweep open.
 */
export const USER_PURGE_MAX_PER_SWEEP = 500;

/**
 * Hard-delete sweep for soft-deleted users: rows whose `deletedAt` is older
 * than USER_PURGE_GRACE_DAYS are erased for good (GDPR Art. 17). The DB layer
 * makes the row delete complete on its own: Token and SecondFactor cascade;
 * AuditLog keeps its rows with `userId` set null.
 *
 * AuditLog rows are KEPT but SCRUBBED (the owner's SCRUB ON PURGE policy): every
 * key in the audit PII registry (AUDIT_PII_FIELDS, @repo/shared/audit) is
 * overwritten with the erased marker in each row the user is the subject or the
 * actor of. That registry is the one `observability/audit-pii-declared` makes
 * every audit write declare against, so a declared field is an erased field.
 *
 * Per-user order matters, and there are two steps: the audit scrub, then the
 * row. A failure at either step skips the row for this sweep. The scrub sits
 * immediately before the row because AuditLog.userId is SetNull: once the row
 * is gone, the rows the user ACTED in can no longer be found by their id, so a
 * scrub after the delete would silently miss them; keeping the row re-arms the
 * sweep to retry next tick.
 *
 * Follows the repo cron contract (see AuditRetentionService):
 *   - Idempotent by predicate (deletedAt < cutoff), so it races safely when
 *     @Cron fires on every replica; the guarded `deleteMany` on the row id
 *     makes the audit side exactly-once across replicas.
 *   - Best-effort: `sweep()` NEVER throws; per-user failures are logged and
 *     deferred, a failed tick logs and returns 0.
 *
 * Uses `prismaService.client` for the User reads and writes: User is not a
 * tenant-scoped model, so the tenant-scope extension passes it through
 * untouched even without a request context, and the lint-guarded `unscoped`
 * escape hatch stays unused.
 */
@Injectable()
export class UserPurgeService {
  private readonly logger = new Logger(UserPurgeService.name);
  private readonly graceDays: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly auditPiiScrub: AuditPiiScrubService,
  ) {
    // `getOrThrow`, not a second default: `USER_PURGE_GRACE_DAYS` carries a Joi
    // `.default(30)` in configuration.config.ts and validation runs before any
    // provider is constructed, so an in-code fallback could never fire and would
    // only be a second place the number lives.
    this.graceDays = this.configService.getOrThrow<number>('USER_PURGE_GRACE_DAYS');
  }

  // 6AM: the 4AM slot is taken by the audit sweep.
  // The hour is wall-clock time in the app time zone (APP_TIME_ZONE).
  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'user-purge', timeZone: APP_TIME_ZONE })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /**
   * Hard-delete soft-deleted users whose grace window has elapsed, one row at
   * a time so a single failure defers only that user to the next
   * sweep. Returns the count purged (0 on failure).
   */
  async sweep(): Promise<number> {
    try {
      const cutoff = new Date(nowMs() - this.graceDays * MS_PER_DAY);
      // Oldest first so a capped sweep always drains the same end of the
      // backlog. `lt` alone never matches NULL; `not: null` documents that
      // live rows are structurally out of scope.
      const expired = await this.prismaService.client.user.findMany({
        where: { deletedAt: { not: null, lt: cutoff } },
        select: { id: true, deletedAt: true },
        orderBy: { deletedAt: 'asc' },
        take: USER_PURGE_MAX_PER_SWEEP,
      });

      let purged = 0;
      for (const row of expired) {
        try {
          // Scrub BEFORE the row delete (SetNull would unlink the actor arm)
          // and let a throw defer the row: an erased user whose audit rows
          // still hold their address is the state this step exists to prevent.
          // Idempotent, so a retry after a later-step failure rewrites nothing.
          const auditRowsScrubbed = await this.auditPiiScrub.scrubUser(row.id);

          // Guarded delete: another replica's overlapping sweep may have
          // purged the row after the findMany; count 0 means nothing to
          // audit here.
          //
          // No `deletedAt` filter, and `sweep` is named in
          // SOFT_DELETE_ALLOW_IN_FUNCTIONS for this call: the purge is the one job whose SUBJECT is the soft-deleted
          // rows. `row.id` came from the `deletedAt: { lte: cutoff }` read
          // above, so this can only ever remove a row that sweep already
          // selected.
          const { count } = await this.prismaService.client.user.deleteMany({
            where: { id: row.id },
          });
          if (count === 0) {
            continue;
          }

          purged += 1;

          // System sweep: no request context, so every field is explicit.
          // userId stays null (the actor is the scheduler, and the FK target
          // row is gone); the pre-purge deletedAt preserves the grace-window
          // evidence for the erasure trail, and auditRowsScrubbed records how
          // many of the user's audit rows this pass anonymized.
          await this.auditService.log({
            action: AUDIT_ACTIONS.USER_ACCOUNT_PURGED,
            userId: null,
            targetType: 'User',
            targetId: row.id,
            metadata: { deletedAt: row.deletedAt?.toISOString() ?? null, auditRowsScrubbed },
          });
        } catch (error) {
          this.logger.error(
            'user-purge failed for a user (deferred to the next sweep)',
            { userId: row.id },
            errorStack(error),
          );
        }
      }

      if (purged > 0) {
        this.logger.log(
          `user-purge hard-deleted ${purged} user(s) soft-deleted more than ${this.graceDays} day(s) ago`,
        );
      }
      return purged;
    } catch (error) {
      this.logger.error('user-purge sweep failed (will retry next tick)', errorStack(error));
      Sentry.captureException(error, { tags: { sweep: 'user-purge' } });
      return 0;
    }
  }
}
