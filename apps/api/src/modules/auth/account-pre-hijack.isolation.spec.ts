/**
 * Proof that account pre-hijacking is closed, against the LIVE docker
 * Postgres. Excluded from the fast jest lane; runs via the integration config:
 *
 *   export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" \
 *     && pnpm --filter @repo/api test:integration
 *
 * The attack: somebody registers the victim's address with their own password
 * and keeps the session registration opens. The victim later clicks the
 * verification mail. Before the fix, the attacker's session survived the
 * verification.
 *
 * The unit specs beside these services mock both Prisma and Redis, so they can
 * only show that the revocation is ASKED for. Here the verification token, the
 * flip run on real rows, and the sessions live in a
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
import { esmImport } from '../../common/utils/esm-import';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import type { PrismaService } from '../../common/database/prisma.service';
import type { CsrfService } from '../../common/security/csrf.service';
import type { AuditService } from '../audit/audit.service';
import type { MailService } from '../mail/mail.service';
import { UserRepository } from '../user/user.repository';
import { UserService } from '../user/user.service';
import { LockoutRepository } from './repositories/lockout.repository';
import { SecondFactorRepository } from './repositories/second-factor.repository';
import { TokenRepository } from './repositories/token.repository';
import type { AuthSharedService } from './services/auth-shared.service';
import { EmailVerificationService } from './services/email-verification.service';
import { LockoutService } from './services/lockout.service';
import { LoginService } from './services/login.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import type { StepUpService } from './services/step-up.service';
import { TokenService } from './services/token.service';
import type { TrustedDeviceService } from './services/trusted-device.service';
import { TwoFactorChallengeService } from './services/two-factor-challenge.service';

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

/**
 * Every collaborator the flows under test share, wired to the real database
 * and ONE real SessionService, so a session minted by one flow is revoked (or
 * not) exactly as another flow sees it.
 */
const buildSubject = () => {
  const redis = new RedisMock() as unknown as Redis;
  const sessionService = new SessionService(redis);
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const mail = {
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  const userRepository = new UserRepository(prismaService);
  const userService = new UserService(
    userRepository,
    sessionService,
    audit as unknown as AuditService,
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
    sessionService,
  );

  const login = new LoginService(
    passwordService,
    sessionService,
    lockout,
    userService,
    { rotate: jest.fn() } as unknown as CsrfService,
    audit as unknown as AuditService,
    shared as unknown as AuthSharedService,
    seam,
  );

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

  return {
    sessionService,
    secondFactors,
    verification,
    minted,
    register,
    isValid,
    signInWithPassword,
    shared,
  };
};

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  // The extended client, exactly as PrismaService.client builds it: verify
  // runs with no tenant in the ALS.
  const client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;
  prismaService = { client, unscoped } as unknown as PrismaService;
});

afterAll(async () => {
  // Tokens cascade with their user; users before tenants
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
});
