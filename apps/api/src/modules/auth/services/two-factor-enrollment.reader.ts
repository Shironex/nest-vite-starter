import { Injectable } from '@nestjs/common';
import { now } from '../../../common/clock';
import { PrismaService } from '../../../common/database/prisma.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';

/**
 * Live re-derivation of the login-stamped "enroll-only" session flag, shared by
 * the tRPC AuthMiddleware and the WebSocket handshake. The flag is stamped once
 * at login and can go stale (the tenant admin disables the policy, or the member
 * enrolls in another session); both session consumers re-check it here so a
 * stale flag never bricks a session in one place while healing in the other.
 *
 * Reads the caller's OWN tenant policy by the server-derived session tenantId
 * (never client input) via the unscoped client, the same pre-tenant-context read
 * the login seam (TwoFactorPolicyService.isEnrollmentRequiredForTenant) uses.
 */
@Injectable()
export class TwoFactorEnrollmentReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secondFactorRepository: SecondFactorRepository,
  ) {}

  async isEnrollmentStillRequired(
    userId: string,
    tenantId: string | null | undefined,
  ): Promise<boolean> {
    if (!tenantId) return false;
    const [policy, activeFactor] = await Promise.all([
      this.prisma.unscoped.twoFactorPolicy.findUnique({ where: { tenantId } }),
      this.secondFactorRepository.findActiveNonRecovery(userId),
    ]);
    const required =
      !!policy?.required &&
      policy.graceEndsAt != null &&
      policy.graceEndsAt.getTime() <= now().getTime();
    return required && activeFactor === null;
  }
}
