import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ForbiddenError } from '../../../common/errors';
import { getTenantId } from '../../../common/context/request-context';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { SessionService } from './session.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import { TrustedDeviceService } from './trusted-device.service';

/**
 * Admin reset of a member's second factor, for the member who lost their
 * authenticator and their recovery codes. Tenant-scoped: reads go through the
 * scoped Prisma client, so the tenant-scope extension injects the caller's
 * tenantId and fails closed without one. The procedure is admin-guarded
 * (AdminMiddleware) and additionally re-checks getTenantId() fail-closed.
 */
@Injectable()
export class TwoFactorAdminResetService {
  private readonly logger = new Logger(TwoFactorAdminResetService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly secondFactorRepository: SecondFactorRepository,
    private readonly trustedDeviceService: TrustedDeviceService,
    private readonly sessionService: SessionService,
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
   * Admin reset of a member's 2FA. Target must be in the caller's tenant and not
   * the caller (self-removal is twoFactor.disable, which demands password+code).
   * Wipes factors, trusted devices and pending challenges, revokes sessions,
   * audits, and emails the member.
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
    await this.sessionService.deleteAllUserSessions(targetUserId);

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
