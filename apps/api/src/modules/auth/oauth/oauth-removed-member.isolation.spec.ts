/**
 * Proof that a member removed from their organization cannot sign back in with
 * Google, against the LIVE docker Postgres. Excluded from the fast jest lane;
 * runs via the integration config:
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * The unit specs beside these services mock Prisma, so they can only assert
 * that the right fields are ASKED for. What they cannot see is the thing the
 * bug was made of: removal is a flag on a row that keeps its tenantId, its role
 * and every OAuthAccount link, so the real rows are what has to be refused.
 * Here the removal is written by the real `endMembership`, the Google
 * resolution and the session seam read the real rows through the request
 * client (no tenant in the ALS, exactly as at the callback), and only the
 * Redis-side collaborators are stubbed.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AppErrorCode } from '@repo/shared/errors';
import { esmImport } from '../../../common/utils/esm-import';
import { requestContext } from '../../../common/context/request-context';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { MailService } from '../../mail/mail.service';
import type { NotificationEventsService } from '../../notifications/notification-events.service';
import type { SessionRevocationService } from '../../events/session-revocation.service';
import type { StorageService } from '../../storage/storage.service';
import { UserRepository } from '../../user/user.repository';
import { UserService } from '../../user/user.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import type { LockoutRepository } from '../repositories/lockout.repository';
import type { AuthSharedService } from '../services/auth-shared.service';
import { LockoutService } from '../services/lockout.service';
import type { ProvisioningService } from '../services/provisioning.service';
import type { SessionService } from '../services/session.service';
import type { StepUpService } from '../services/step-up.service';
import type { TrustedDeviceService } from '../services/trusted-device.service';
import { TwoFactorChallengeService } from '../services/two-factor-challenge.service';
import type { TwoFactorPolicyService } from '../services/two-factor-policy.service';
import { OAuthAccountService } from './oauth-account.service';
import { OAUTH_ERROR_CODES } from './oauth.constants';
import type { IOAuthIdentity } from './providers/oauth-provider.interface';

let unscoped: PrismaClient;
let prismaService: PrismaService;
let userRepository: UserRepository;

const createdTenantIds = new Set<string>();
const createdUserIds = new Set<string>();

const ctx = { ip: '203.0.113.9', userAgent: 'iso' };
const req = {} as Request;
const res = {} as Response;

/** Same non-secret placeholder the other auth isolation specs use (see `.gitleaks.toml`). */
const FAKE_HASH = 'argon2-existing';

const makeTenant = async () => {
  const uid = randomUUID();
  const tenant = await unscoped.tenant.create({
    data: { name: `orm-${uid}`, slug: `orm-${uid}` },
  });
  createdTenantIds.add(tenant.id);
  return tenant;
};

const makeMember = async (
  tenantId: string,
  // Password accounts are never auto-linked, so the auto-link cases below
  // need a Google-only (passwordless) member to reach the gates they test.
  passwordHash: string | null = FAKE_HASH,
): Promise<{ id: string; email: string }> => {
  const uid = randomUUID();
  const user = await unscoped.user.create({
    data: {
      email: `orm-${uid}@example.test`,
      tenantId,
      role: 'USER',
      passwordHash,
      emailVerified: true,
    },
    select: { id: true, email: true },
  });
  createdUserIds.add(user.id);
  return user;
};

const linkGoogle = async (user: { id: string; email: string }): Promise<IOAuthIdentity> => {
  const subject = `sub-${randomUUID()}`;
  await unscoped.oAuthAccount.create({
    data: {
      provider: 'google',
      providerAccountId: subject,
      email: user.email,
      emailVerified: true,
      userId: user.id,
    },
  });
  return googleIdentity(user.email, subject);
};

const googleIdentity = (email: string, subject = `sub-${randomUUID()}`): IOAuthIdentity => ({
  provider: 'google',
  subject,
  email,
  emailVerified: true,
});

/** The admin's removal, through the real guarded write. */
const removeFromOrganization = async (userId: string, tenantId: string): Promise<void> => {
  expect(await userRepository.endMembership(userId, tenantId, new Date())).toBe(1);
};

/**
 * The services under test, wired to the real database. Everything Redis-backed
 * or outbound is a stub: the epoch fence and the cookie mint are not what this
 * file is about, and `establishSession` being called at all IS the assertion.
 */
const buildSubject = () => {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const establishSession = jest
    .fn()
    .mockResolvedValue({ token: 'tok', expiresAt: new Date(Date.now() + 60_000) });
  // The attempt reservation is Redis-backed and not what this file is about.
  const lockout = new LockoutService(
    {} as LockoutRepository,
    audit as unknown as AuditService,
    {} as Redis,
  );
  const secondFactors = new SecondFactorRepository(prismaService);
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  const oauth = new OAuthAccountService(
    config,
    prismaService,
    { normalizeEmail: (e: string) => e.trim().toLowerCase() } as unknown as UserService,
    { readEpoch: jest.fn().mockResolvedValue(0) } as unknown as SessionService,
    lockout,
    {} as ProvisioningService,
    secondFactors,
    audit as unknown as AuditService,
    { sendOAuthAccountLinkedEmail: jest.fn() } as unknown as MailService,
    // The auto-link revokes earlier sessions; Redis is not what this file is about.
    {
      revokeAllAndDisconnect: jest.fn().mockResolvedValue(undefined),
    } as unknown as SessionRevocationService,
  );
  const seam = new TwoFactorChallengeService(
    config,
    { establishSession, setAuthCookie: jest.fn() } as unknown as AuthSharedService,
    lockout,
    {} as StepUpService,
    { isTrusted: jest.fn().mockResolvedValue(false) } as unknown as TrustedDeviceService,
    {
      isEnrollmentRequiredForTenant: jest.fn().mockResolvedValue(false),
    } as unknown as TwoFactorPolicyService,
    secondFactors,
    {} as UserService,
    audit as unknown as AuditService,
    {} as MailService,
    prismaService,
    {} as Redis,
  );

  /** The OAuth callback's login arm: resolve, then hand the user to the seam. */
  const signInWithGoogle = async (identity: IOAuthIdentity) => {
    const resolution = await oauth.resolveLogin(identity, ctx);
    if (resolution.outcome === 'rejected') {
      return resolution;
    }
    return seam.beginOrEstablish(req, res, resolution.user, {
      rememberMe: false,
      ...ctx,
      epoch: resolution.epoch,
    });
  };

  return { audit, establishSession, seam, signInWithGoogle };
};

const failureReasons = (audit: { log: jest.Mock }): unknown[] =>
  audit.log.mock.calls
    .map(([row]) => row as { action: string; metadata?: { reason?: unknown } })
    .filter((row) => row.action === AUDIT_ACTIONS.OAUTH_FAILURE)
    .map((row) => row.metadata?.reason);

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  // The extended client, exactly as PrismaService.client builds it: the
  // callback reads through it with no tenant in the ALS.
  const client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;
  prismaService = { client, unscoped } as unknown as PrismaService;
  userRepository = new UserRepository(prismaService);
});

afterAll(async () => {
  // OAuthAccount rows cascade with their user; users before tenants because
  // User.tenantId is Restrict.
  if (createdUserIds.size > 0) {
    await unscoped.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
  }
  if (createdTenantIds.size > 0) {
    await unscoped.tenant.deleteMany({ where: { id: { in: [...createdTenantIds] } } });
  }
});

describe('Google sign-in refuses a member removed from their organization', () => {
  it('control: an active member with a linked Google account signs in', async () => {
    const tenant = await makeTenant();
    const member = await makeMember(tenant.id);
    const identity = await linkGoogle(member);
    const { signInWithGoogle, establishSession } = buildSubject();

    await expect(signInWithGoogle(identity)).resolves.toMatchObject({ kind: 'session' });
    expect(establishSession).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({ userId: member.id, tenantId: tenant.id }),
    );
  });

  it('linked path: the removed member is refused, generic code, membership_ended audited', async () => {
    const tenant = await makeTenant();
    const member = await makeMember(tenant.id);
    const identity = await linkGoogle(member);
    await removeFromOrganization(member.id, tenant.id);
    const { signInWithGoogle, establishSession, audit } = buildSubject();

    await expect(signInWithGoogle(identity)).resolves.toEqual({
      outcome: 'rejected',
      errorCode: OAUTH_ERROR_CODES.FAILED,
    });
    expect(establishSession).not.toHaveBeenCalled();
    expect(failureReasons(audit)).toEqual(['membership_ended']);
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.OAUTH_LOGIN }),
    );
  });

  it('control: an active, double-verified, zero-factor, passwordless member is auto-linked and signs in', async () => {
    const tenant = await makeTenant();
    const member = await makeMember(tenant.id, null);
    const { signInWithGoogle, establishSession } = buildSubject();

    await expect(signInWithGoogle(googleIdentity(member.email))).resolves.toMatchObject({
      kind: 'session',
    });
    expect(establishSession).toHaveBeenCalledTimes(1);
    expect(await unscoped.oAuthAccount.count({ where: { userId: member.id } })).toBe(1);
  });

  it('auto-link path: the removed member is refused and gains no link row', async () => {
    const tenant = await makeTenant();
    const member = await makeMember(tenant.id, null);
    await removeFromOrganization(member.id, tenant.id);
    const { signInWithGoogle, establishSession, audit } = buildSubject();

    await expect(signInWithGoogle(googleIdentity(member.email))).resolves.toEqual({
      outcome: 'rejected',
      errorCode: OAUTH_ERROR_CODES.FAILED,
    });
    expect(establishSession).not.toHaveBeenCalled();
    expect(failureReasons(audit)).toEqual(['membership_ended']);
    expect(await unscoped.oAuthAccount.count({ where: { userId: member.id } })).toBe(0);
  });
});

describe('the session seam re-reads account state on its own', () => {
  it('refuses a removed member handed in by an entry point that checked nothing', async () => {
    // What a future door that forgets the list looks like: a snapshot taken
    // before (or without regard to) the removal, straight into the seam.
    const tenant = await makeTenant();
    const member = await makeMember(tenant.id);
    await removeFromOrganization(member.id, tenant.id);
    const { seam, establishSession, audit } = buildSubject();

    await expect(
      seam.beginOrEstablish(
        req,
        res,
        {
          id: member.id,
          email: member.email,
          role: 'USER',
          emailVerified: true,
          tenantId: tenant.id,
        },
        { rememberMe: false, ...ctx },
      ),
    ).rejects.toMatchObject({ appCode: AppErrorCode.INVALID_CREDENTIALS });
    expect(establishSession).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
        userId: member.id,
        tenantId: tenant.id,
        metadata: { reason: 'membership_ended', gate: 'session_mint' },
      }),
    );
  });

  it('refuses a soft-deleted account the same way', async () => {
    const tenant = await makeTenant();
    const member = await makeMember(tenant.id);
    await unscoped.user.update({ where: { id: member.id }, data: { deletedAt: new Date() } });
    const { seam, establishSession } = buildSubject();

    await expect(
      seam.beginOrEstablish(
        req,
        res,
        {
          id: member.id,
          email: member.email,
          role: 'USER',
          emailVerified: true,
          tenantId: tenant.id,
        },
        { rememberMe: false, ...ctx },
      ),
    ).rejects.toMatchObject({ appCode: AppErrorCode.INVALID_CREDENTIALS });
    expect(establishSession).not.toHaveBeenCalled();
  });
});

describe('removeMember is retryable after a failed session teardown', () => {
  const buildUserService = () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const sessionRevocation = { revokeAllAndDisconnect: jest.fn().mockResolvedValue(undefined) };
    const service = new UserService(
      userRepository,
      {} as StorageService,
      sessionRevocation as unknown as SessionRevocationService,
      audit as unknown as AuditService,
      {} as NotificationEventsService,
      prismaService,
      { del: jest.fn().mockResolvedValue(0) } as unknown as Redis,
    );
    return { service, audit, sessionRevocation };
  };

  const asAdminOf = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    requestContext.run({ requestId: 'orm-iso', tenantId }, fn);

  it('the retry revokes instead of answering NotFound, and audits the removal once', async () => {
    const tenant = await makeTenant();
    const admin = await makeMember(tenant.id);
    const member = await makeMember(tenant.id);
    const { service, audit, sessionRevocation } = buildUserService();
    sessionRevocation.revokeAllAndDisconnect.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      asAdminOf(tenant.id, () => service.removeMember(admin.id, member.id)),
    ).rejects.toThrow('redis down');
    // The flag committed before the teardown failed: that is the stranding.
    const flagged = await unscoped.user.findUnique({
      where: { id: member.id },
      select: { membershipEndedAt: true },
    });
    expect(flagged?.membershipEndedAt).not.toBeNull();

    await expect(
      asAdminOf(tenant.id, () => service.removeMember(admin.id, member.id)),
    ).resolves.toBeUndefined();

    expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledTimes(2);
    expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenLastCalledWith(member.id);
    const removals = audit.log.mock.calls.filter(
      ([row]) => (row as { action: string }).action === AUDIT_ACTIONS.MEMBER_REMOVED,
    );
    expect(removals).toHaveLength(1);
  });

  it('control: a removed member of ANOTHER organization is still NotFound, and nothing is revoked', async () => {
    const mine = await makeTenant();
    const theirs = await makeTenant();
    const admin = await makeMember(mine.id);
    const stranger = await makeMember(theirs.id);
    await removeFromOrganization(stranger.id, theirs.id);
    const { service, sessionRevocation } = buildUserService();

    await expect(
      asAdminOf(mine.id, () => service.removeMember(admin.id, stranger.id)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
  });
});
