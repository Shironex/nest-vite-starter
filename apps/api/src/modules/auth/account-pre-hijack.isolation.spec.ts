/**
 * Proof that account pre-hijacking is closed, against the LIVE docker
 * Postgres. Excluded from the fast jest lane; runs via the integration config:
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * The attack: somebody registers the victim's address with their own password
 * and keeps the session registration opens. The victim later clicks the
 * verification mail and signs in with Google. Before the fix, the attacker's
 * session survived the verification, and the Google sign-in auto-linked into
 * the account whose password the attacker still knew.
 *
 * The unit specs beside these services mock both Prisma and Redis, so they can
 * only show that the revocation is ASKED for. Here the verification token, the
 * flip and the Google resolution run on real rows, and the sessions live in a
 * real SessionService (on ioredis-mock, so no lane shares the dev Redis): a
 * session "no longer validates" is the literal `validateSession` answer, epoch
 * fence included. Only outbound and unrelated collaborators are stubbed.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { esmImport } from '../../common/utils/esm-import';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import type { PrismaService } from '../../common/database/prisma.service';
import type { CsrfService } from '../../common/security/csrf.service';
import type { AuditService } from '../audit/audit.service';
import type { EventsService } from '../events/events.service';
import { SessionRevocationService } from '../events/session-revocation.service';
import type { MailService } from '../mail/mail.service';
import type { NotificationEventsService } from '../notifications/notification-events.service';
import type { StorageService } from '../storage/storage.service';
import { UserRepository } from '../user/user.repository';
import { UserService } from '../user/user.service';
import { OAuthAccountService } from './oauth/oauth-account.service';
import { OAUTH_ERROR_CODES } from './oauth/oauth.constants';
import type { IOAuthIdentity } from './oauth/providers/oauth-provider.interface';
import { LockoutRepository } from './repositories/lockout.repository';
import { SecondFactorRepository } from './repositories/second-factor.repository';
import { TokenRepository } from './repositories/token.repository';
import type { AuthSharedService } from './services/auth-shared.service';
import { EmailVerificationService } from './services/email-verification.service';
import { LockoutService } from './services/lockout.service';
import { LoginService } from './services/login.service';
import { PasswordService } from './services/password.service';
import type { ProvisioningService } from './services/provisioning.service';
import { SessionService } from './services/session.service';
import type { StepUpService } from './services/step-up.service';
import { TokenService } from './services/token.service';
import type { TrustedDeviceService } from './services/trusted-device.service';
import { TwoFactorChallengeService } from './services/two-factor-challenge.service';
import type { TwoFactorPolicyService } from './services/two-factor-policy.service';

let unscoped: PrismaClient;
let prismaService: PrismaService;

const createdTenantIds = new Set<string>();
const createdUserIds = new Set<string>();

const ctx = { ip: '203.0.113.9', userAgent: 'iso' };
const req = {} as Request;
const res = {} as Response;

/** Test-only credentials, never a real secret. */
const ATTACKER_PASSWORD = 'attacker-chose-this-1';
const OWNER_PASSWORD = 'owner-chose-this-1';

const passwordService = new PasswordService();

const makeTenant = async () => {
  const uid = randomUUID();
  const tenant = await unscoped.tenant.create({
    data: { name: `aph-${uid}`, slug: `aph-${uid}` },
  });
  createdTenantIds.add(tenant.id);
  return tenant;
};

const googleIdentity = (email: string, subject = `sub-${randomUUID()}`): IOAuthIdentity => ({
  provider: 'google',
  subject,
  email,
  emailVerified: true,
});

/**
 * Every collaborator the flows under test share, wired to the real database
 * and ONE real SessionService, so a session minted by one flow is revoked (or
 * not) exactly as another flow sees it.
 */
const buildSubject = () => {
  const redis = new RedisMock() as unknown as Redis;
  const sessionService = new SessionService(redis);
  const events = {
    disconnectUser: jest.fn(),
    disconnectSession: jest.fn(),
  } as unknown as EventsService;
  const sessionRevocation = new SessionRevocationService(sessionService, events);
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const mail = {
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    sendOAuthAccountLinkedEmail: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  const userRepository = new UserRepository(prismaService);
  const userService = new UserService(
    userRepository,
    {} as StorageService,
    sessionRevocation,
    audit as unknown as AuditService,
    {} as NotificationEventsService,
    prismaService,
    redis,
  );
  const tokenService = new TokenService(new TokenRepository(prismaService), prismaService);
  const lockout = new LockoutService(
    new LockoutRepository(prismaService),
    audit as unknown as AuditService,
    redis,
  );
  const secondFactors = new SecondFactorRepository(prismaService);

  const minted: string[] = [];
  // The rate limiter and Turnstile are not what this file is about.
  const shared = {
    enforceAuthRateLimit: jest.fn().mockResolvedValue(undefined),
    validateTurnstile: jest.fn().mockResolvedValue(undefined),
    appUrl: 'https://app.example.test',
    // The real mint (and its epoch re-check) minus the cookie: the token is
    // captured so the spec can validate it the way the middleware would.
    establishSession: jest.fn(
      async (_req: Request, _res: Response, params: { tenantId?: string | null }) => {
        const { tenantId, ...rest } = params;
        const session = await sessionService.createSession({
          ...(rest as Parameters<SessionService['createSession']>[0]),
          tenantId: tenantId ?? undefined,
        });
        minted.push(session.token);
        return session;
      },
    ),
    setAuthCookie: jest.fn(),
  };

  const seam = new TwoFactorChallengeService(
    config,
    shared as unknown as AuthSharedService,
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

  const verification = new EmailVerificationService(
    tokenService,
    userService,
    mail as unknown as MailService,
    audit as unknown as AuditService,
    prismaService,
    shared as unknown as AuthSharedService,
    sessionRevocation,
  );

  const login = new LoginService(
    passwordService,
    sessionService,
    lockout,
    userService,
    sessionRevocation,
    events,
    { rotate: jest.fn() } as unknown as CsrfService,
    audit as unknown as AuditService,
    shared as unknown as AuthSharedService,
    seam,
  );

  const oauth = new OAuthAccountService(
    config,
    prismaService,
    userService,
    sessionService,
    lockout,
    {} as ProvisioningService,
    secondFactors,
    audit as unknown as AuditService,
    mail as unknown as MailService,
    sessionRevocation,
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

  const signInWithPassword = (email: string, password: string) =>
    login.login(
      { email, password, rememberMe: false, turnstileToken: 't' },
      ctx.ip,
      ctx.userAgent,
      req,
      res,
    );

  /**
   * What RegisterService leaves behind: an organization, its unverified ADMIN owner
   * with the password the registrant typed, a session opened before anyone
   * proved control of the inbox, and a verification token mailed to it.
   */
  const register = async (password: string | null, email = `aph-${randomUUID()}@example.test`) => {
    const tenant = await makeTenant();
    const user = await unscoped.user.create({
      data: {
        email,
        tenantId: tenant.id,
        role: 'ADMIN',
        passwordHash: password === null ? null : await passwordService.hash(password),
        emailVerified: false,
      },
      select: { id: true, email: true },
    });
    createdUserIds.add(user.id);
    // Register mints without an epoch (the account did not exist when the
    // request began), exactly as RegisterService does.
    const session = await sessionService.createSession({
      userId: user.id,
      email: user.email,
      role: 'ADMIN',
      emailVerified: false,
      ...ctx,
      rememberMe: false,
      tenantId: tenant.id,
    });
    const verificationToken = await tokenService.createVerificationToken(user.id);
    return { tenant, user, registrationSession: session.token, verificationToken };
  };

  const isValid = async (token: string): Promise<boolean> =>
    (await sessionService.validateSession(token)) !== null;

  const failureReasons = (): unknown[] =>
    audit.log.mock.calls
      .map(([row]) => row as { action: string; metadata?: { reason?: unknown } })
      .filter((row) => row.action === AUDIT_ACTIONS.OAUTH_FAILURE)
      .map((row) => row.metadata?.reason);

  return {
    sessionService,
    secondFactors,
    verification,
    minted,
    register,
    isValid,
    signInWithGoogle,
    signInWithPassword,
    failureReasons,
    shared,
  };
};

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  // The extended client, exactly as PrismaService.client builds it: verify and
  // the OAuth callback both run with no tenant in the ALS.
  const client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;
  prismaService = { client, unscoped } as unknown as PrismaService;
});

afterAll(async () => {
  // Tokens and OAuthAccount rows cascade with their user; users before tenants
  // because User.tenantId is Restrict.
  if (createdUserIds.size > 0) {
    await unscoped.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
  }
  if (createdTenantIds.size > 0) {
    await unscoped.tenant.deleteMany({ where: { id: { in: [...createdTenantIds] } } });
  }
});

describe('account pre-hijacking', () => {
  it("the registrant's pre-verification session no longer validates once the owner verifies", async () => {
    const subject = buildSubject();
    const { user, registrationSession, verificationToken } =
      await subject.register(ATTACKER_PASSWORD);
    expect(await subject.isValid(registrationSession)).toBe(true);

    // The owner clicks the mailed link.
    await subject.verification.verifyEmail(verificationToken, ctx.ip);

    const row = await unscoped.user.findUnique({
      where: { id: user.id },
      select: { emailVerified: true },
    });
    expect(row?.emailVerified).toBe(true);
    expect(await subject.isValid(registrationSession)).toBe(false);
  });

  it('the Google callback for the now-verified address is refused: LINK_BLOCKED, no link row', async () => {
    const subject = buildSubject();
    const { user, registrationSession, verificationToken } =
      await subject.register(ATTACKER_PASSWORD);
    await subject.verification.verifyEmail(verificationToken, ctx.ip);

    await expect(subject.signInWithGoogle(googleIdentity(user.email))).resolves.toEqual({
      outcome: 'rejected',
      errorCode: OAUTH_ERROR_CODES.LINK_BLOCKED,
    });

    // The victim never lands in the account whose password the attacker holds.
    expect(subject.minted).toHaveLength(0);
    expect(subject.shared.establishSession).not.toHaveBeenCalled();
    expect(await unscoped.oAuthAccount.count({ where: { userId: user.id } })).toBe(0);
    expect(subject.failureReasons()).toEqual(['link_blocked_password_account']);
    // And nothing on that path brought the attacker's session back.
    expect(await subject.isValid(registrationSession)).toBe(false);
  });

  it('control: register, verify, then sign in with the password still works', async () => {
    const subject = buildSubject();
    const { user, verificationToken } = await subject.register(OWNER_PASSWORD);
    await subject.verification.verifyEmail(verificationToken, ctx.ip);

    await expect(subject.signInWithPassword(user.email, OWNER_PASSWORD)).resolves.toMatchObject({
      status: 'ok',
    });

    // Minted after the verification's epoch bump, so the fence lets it live.
    expect(subject.minted).toHaveLength(1);
    expect(await subject.isValid(subject.minted[0] ?? '')).toBe(true);
  });

  it('control: a Google-only account still signs in through its existing link', async () => {
    const subject = buildSubject();
    const { user, verificationToken } = await subject.register(null);
    await subject.verification.verifyEmail(verificationToken, ctx.ip);
    const identity = googleIdentity(user.email);
    await unscoped.oAuthAccount.create({
      data: {
        provider: 'google',
        providerAccountId: identity.subject,
        email: user.email,
        emailVerified: true,
        userId: user.id,
      },
    });

    await expect(subject.signInWithGoogle(identity)).resolves.toMatchObject({ kind: 'session' });

    expect(subject.minted).toHaveLength(1);
    expect(await subject.isValid(subject.minted[0] ?? '')).toBe(true);
    expect(subject.failureReasons()).toEqual([]);
  });

  describe('the auto-link that remains (passwordless, factorless, double-verified)', () => {
    it('revokes every earlier session and mints one that validates', async () => {
      const subject = buildSubject();
      const { user, verificationToken } = await subject.register(null);
      await subject.verification.verifyEmail(verificationToken, ctx.ip);
      // A session the account held before the new sign-in method attached.
      const earlier = await subject.sessionService.createSession({
        userId: user.id,
        email: user.email,
        role: 'ADMIN',
        emailVerified: true,
        ...ctx,
        rememberMe: false,
      });
      expect(await subject.isValid(earlier.token)).toBe(true);

      await expect(subject.signInWithGoogle(googleIdentity(user.email))).resolves.toMatchObject({
        kind: 'session',
      });

      expect(await unscoped.oAuthAccount.count({ where: { userId: user.id } })).toBe(1);
      expect(await subject.isValid(earlier.token)).toBe(false);
      // The epoch handed to the seam accounts for the auto-link's own bump:
      // the new session is not fenced out by the revocation that preceded it.
      expect(subject.minted).toHaveLength(1);
      expect(await subject.isValid(subject.minted[0] ?? '')).toBe(true);
    });

    it('still fails the mint when ANOTHER revocation lands during the gate checks', async () => {
      // A member removal or a role change bumping the counter after the
      // resolution captured it. Re-reading the counter after the auto-link's
      // own revocation would absorb that bump and mint straight through it.
      const subject = buildSubject();
      const { user, verificationToken } = await subject.register(null);
      await subject.verification.verifyEmail(verificationToken, ctx.ip);
      const realFindAnyActive = subject.secondFactors.findAnyActive.bind(subject.secondFactors);
      jest.spyOn(subject.secondFactors, 'findAnyActive').mockImplementationOnce(async (userId) => {
        await subject.sessionService.deleteAllUserSessions(userId);
        return realFindAnyActive(userId);
      });

      await expect(subject.signInWithGoogle(googleIdentity(user.email))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(subject.minted).toHaveLength(0);
    });
  });
});
