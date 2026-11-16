import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { STAFF_INVITE_TOKEN_TTL_MS } from '@repo/shared/constants';
import { APP_TIME_ZONE, MS_PER_DAY, now, nowMs } from '../../common/clock';
import { PrismaService } from '../../common/database/prisma.service';
import {
  cronSweepFailuresTotal,
  cronSweepLastSuccessTimestampSeconds,
} from '../metrics/metrics.registry';
import { AuditService } from '../audit/audit.service';
import { errorStack } from '../../common/utils/error';

/**
 * How long a never-accepted invitation is kept after its last link died.
 *
 * The same 30 days the soft-delete purge grace uses, and for the same reason:
 * long enough that "resend it" is still the answer to a person who says they
 * lost the mail, short enough that an abandoned invitation does not hold a
 * globally unique email address forever.
 */
export const EXPIRED_INVITE_GRACE_DAYS = 30;

/**
 * The floor on how old a pending row must be before it is even considered.
 *
 * `createPendingMember` and the first token mint are two transactions, so a
 * crash between them leaves a pending row with no token at all, which is
 * indistinguishable from "the token expired and the hourly cleanup took it".
 * Requiring the row to have outlived a full invite TTL plus the grace window
 * means the sweep can never reach an invitation that is still live, or one
 * minted seconds ago whose token row has not committed yet.
 */
const PENDING_ROW_MIN_AGE_MS = STAFF_INVITE_TOKEN_TTL_MS + EXPIRED_INVITE_GRACE_DAYS * MS_PER_DAY;

/** Defensive cap per tick, mirroring the user-purge sweep. */
export const EXPIRED_INVITE_MAX_PER_SWEEP = 500;

const INVITE_TOKEN_TYPES = ['STAFF_INVITE'] as const;

/**
 * Erase invitations nobody ever accepted.
 *
 * WHY IT EXISTS. A pending invitee is a real User row with `passwordHash: null`
 * and `emailVerified: false`, and nothing ever removed it. The invitation link
 * dies after 7 days and the hourly token cleanup deletes the token an hour
 * later, at which point the row is an orphan account that holds a globally
 * unique email address forever unless an admin happens to find it and withdraw
 * it by hand. That address is then un-invitable and un-registrable, in this
 * organization and every other, for an invitation nobody ever took up.
 *
 * WHY THE PREDICATE IS ROW-INTRINSIC. It cannot key on the token, because the
 * token is exactly what the hourly cleanup deletes: keying on it would make the
 * sweep fire the moment the link expired, seven days early, and never fire on a
 * row whose token was already collected. So the row's own age carries the
 * horizon and the token clause only ever DEFERS: any invite token that expired
 * within the grace window, or has not expired at all, keeps the row. A re-invite
 * mints a fresh token and therefore pushes the deletion out by a full grace
 * window, which is the behavior a person clicking "invite again" expects.
 *
 * WHY A HARD DELETE IS SAFE. The same reason `deletePendingMember` gives for the
 * deliberate withdrawal: an account that never had a password was never an actor
 * on anything, so there is no trail on the row worth preserving. The audit row
 * written here is the surviving record that the invitation existed.
 *
 * WHY OAUTH ACCOUNTS ARE EXCLUDED. They are the other account with no password.
 * A provider vouched for the address, so they carry `emailVerified: true` and an
 * OAuthAccount row, and both are checked rather than either alone.
 *
 * Follows the repo cron contract (see UserPurgeService):
 *   - Idempotent by predicate, so it races safely when @Cron fires on every
 *     replica; the guarded per-row `deleteMany` makes the audit side
 *     exactly-once across replicas.
 *   - Best-effort: `sweep()` NEVER throws; per-row failures are counted and
 *     deferred, a failed tick logs and returns 0.
 *   - Emits the shared per-sweep failure counter and liveness gauge, so a sweep
 *     that stops being scheduled is distinguishable from a quiet week.
 *
 * Uses `prismaService.client` throughout: `User`, `Token` and `OAuthAccount` are
 * all outside TENANT_SCOPED_MODELS, so the extension passes them through
 * untouched without a request context and the lint-guarded `unscoped` escape
 * hatch stays unused. The `tenantId` on each row travels to the audit entry
 * instead, so the trail lands in the organization the invitation was sent from.
 */
@Injectable()
export class ExpiredInviteSweepService {
  private readonly logger = new Logger(ExpiredInviteSweepService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // 07:00: the 04:00, 05:00 and 06:00 slots are taken by the audit,
  // notification and user-purge sweeps.
  // The hour is wall-clock time in the app time zone (APP_TIME_ZONE).
  @Cron(CronExpression.EVERY_DAY_AT_7AM, { name: 'expired-invite-sweep', timeZone: APP_TIME_ZONE })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /** Hard-delete abandoned invitations. Returns the count deleted (0 on failure). */
  async sweep(): Promise<number> {
    try {
      const at = now();
      const graceCutoff = new Date(at.getTime() - EXPIRED_INVITE_GRACE_DAYS * MS_PER_DAY);
      const ageCutoff = new Date(nowMs() - PENDING_ROW_MIN_AGE_MS);

      const abandoned = await this.prismaService.client.user.findMany({
        where: {
          // The `deletePendingMember` predicate: never a member, never an actor.
          passwordHash: null,
          emailVerified: false,
          deletedAt: null,
          // Belt to the emailVerified brace: an account a provider vouched for
          // was never an unaccepted invitation.
          oauthAccounts: { none: {} },
          createdAt: { lt: ageCutoff },
          // The only clause the token takes part in, and it can only DEFER.
          // A live token has `expiresAt` in the future, so it is > graceCutoff
          // too, and a re-invite therefore buys another full grace window.
          tokens: {
            none: { type: { in: [...INVITE_TOKEN_TYPES] }, expiresAt: { gt: graceCutoff } },
          },
        },
        select: { id: true, role: true, tenantId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: EXPIRED_INVITE_MAX_PER_SWEEP,
      });

      let deleted = 0;
      for (const row of abandoned) {
        try {
          // Guarded delete: the predicate is repeated so a row that accepted
          // its invitation between the read and this write is left alone, and
          // so an overlapping sweep on another replica gets `count: 0` and does
          // not write a second audit row.
          const { count } = await this.prismaService.client.user.deleteMany({
            where: { id: row.id, passwordHash: null, emailVerified: false, deletedAt: null },
          });
          if (count === 0) {
            continue;
          }
          deleted += 1;

          // System sweep: no request context, so every field is explicit.
          // `userId` stays null (the actor is the scheduler and the target row
          // is gone); `tenantId` is the invitation's own organization, so the row does
          // not follow whoever reads the log next.
          await this.auditService.log({
            action: AUDIT_ACTIONS.STAFF_INVITE_EXPIRED,
            userId: null,
            tenantId: row.tenantId,
            targetType: 'User',
            targetId: row.id,
            // The role and the age, never the address: the invitee's address is
            // their own PII and the target row that carried it is gone.
            metadata: { role: row.role, invitedAt: row.createdAt.toISOString() },
          });
        } catch (error) {
          // Deferred, not lost: the row still matches the predicate next tick.
          this.logger.error(
            'expired-invite-sweep failed for a user (deferred to the next sweep)',
            { userId: row.id },
            errorStack(error),
          );
        }
      }

      if (deleted > 0) {
        this.logger.log(
          `expired-invite-sweep removed ${String(deleted)} invitation(s) that were never accepted and whose last link expired more than ${String(EXPIRED_INVITE_GRACE_DAYS)} day(s) ago`,
        );
      }
      // Liveness, not work: this marks that a tick COMPLETED, which no other
      // signal here can. A sweep that stops being scheduled leaves the counter
      // flat, and a flat counter is also what a quiet week looks like.
      cronSweepLastSuccessTimestampSeconds.set({ sweep: 'expired-invite-sweep' }, nowMs() / 1000);
      return deleted;
    } catch (error) {
      this.logger.error('expired-invite-sweep failed (will retry next tick)', errorStack(error));
      cronSweepFailuresTotal.inc({ sweep: 'expired-invite-sweep' });
      Sentry.captureException(error, { tags: { sweep: 'expired-invite-sweep' } });
      return 0;
    }
  }
}
