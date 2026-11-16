/**
 * The Google sign-in door, wired to the real database.
 *
 * Two findings (SEC-001 and SEC-002) are about the same call,
 * `OAuthAccountService.resolveLogin`, on its two branches, so the wiring lives
 * here once. Everything Redis-backed or outbound is a stub: the epoch counter,
 * the cookie mint and the notification mail are not what either finding is
 * about, and the collaborators that would only be reached on paths neither
 * finding touches are left empty so a wrong turn throws instead of passing.
 */
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import type { PrismaService } from '@/common/database/prisma.service';
import type { AuditService } from '@/modules/audit/audit.service';
import type { SessionRevocationService } from '@/modules/events/session-revocation.service';
import type { MailService } from '@/modules/mail/mail.service';
import { OAuthAccountService } from '@/modules/auth/oauth/oauth-account.service';
import type { IOAuthIdentity } from '@/modules/auth/oauth/providers/oauth-provider.interface';
import type { LockoutRepository } from '@/modules/auth/repositories/lockout.repository';
import { SecondFactorRepository } from '@/modules/auth/repositories/second-factor.repository';
import { LockoutService } from '@/modules/auth/services/lockout.service';
import type { ProvisioningService } from '@/modules/auth/services/provisioning.service';
import type { SessionService } from '@/modules/auth/services/session.service';
import type { UserService } from '@/modules/user/user.service';

/** The request context every case here shares; neither finding depends on it. */
export const OAUTH_CTX = { ip: '203.0.113.9', userAgent: 'security-spec' };

export interface IOAuthDoor {
  readonly service: OAuthAccountService;
  readonly audit: { log: jest.Mock };
  readonly sessionRevocation: { revokeAllAndDisconnect: jest.Mock };
  readonly mail: { sendOAuthAccountLinkedEmail: jest.Mock };
}

export function buildOAuthDoor(prismaService: PrismaService): IOAuthDoor {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const sessionRevocation = { revokeAllAndDisconnect: jest.fn().mockResolvedValue(undefined) };
  const mail = { sendOAuthAccountLinkedEmail: jest.fn().mockResolvedValue(undefined) };

  const service = new OAuthAccountService(
    { get: jest.fn(() => undefined) } as unknown as ConfigService,
    prismaService,
    { normalizeEmail: (email: string) => email.trim().toLowerCase() } as unknown as UserService,
    { readEpoch: jest.fn().mockResolvedValue(0) } as unknown as SessionService,
    // The attempt reservation is not what this door is about; the stub records
    // nothing and refuses nothing.
    new LockoutService(
      {} as LockoutRepository,
      audit as unknown as AuditService,
      {} as unknown as Redis,
    ),
    {} as ProvisioningService,
    new SecondFactorRepository(prismaService),
    audit as unknown as AuditService,
    mail as unknown as MailService,
    sessionRevocation as unknown as SessionRevocationService,
  );

  return { service, audit, sessionRevocation, mail };
}

/** The reasons the door audited as OAUTH_FAILURE, in order. */
export function failureReasons(audit: { log: jest.Mock }): unknown[] {
  return audit.log.mock.calls
    .map(([row]) => row as { action: string; metadata?: { reason?: unknown } })
    .filter((row) => row.action === AUDIT_ACTIONS.OAUTH_FAILURE)
    .map((row) => row.metadata?.reason);
}

/** A Google identity for `email`, verified on the provider's side. */
export function googleIdentity(email: string, subject: string): IOAuthIdentity {
  return { provider: 'google', subject, email, emailVerified: true };
}
