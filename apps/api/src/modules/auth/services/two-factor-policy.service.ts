import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ForbiddenError } from '../../../common/errors';
import { getTenantId } from '../../../common/context/request-context';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { now } from '../../../common/clock';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { isPrismaUniqueConstraintError } from '../prisma-unique-error.util';
import { TWO_FACTOR_GRACE_PERIOD_MS } from '../auth.constants';
import { SecondFactorRepository, SecondFactorType } from '../repositories/second-factor.repository';
import { TrustedDeviceService } from './trusted-device.service';

export interface ITenantPolicy {
  required: boolean;
  graceEndsAt: Date | null;
  enforced: boolean;
}

/**
 * Per-Organization 2FA enforcement policy. Tenant-scoped: reads/writes go through the
 * scoped Prisma client, so the tenant-scope extension injects the caller's
 * tenantId and fails closed without one. All procedures here are admin-guarded
 * (AdminMiddleware) and additionally re-check getTenantId() fail-closed.
 */
@Injectable()
export class TwoFactorPolicyService {
  private readonly logger = new Logger(TwoFactorPolicyService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly secondFactorRepository: SecondFactorRepository,
    private readonly trustedDeviceService: TrustedDeviceService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private requireTenant(): string {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'Tenant context required');
    }
    return tenantId;
  }

  /**
   * Login-context check (runs pre-session, OUTSIDE tenant ALS, so it reads the
   * policy UNSCOPED by explicit tenantId): does this tenant require 2FA and has
   * its grace passed? The challenge seam uses this to stamp the enroll-only flag
   * onto new sessions of non-enrolled members.
   */
  async isEnrollmentRequiredForTenant(tenantId: string): Promise<boolean> {
    const policy = await this.prismaService.unscoped.twoFactorPolicy.findUnique({
      where: { tenantId },
    });
    if (!policy?.required || !policy.graceEndsAt) {
      return false;
    }
    return policy.graceEndsAt.getTime() <= now().getTime();
  }

  /** Current policy for the caller's tenant (lazily absent = not required). */
  async getTenantPolicy(): Promise<ITenantPolicy> {
    const tenantId = this.requireTenant();
    const policy = await this.prismaService.client.twoFactorPolicy.findUnique({
      where: { tenantId },
    });
    return this.toView(policy);
  }

  private toView(policy: { required: boolean; graceEndsAt: Date | null } | null): ITenantPolicy {
    if (!policy?.required) {
      return { required: false, graceEndsAt: null, enforced: false };
    }
    const graceEndsAt = policy.graceEndsAt;
    const enforced = graceEndsAt !== null && graceEndsAt.getTime() <= now().getTime();
    return { required: true, graceEndsAt, enforced };
  }

  /**
   * Enable/disable the tenant 2FA requirement. A genuine enable starts a fresh
   * 7-day grace and announces to non-enrolled members; re-affirming an
   * already-required policy is a no-op that preserves the deadline; disabling
   * nulls the grace.
   */
  async setTenantPolicy(required: boolean, ip: string, userAgent: string): Promise<ITenantPolicy> {
    const tenantId = this.requireTenant();
    return required
      ? this.enableTenantPolicy(tenantId, ip, userAgent)
      : this.disableTenantPolicy(tenantId, ip, userAgent);
  }

  /**
   * Turn the requirement ON, at most once per genuine transition.
   *
   * The "double-toggle cannot re-email every non-enrolled member" rule used to
   * be a read, a decision in memory and then a write, which does not hold under
   * concurrency: two admins enabling within milliseconds (or one admin
   * double-clicking, since this procedure carries no idempotency key) both read
   * `required: false`, both write, both audit, and both fan out. The mail jobId
   * is `sha256(to:graceEndsAt)` and the two grace deadlines differ by the
   * milliseconds between the calls, so the two batches do NOT collapse: every
   * non-enrolled member gets two announcements naming two different deadlines.
   *
   * So the transition is CLAIMED with a compare-and-swap instead. Exactly one
   * caller can move the row from `required: false`, and only that caller writes
   * the audit row and sends the mail. Everyone else reads the winner's policy
   * back and returns it, which is the same answer they would have got from the
   * old idempotent-re-affirmation branch.
   */
  private async enableTenantPolicy(
    tenantId: string,
    ip: string,
    userAgent: string,
  ): Promise<ITenantPolicy> {
    const graceEndsAt = new Date(now().getTime() + TWO_FACTOR_GRACE_PERIOD_MS);

    let transitioned: boolean;
    try {
      transitioned = await this.prismaService.client.$transaction(async (tx) => {
        // The CAS. `required: false` in the WHERE is the claim: at most one
        // concurrent caller can match it.
        const claimed = await tx.twoFactorPolicy.updateMany({
          where: { tenantId, required: false },
          data: { required: true, graceEndsAt },
        });
        if (claimed.count > 0) {
          return true;
        }
        // Matched nothing for one of two reasons, and only one of them is a
        // write: the policy is already required (somebody else's transition, or
        // an earlier one), or the lazily-created row does not exist yet.
        const existing = await tx.twoFactorPolicy.findUnique({ where: { tenantId } });
        if (existing) {
          return false;
        }
        await tx.twoFactorPolicy.create({ data: { tenantId, required: true, graceEndsAt } });
        return true;
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }
      // Lost the create race against a concurrent first enable. The winner owns
      // the audit row and the announcement.
      transitioned = false;
    }

    if (!transitioned) {
      const current = await this.prismaService.client.twoFactorPolicy.findUnique({
        where: { tenantId },
      });
      return this.toView(current);
    }

    await this.auditPolicyChange(tenantId, true, graceEndsAt, ip, userAgent);
    await this.announceToNonEnrolled(tenantId, graceEndsAt);

    return { required: true, graceEndsAt, enforced: false };
  }

  /**
   * Turn the requirement OFF and null the grace.
   *
   * No CAS: disabling fans nothing out, so a repeat is a repeated audit row at
   * worst, and an upsert keeps the lazily-absent row a legal starting state.
   */
  private async disableTenantPolicy(
    tenantId: string,
    ip: string,
    userAgent: string,
  ): Promise<ITenantPolicy> {
    const policy = await this.prismaService.client.twoFactorPolicy.upsert({
      where: { tenantId },
      create: { tenantId, required: false, graceEndsAt: null },
      update: { required: false, graceEndsAt: null },
    });

    await this.auditPolicyChange(tenantId, false, null, ip, userAgent);

    return this.toView(policy);
  }

  private auditPolicyChange(
    tenantId: string,
    required: boolean,
    graceEndsAt: Date | null,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    return this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_POLICY_CHANGED,
      targetType: 'Tenant',
      targetId: tenantId,
      ipAddress: ip,
      userAgent,
      metadata: { required, graceEndsAt: graceEndsAt?.toISOString() ?? null },
    });
  }

  /** Enqueue the policy-announcement email to every non-enrolled tenant member. */
  private async announceToNonEnrolled(tenantId: string, graceEndsAt: Date): Promise<void> {
    const members = await this.findNonEnrolledMembers(tenantId);
    for (const member of members) {
      try {
        await this.mailService.sendTwoFactorPolicyAnnouncementEmail(member.email, graceEndsAt);
      } catch (error) {
        this.logger.error('Failed to enqueue 2FA policy announcement', error);
      }
    }
  }

  /** Live members of the tenant with no active non-recovery factor. */
  private findNonEnrolledMembers(tenantId: string): Promise<{ id: string; email: string }[]> {
    return this.prismaService.client.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        secondFactors: {
          none: { status: 'ACTIVE', type: { not: SecondFactorType.RECOVERY_CODE } },
        },
      },
      select: { id: true, email: true },
    });
  }

  /**
   * Admin reset of a member's 2FA. Target must be in the caller's tenant and not
   * the caller (self-removal is twoFactor.disable, which demands password+code).
   * Wipes factors, trusted devices and pending challenges, revokes sessions,
   * audits, and emails the member. Re-enrollment is forced at next login per
   * policy (grace does not restart).
   */
  async resetMemberTwoFactor(
    callerId: string,
    targetUserId: string,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    const tenantId = this.requireTenant();
    if (targetUserId === callerId) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'Use disable to remove your own 2FA');
    }

    // Fail closed: the target must be a live account in the caller's tenant.
    const target = await this.prismaService.client.user.findFirst({
      where: { id: targetUserId, tenantId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!target) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'Member not found in tenant');
    }

    await this.secondFactorRepository.deleteAllForUser(targetUserId);
    await this.trustedDeviceService.revokeAll(targetUserId);
    await this.revokePendingChallenges(targetUserId);
    await this.sessionRevocation.revokeAllAndDisconnect(targetUserId);

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_ADMIN_RESET,
      userId: callerId,
      targetType: 'User',
      targetId: targetUserId,
      ipAddress: ip,
      userAgent,
    });

    try {
      await this.mailService.sendTwoFactorAdminResetEmail(target.email);
    } catch (error) {
      this.logger.error('Failed to enqueue 2FA admin-reset email', error);
    }
  }

  /** Best-effort delete of a user's in-flight pending challenge records. */
  private async revokePendingChallenges(userId: string): Promise<void> {
    const setKey = RedisKeys.twoFactorPendingUser(userId);
    const ids = await this.redis.smembers(setKey);
    const multi = this.redis.multi();
    for (const id of ids) {
      multi.del(RedisKeys.twoFactorPending(id));
    }
    multi.del(setKey);
    await multi.exec();
  }
}
