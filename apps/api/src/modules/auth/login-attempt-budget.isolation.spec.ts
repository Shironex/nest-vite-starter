/**
 * The password lockout bounds guessing under CONCURRENCY, against a live
 * Postgres and a live Redis.
 *
 * The invariant: at most MAX_FAILED_ATTEMPTS password evaluations per account
 * per window, however many requests are in flight. `isLockedFromUser` reads
 * `lockedUntil` from the row the request already fetched, so it cannot bound a
 * burst on its own: every participant that starts before the fifth failure
 * commits passes it. The Redis reservation, taken before argon2, is what makes
 * the budget hold, and it is the only thing between an attacker with many
 * addresses and solved Turnstile challenges and unlimited guesses per round.
 *
 * Run it:
 *   pnpm sandbox:up
 *   export DATABASE_URL="$(pnpm sandbox:inspect --lane-url=isolation | tail -n 1)"
 *   export REDIS_URL="$(pnpm sandbox:inspect --redis-url=isolation | tail -n 1)"
 *   pnpm --filter @repo/api test:integration
 *
 * Both services are real on purpose. ioredis-mock accepts `EXPIRE key ttl NX`
 * and then ignores the NX, so the "counting never extends the window" half of
 * the reservation could only ever be proved here. The barrier comes from
 * `@test/concurrency`: releasing N callers together is what makes them contend,
 * where a plain `Promise.all` over started promises lets the first run several
 * awaits ahead of the last.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AppErrorCode } from '@repo/shared/errors';
import { raceAll } from '@test/concurrency';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import { esmImport } from '../../common/utils/esm-import';
import { RedisKeys } from '../../common/redis/redis-keys';
import type { PrismaService } from '../../common/database/prisma.service';
import type { CsrfService } from '../../common/security/csrf.service';
import type { AuditService } from '../audit/audit.service';
import type { EventsService } from '../events/events.service';
import { SessionRevocationService } from '../events/session-revocation.service';
import type { UserService } from '../user/user.service';
import { LockoutRepository } from './repositories/lockout.repository';
import type { AuthSharedService } from './services/auth-shared.service';
import { LockoutService } from './services/lockout.service';
import { LoginService } from './services/login.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import type { TwoFactorChallengeService } from './services/two-factor-challenge.service';

/** The 5-attempt budget under test (LockoutService MAX_FAILED_ATTEMPTS). */
const BUDGET = 5;
/** More callers than the budget, all released at the same instant. */
const BURST = 8;

const ctx = { ip: '203.0.113.11', userAgent: 'iso' };
const req = {} as Request;
const res = {} as Response;

/** Test-only credentials, never a real secret. */
const REAL_PASSWORD = 'owner-chose-this-1';
const WRONG_PASSWORD = 'not-the-password-2';

let unscoped: PrismaClient;
let prismaService: PrismaService;
let redis: Redis;

const createdTenantIds = new Set<string>();
const createdUserIds = new Set<string>();
const passwordService = new PasswordService();

const buildSubject = () => {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const lockout = new LockoutService(
    new LockoutRepository(prismaService),
    audit as unknown as AuditService,
    redis,
  );
  const sessionService = new SessionService(redis);
  const verify = jest.spyOn(passwordService, 'verify');

  /**
   * The credential finder, reading the row exactly as UserService does: the
   * CURRENT `lockedUntil`, so the lock check sees whatever the racing failures
   * have committed by the time this request started.
   */
  const userService = {
    findCredentialByEmail: (email: string) =>
      unscoped.user.findFirst({
        where: { email, deletedAt: null },
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          tenantId: true,
          emailVerified: true,
          createdAt: true,
          passwordHash: true,
          lockedUntil: true,
          membershipEndedAt: true,
        },
      }),
  } as unknown as UserService;

  // The per-IP limiter and Turnstile are envelopes around this claim, not part
  // of it: a burst from one address would be refused at 10 before the budget
  // was ever reached, and the issue is about the attacker who has neither.
  const shared = {
    enforceAuthRateLimit: jest.fn().mockResolvedValue(undefined),
    validateTurnstile: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthSharedService;

  const seam = {
    beginOrEstablish: jest.fn().mockResolvedValue({ kind: 'session', via: 'no_factor' }),
  } as unknown as TwoFactorChallengeService;

  const events = {
    disconnectSession: jest.fn(),
    disconnectUser: jest.fn(),
  } as unknown as EventsService;

  const login = new LoginService(
    passwordService,
    sessionService,
    lockout,
    userService,
    new SessionRevocationService(sessionService, events),
    events,
    { rotate: jest.fn() } as unknown as CsrfService,
    audit as unknown as AuditService,
    shared,
    seam,
  );

  const attempt = (email: string, password: string) =>
    login.login(
      { email, password, rememberMe: false, turnstileToken: 't' },
      ctx.ip,
      ctx.userAgent,
      req,
      res,
    );

  const auditRows = (action: string, reason?: string) =>
    audit.log.mock.calls
      .map(([row]) => row as { action: string; metadata?: { reason?: string } })
      .filter(
        (row) => row.action === action && (reason === undefined || row.metadata?.reason === reason),
      );

  return { login, lockout, attempt, verify, auditRows };
};

/** A live staff account with a real argon2 hash. */
const makeAccount = async (password: string) => {
  const uid = randomUUID();
  const tenant = await unscoped.tenant.create({ data: { name: `lab-${uid}`, slug: `lab-${uid}` } });
  createdTenantIds.add(tenant.id);
  const user = await unscoped.user.create({
    data: {
      email: `lab-${uid}@example.test`,
      tenantId: tenant.id,
      role: 'ADMIN',
      passwordHash: await passwordService.hash(password),
      emailVerified: true,
    },
    select: { id: true, email: true },
  });
  createdUserIds.add(user.id);
  return user;
};

const lockoutRow = (userId: string) =>
  unscoped.user.findFirstOrThrow({
    where: { id: userId },
    select: { failedAttempts: true, lockoutCount: true, lockedUntil: true },
  });

/** How many of `results` refused with ACCOUNT_LOCKED. */
const lockedRefusals = (results: PromiseSettledResult<unknown>[]): number =>
  results.filter(
    (result) =>
      result.status === 'rejected' &&
      (result.reason as { message?: string }).message === AppErrorCode.ACCOUNT_LOCKED,
  ).length;

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  const client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;
  prismaService = { client, unscoped } as unknown as PrismaService;

  const url = process.env.REDIS_URL;
  if (url === undefined) {
    throw new Error('REDIS_URL is unset; this spec needs a real Redis (see the file header).');
  }
  redis = new IORedis(url, { maxRetriesPerRequest: 1 });
  await redis.ping();
});

afterEach(async () => {
  jest.restoreAllMocks();
  // Only this spec's reservation keys, never a FLUSHDB: the lane's Redis index
  // is shared with every other isolation spec in the run.
  for (const userId of createdUserIds) {
    await redis.del(RedisKeys.rateLimit(`lockout:${userId}`));
  }
});

afterAll(async () => {
  if (createdUserIds.size > 0) {
    await unscoped.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
  }
  if (createdTenantIds.size > 0) {
    await unscoped.tenant.deleteMany({ where: { id: { in: [...createdTenantIds] } } });
  }
  await redis.quit();
});

describe('password lockout under a parallel burst', () => {
  it('control: a correct password signs in and clears both counters', async () => {
    const user = await makeAccount(REAL_PASSWORD);
    const { attempt, lockout } = buildSubject();

    // Spend part of the budget first, so there is something to clear.
    await expect(attempt(user.email, WRONG_PASSWORD)).rejects.toThrow();
    await expect(attempt(user.email, WRONG_PASSWORD)).rejects.toThrow();
    expect((await lockoutRow(user.id)).failedAttempts).toBe(2);

    await expect(attempt(user.email, REAL_PASSWORD)).resolves.toMatchObject({ status: 'ok' });

    // Both counters: the row is the history the tiers read, the Redis key is
    // the admission gate. Leaving either armed would refuse the person who has
    // just proved they own the account.
    expect(await lockoutRow(user.id)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    expect(await redis.exists(RedisKeys.rateLimit(`lockout:${user.id}`))).toBe(0);
    await expect(lockout.reserveAttempt(user.id)).resolves.toEqual({ withinBudget: true });
  });

  it('at most 5 of 8 concurrent wrong-password logins reach argon2', async () => {
    const user = await makeAccount(REAL_PASSWORD);
    const { attempt, verify, auditRows } = buildSubject();

    const results = await raceAll(BURST, () => attempt(user.email, WRONG_PASSWORD));

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    // The claim is the BOUND, not an exact split. Without the reservation all
    // eight are evaluated, because all eight read `lockedUntil` before any of
    // them has committed a failure. With it, some participants are refused by
    // the reservation and some by the row (a lock that committed before their
    // credential read landed), and which is which is a timing detail. So the
    // honest assertion is "no more than the budget", plus "the budget was
    // actually exercised" so the bound cannot be met by refusing everything.
    const evaluated = verify.mock.calls.length;
    expect(evaluated).toBeGreaterThan(0);
    expect(evaluated).toBeLessThanOrEqual(BUDGET);
    expect(auditRows(AUDIT_ACTIONS.AUTH_LOGIN_FAILURE, 'bad_password')).toHaveLength(evaluated);
    // And nothing escaped: every participant either paid for a guess or was
    // refused as locked. No third outcome, and nothing signed in.
    expect(lockedRefusals(results) + evaluated).toBe(BURST);
  });

  it('the burst still arms the progressive tier in the row', async () => {
    const user = await makeAccount(REAL_PASSWORD);
    const { attempt } = buildSubject();

    await raceAll(BURST, () => attempt(user.email, WRONG_PASSWORD));

    // Redis is the admission gate, the row is the record: the first tier is
    // five minutes, and `applyLockout` zeroes failedAttempts as it locks.
    const row = await lockoutRow(user.id);
    expect(row.lockoutCount).toBe(1);
    expect(row.failedAttempts).toBe(0);
    expect(row.lockedUntil).not.toBeNull();
  });

  it('counting never extends the window: the TTL is set once, on create', async () => {
    const user = await makeAccount(REAL_PASSWORD);
    const { lockout } = buildSubject();
    const key = RedisKeys.rateLimit(`lockout:${user.id}`);

    await lockout.reserveAttempt(user.id);
    const first = await redis.ttl(key);
    // Shorten it by hand, then reserve again: with a bare EXPIRE the second
    // reservation would push the deadline back out to the full window, and a
    // burst could keep its own window open indefinitely.
    await redis.expire(key, 30);
    await lockout.reserveAttempt(user.id);

    expect(first).toBeGreaterThan(30);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(30);
  });
});
