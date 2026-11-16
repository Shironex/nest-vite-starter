import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import type Redis from 'ioredis';
import * as Sentry from '@sentry/nestjs';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { TracedWorkerHost } from '../../../common/queue/traced-worker.host';
import { parseJobData } from '../../../common/queue/job-payload';
import { now } from '../../../common/clock';
import { PrismaService } from '../../../common/database/prisma.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { cronSweepFailuresTotal, twoFactorEnforcedTotal } from '../../metrics/metrics.registry';
import { TWO_FACTOR_ENFORCED_MARKER_TTL_SECONDS } from '../auth.constants';
import { SecondFactorStatus, SecondFactorType } from '../repositories/second-factor.repository';
import { TrustedDeviceService } from '../services/trusted-device.service';
import {
  TWO_FACTOR_ENFORCEMENT_DEFAULTS,
  TWO_FACTOR_ENFORCEMENT_JOB_NAMES,
  TWO_FACTOR_ENFORCEMENT_QUEUE_NAME,
  TWO_FACTOR_ENFORCEMENT_REMINDER_WINDOW_MS,
} from './two-factor-enforcement.constants';
import { twoFactorEnforcementJobSchema } from './two-factor-enforcement.schemas';

/** Label under which this sweep's failures are counted / traced. */
const SWEEP_LABEL = 'two-factor-enforcement';

/**
 * Consumer for the daily two-factor-enforcement sweep (SPEC 6.4, T07). It runs
 * OUTSIDE any tenant ALS context (the scheduler enqueues it with no tenant),
 * so every read and comparison here goes through `prismaService.unscoped`, the
 * cross-tenant escape hatch (allowlisted in
 * `no-unscoped-prisma-outside-allowlist`). Two idempotent passes:
 *
 *   1. DEADLINE SWEEP: for every tenant whose `required` policy grace has
 *      already passed, force each still-non-enrolled member fully out
 *      (`revokeAllAndDisconnect` + `revokeAll` trusted devices) and audit
 *      `AUTH_2FA_ENFORCED`, at most once per grace window via a per-(member,
 *      graceEndsAt) Redis marker. This closes the hole where a 30-day
 *      remember-me session outlives the 7-day grace.
 *   2. T-24h REMINDERS: for every tenant whose grace ends within the next 24h,
 *      enqueue one reminder email per non-enrolled member. The email producer
 *      derives a deterministic jobId from (recipient + deadline), so a doubled
 *      tick collapses to one reminder.
 *
 * The top-level handler NEVER throws out of the sweep: a transient failure is
 * logged, counted on `cron_sweep_failures_total{sweep}`, tagged in Sentry, and
 * left for the next daily tick (BullMQ in-tick retry is disabled via
 * `attempts: 1`, so it cannot re-scan the same tenants mid-run).
 */
@Processor(TWO_FACTOR_ENFORCEMENT_QUEUE_NAME, {
  concurrency: TWO_FACTOR_ENFORCEMENT_DEFAULTS.concurrency,
})
export class TwoFactorEnforcementProcessor extends TracedWorkerHost {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly trustedDeviceService: TrustedDeviceService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case TWO_FACTOR_ENFORCEMENT_JOB_NAMES.SWEEP: {
        // Validates the (empty) payload through the same seam as every other
        // queue: a corrupted/legacy job body fails cleanly instead of running.
        parseJobData(twoFactorEnforcementJobSchema, job);
        await this.runSweep();
        return;
      }
      default:
        // Retrying an unknown name can never succeed: fail straight to the DLQ.
        throw new UnrecoverableError(`Unknown two-factor-enforcement job name: ${job.name}`);
    }
  }

  /** Best-effort orchestration: catches everything so a bad tick never retries. */
  private async runSweep(): Promise<void> {
    const asOf = now();
    try {
      const enforced = await this.enforceExpiredDeadlines(asOf);
      const reminded = await this.sendUpcomingReminders(asOf);
      if (enforced > 0 || reminded > 0) {
        this.logger.log(
          `two-factor-enforcement swept: ${enforced} member(s) enforced, ${reminded} reminder(s) sent`,
        );
      }
    } catch (error) {
      this.logger.error(
        'two-factor-enforcement sweep failed (will retry next tick)',
        error instanceof Error ? error.stack : String(error),
      );
      cronSweepFailuresTotal.inc({ sweep: SWEEP_LABEL });
      Sentry.captureException(error, { tags: { sweep: SWEEP_LABEL } });
    }
  }

  /**
   * Pass 1: tenants whose grace deadline has already passed. Each still-non-enrolled
   * member is forced out at most once per grace window: a per-(member, graceEndsAt)
   * Redis marker is claimed atomically before the revoke, so a member who ignores
   * enforcement is not re-revoked (nor re-audited or re-counted) on later ticks,
   * while a policy re-enable mints a fresh graceEndsAt whose new key re-enforces.
   * Returns the number of members enforced this run.
   */
  private async enforceExpiredDeadlines(asOf: Date): Promise<number> {
    const expiredPolicies = await this.prismaService.unscoped.twoFactorPolicy.findMany({
      where: { required: true, graceEndsAt: { lt: asOf } },
      select: { tenantId: true, graceEndsAt: true },
    });

    let enforced = 0;
    for (const policy of expiredPolicies) {
      const graceEndsAt = policy.graceEndsAt;
      // The `lt` predicate already excludes null graceEndsAt, but the column is
      // nullable so narrow it before keying the idempotency marker.
      if (!graceEndsAt) {
        continue;
      }
      const members = await this.findNonEnrolledMembers(policy.tenantId);
      for (const member of members) {
        // Claim the per-(member, grace-window) marker first: a null reply means the
        // key already existed, so this member was enforced on an earlier tick and
        // must not be revoked / audited / counted again this window.
        const claimed = await this.redis.set(
          RedisKeys.twoFactorEnforced(member.id, graceEndsAt.getTime()),
          '1',
          'EX',
          TWO_FACTOR_ENFORCED_MARKER_TTL_SECONDS,
          'NX',
        );
        if (claimed === null) {
          continue;
        }
        await this.sessionRevocation.revokeAllAndDisconnect(member.id);
        await this.trustedDeviceService.revokeAll(member.id);
        await this.auditService.log({
          action: AUDIT_ACTIONS.AUTH_2FA_ENFORCED,
          userId: member.id,
          tenantId: policy.tenantId,
          targetType: 'User',
          targetId: member.id,
        });
        enforced += 1;
        twoFactorEnforcedTotal.inc();
      }
    }
    return enforced;
  }

  /**
   * Pass 2: tenants whose grace ends within the next 24h (strictly after now, so
   * an already-expired tenant is enforced by pass 1, never merely reminded).
   * Returns the number of reminder emails enqueued this run.
   */
  private async sendUpcomingReminders(asOf: Date): Promise<number> {
    const windowEnd = new Date(asOf.getTime() + TWO_FACTOR_ENFORCEMENT_REMINDER_WINDOW_MS);
    const upcomingPolicies = await this.prismaService.unscoped.twoFactorPolicy.findMany({
      where: { required: true, graceEndsAt: { gt: asOf, lte: windowEnd } },
      select: { tenantId: true, graceEndsAt: true },
    });

    let reminded = 0;
    for (const policy of upcomingPolicies) {
      const graceEndsAt = policy.graceEndsAt;
      // The `gt`/`lte` predicate already excludes null graceEndsAt, but the
      // column is nullable so narrow it for the typed producer call.
      if (!graceEndsAt) {
        continue;
      }
      const members = await this.findNonEnrolledMembers(policy.tenantId);
      for (const member of members) {
        try {
          await this.mailService.sendTwoFactorEnforcementReminderEmail(member.email, graceEndsAt);
          reminded += 1;
        } catch (error) {
          // A single enqueue failure must not abort the fan-out; the deterministic
          // jobId makes the next tick's resend safe.
          this.logger.error('Failed to enqueue 2FA enforcement reminder', error);
        }
      }
    }
    return reminded;
  }

  /**
   * Members of a tenant with no ACTIVE non-recovery factor: the same DERIVED
   * "2FA enabled" predicate used everywhere else (recovery codes alone never
   * satisfy it). Soft-deleted users are structurally out of scope.
   */
  private findNonEnrolledMembers(tenantId: string): Promise<{ id: string; email: string }[]> {
    return this.prismaService.unscoped.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        secondFactors: {
          none: {
            status: SecondFactorStatus.ACTIVE,
            type: { not: SecondFactorType.RECOVERY_CODE },
          },
        },
      },
      select: { id: true, email: true },
    });
  }
}
