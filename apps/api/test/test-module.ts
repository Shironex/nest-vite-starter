/**
 * NestJS test module factory for the auth flow services.
 *
 * Each per-flow service (RegisterService, LoginService, etc.) takes 8–10
 * collaborators. Without a factory, every spec re-declares the same
 * `provide: X, useValue: {}` rows. With this factory, specs only mock the
 * collaborators they actually exercise.
 *
 * Usage:
 *   const { mocks, get } = await createAuthTestModule({
 *     extraProviders: [RegisterService],
 *     overrides: { user: { findByEmail: jest.fn().mockResolvedValue(null) } },
 *   });
 *   const service = get(RegisterService);
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Provider, Type } from '@nestjs/common';
import { PasswordService } from '../src/modules/auth/services/password.service';
import { SessionService } from '../src/modules/auth/services/session.service';
import { LockoutService } from '../src/modules/auth/services/lockout.service';
import { TokenService } from '../src/modules/auth/services/token.service';
import { AuthSharedService } from '../src/modules/auth/services/auth-shared.service';
import { ProvisioningService } from '../src/modules/auth/services/provisioning.service';
import { TurnstileService } from '../src/modules/auth/services/turnstile.service';
import { TwoFactorChallengeService } from '../src/modules/auth/services/two-factor-challenge.service';
import { TwoFactorPolicyService } from '../src/modules/auth/services/two-factor-policy.service';
import { TotpService } from '../src/modules/auth/services/totp.service';
import { StepUpService } from '../src/modules/auth/services/step-up.service';
import { TrustedDeviceService } from '../src/modules/auth/services/trusted-device.service';
import { EmailChangeService } from '../src/modules/auth/services/email-change.service';
import { SecondFactorRepository } from '../src/modules/auth/repositories/second-factor.repository';
import { TokenRepository } from '../src/modules/auth/repositories/token.repository';
import { LockoutRepository } from '../src/modules/auth/repositories/lockout.repository';
import { UserService } from '../src/modules/user/user.service';
import { UserRepository } from '../src/modules/user/user.repository';
import { MailService } from '../src/modules/mail/mail.service';
import { EventsService } from '../src/modules/events/events.service';
import { SessionRevocationService } from '../src/modules/events/session-revocation.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { CsrfService } from '../src/common/security/csrf.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { REDIS_CLIENT } from '../src/common/redis/redis.module';

export interface AuthMocks {
  password: jest.Mocked<Pick<PasswordService, 'hash' | 'verify'>>;
  session: {
    createSession: jest.Mock;
    validateSession: jest.Mock;
    deleteSession: jest.Mock;
    deleteAllUserSessions: jest.Mock;
    getUserSessions: jest.Mock;
    readEpoch: jest.Mock;
  };
  lockout: {
    isLocked: jest.Mock;
    isLockedFromUser: jest.Mock;
    /** Redis admission gate, reserved BEFORE argon2 (see LockoutService). */
    reserveAttempt: jest.Mock;
    recordFailedAttempt: jest.Mock;
    resetAttempts: jest.Mock;
    adminUnlock: jest.Mock;
  };
  token: {
    createVerificationToken: jest.Mock;
    createPasswordResetToken: jest.Mock;
    validateToken: jest.Mock;
    invalidateUserTokens: jest.Mock;
  };
  user: {
    normalizeEmail: jest.Mock;
    isDisposableEmail: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
    findCredentialByEmail: jest.Mock;
    findCredentialById: jest.Mock;
    findPasswordResetEligibility: jest.Mock;
    create: jest.Mock;
    updatePassword: jest.Mock;
    verifyEmail: jest.Mock;
    listUsers: jest.Mock;
    getProfile: jest.Mock;
    updateAvatar: jest.Mock;
    softDeleteById: jest.Mock;
    softDeleteSelfKeepingOneAdmin: jest.Mock;
    assertDeletionLeavesNobodyStranded: jest.Mock;
    revokeAuthState: jest.Mock;
    adminDeleteUser: jest.Mock;
  };
  userRepository: {
    findById: jest.Mock;
    findByEmail: jest.Mock;
    findCredentialById: jest.Mock;
    findCredentialByEmail: jest.Mock;
    create: jest.Mock;
    getProfile: jest.Mock;
    listUsers: jest.Mock;
    verifyEmail: jest.Mock;
    updateAvatar: jest.Mock;
    updateAvatarIfCurrent: jest.Mock;
    updatePassword: jest.Mock;
    softDelete: jest.Mock;
    findRoleScoped: jest.Mock;
    softDeleteScopedNonAdmin: jest.Mock;
  };
  mail: {
    sendVerificationEmail: jest.Mock;
    sendWelcomeEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
    sendPasswordChangedEmail: jest.Mock;
    sendTwoFactorEnabledEmail: jest.Mock;
    sendTwoFactorDisabledEmail: jest.Mock;
    sendRecoveryCodeUsedEmail: jest.Mock;
    sendTwoFactorAdminResetEmail: jest.Mock;
    sendTwoFactorPolicyAnnouncementEmail: jest.Mock;
    sendTwoFactorEnforcementReminderEmail: jest.Mock;
    sendTwoFactorSupportResetContestEmail: jest.Mock;
    sendEmailChangeVerificationEmail: jest.Mock;
    sendEmailChangeRequestedEmail: jest.Mock;
  };
  events: {
    notifyUser: jest.Mock;
    disconnectUser: jest.Mock;
    disconnectSession: jest.Mock;
    setServer: jest.Mock;
  };
  sessionRevocation: {
    revokeAllAndDisconnect: jest.Mock;
  };
  emailChange: {
    requestEmailChange: jest.Mock;
    confirmEmailChange: jest.Mock;
    invalidatePending: jest.Mock;
  };
  audit: {
    log: jest.Mock;
  };
  shared: {
    appUrl: string;
    setSessionCookie: jest.Mock;
    clearSessionCookie: jest.Mock;
    setAuthCookie: jest.Mock;
    clearAuthCookie: jest.Mock;
    establishSession: jest.Mock;
    validateTurnstile: jest.Mock;
    enforceAuthRateLimit: jest.Mock;
    enforceRateLimit: jest.Mock;
  };
  csrf: {
    protect: jest.Mock;
    generate: jest.Mock;
    rotate: jest.Mock;
    ensureSessionIdentifier: jest.Mock;
  };
  turnstile: {
    validate: jest.Mock;
  };
  twoFactorChallenge: {
    beginOrEstablish: jest.Mock;
    verifyChallenge: jest.Mock;
  };
  twoFactorPolicy: {
    isEnrollmentRequiredForTenant: jest.Mock;
    getTenantPolicy: jest.Mock;
    setTenantPolicy: jest.Mock;
    resetMemberTwoFactor: jest.Mock;
  };
  totp: {
    generateSecret: jest.Mock;
    encryptSecret: jest.Mock;
    verify: jest.Mock;
  };
  trustedDevice: {
    isTrusted: jest.Mock;
    trust: jest.Mock;
    count: jest.Mock;
    revokeAll: jest.Mock;
  };
  secondFactor: {
    findActiveNonRecovery: jest.Mock;
    findActiveTotp: jest.Mock;
    findPendingTotp: jest.Mock;
    deletePendingTotp: jest.Mock;
    createPendingTotp: jest.Mock;
    activateTotp: jest.Mock;
    createRecoveryCodes: jest.Mock;
    deleteRecoveryCodes: jest.Mock;
    deleteAllForUser: jest.Mock;
    countUnusedRecoveryCodes: jest.Mock;
    redeemRecoveryCode: jest.Mock;
    touchLastUsed: jest.Mock;
  };
  tokenRepo: {
    create: jest.Mock;
    findByHashedToken: jest.Mock;
    deleteById: jest.Mock;
    consumeById: jest.Mock;
    deleteUserTokensByType: jest.Mock;
  };
  lockoutRepo: {
    getLockoutState: jest.Mock;
    incrementFailedAttempts: jest.Mock;
    applyLockout: jest.Mock;
    resetAttempts: jest.Mock;
    fullReset: jest.Mock;
  };
  prisma: PrismaServiceMock;
  config: { get: jest.Mock };
  redis: RedisMock;
}

export type AuthMocksOverrides = {
  [K in keyof AuthMocks]?: Partial<AuthMocks[K]>;
};

/**
 * Mock PrismaService that exposes a `client` with stubbed delegates.
 * Each delegate is a `jest.fn()` so tests can `mockResolvedValue` what they need.
 *
 * `client.$transaction` defaults to invoking the callback with the same `client`
 * (so `tx.user.create` resolves through the same mocks as outside the tx).
 * Use `mockPrismaTransaction(prisma, customTx)` if a spec needs a distinct tx.
 */
export interface PrismaServiceMock {
  client: {
    $transaction: jest.Mock;
    user: PrismaUserDelegateMock;
    token: PrismaTokenDelegateMock;
    secondFactor: PrismaSecondFactorDelegateMock;
    auditLog: { create: jest.Mock };
    tenant: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    permission: { findMany: jest.Mock };
    rolePermission: { findMany: jest.Mock; createMany: jest.Mock };
    // The platform Workspace module's model.
    workspace: PrismaHrDelegateMock;
  };
  /**
   * The raw, UNSCOPED client (`prismaService.unscoped`), exposed so specs for
   * cross-tenant system jobs (e.g. the two-factor-enforcement sweep) can drive
   * its delegates. Kept minimal: the models those jobs actually read.
   */
  unscoped: {
    twoFactorPolicy: PrismaTwoFactorPolicyDelegateMock;
    user: PrismaUserDelegateMock;
    secondFactor: PrismaSecondFactorDelegateMock;
    tenant: PrismaHrDelegateMock;
  };
}

export interface PrismaUserDelegateMock {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  findUniqueOrThrow: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  delete: jest.Mock;
  count: jest.Mock;
}

export interface PrismaTokenDelegateMock {
  findFirst: jest.Mock;
  create: jest.Mock;
  delete: jest.Mock;
  deleteMany: jest.Mock;
  count: jest.Mock;
}

/** Delegate shape shared by the tenant-owned models the specs drive. */
export interface PrismaHrDelegateMock {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  count: jest.Mock;
}

export interface PrismaSecondFactorDelegateMock {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  deleteMany: jest.Mock;
  count: jest.Mock;
}

export interface PrismaTwoFactorPolicyDelegateMock {
  findUnique: jest.Mock;
  findMany: jest.Mock;
  upsert: jest.Mock;
}

const buildPrismaUserDelegate = (): PrismaUserDelegateMock => ({
  findFirst: jest.fn(),
  findMany: jest.fn(),
  findUnique: jest.fn(),
  findUniqueOrThrow: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
});

const buildPrismaTokenDelegate = (): PrismaTokenDelegateMock => ({
  findFirst: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  count: jest.fn(),
});

const buildPrismaSecondFactorDelegate = (): PrismaSecondFactorDelegateMock => ({
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  createMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
  count: jest.fn(),
});

const buildPrismaHrDelegate = (): PrismaHrDelegateMock => ({
  findFirst: jest.fn(),
  findMany: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  count: jest.fn(),
});

const buildPrismaTwoFactorPolicyDelegate = (): PrismaTwoFactorPolicyDelegateMock => ({
  findUnique: jest.fn(),
  findMany: jest.fn(),
  upsert: jest.fn(),
});

export const buildPrismaMock = (): PrismaServiceMock => {
  const client = {
    $transaction: jest.fn(),
    user: buildPrismaUserDelegate(),
    token: buildPrismaTokenDelegate(),
    secondFactor: buildPrismaSecondFactorDelegate(),
    auditLog: { create: jest.fn() },
    tenant: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    permission: { findMany: jest.fn() },
    rolePermission: { findMany: jest.fn(), createMany: jest.fn() },
    workspace: buildPrismaHrDelegate(),
  };
  // Default: $transaction(cb) → cb(client). Specs that need a separate tx
  // object should call `mockPrismaTransaction(prisma, txMock)`.
  client.$transaction.mockImplementation(async (cb: (tx: typeof client) => unknown) => cb(client));
  // The unscoped client (cross-tenant escape hatch): its own delegate stubs so a
  // system-job spec asserting `prisma.unscoped.*` never aliases the scoped ones.
  const unscoped = {
    twoFactorPolicy: buildPrismaTwoFactorPolicyDelegate(),
    user: buildPrismaUserDelegate(),
    secondFactor: buildPrismaSecondFactorDelegate(),
    // The tenant list the cross-tenant sweeps iterate.
    tenant: buildPrismaHrDelegate(),
  };
  return { client, unscoped };
};

/**
 * Wire `prisma.client.$transaction` to invoke the callback with the supplied
 * `tx` object, the same pattern Prisma uses at runtime. The `tx` object
 * should have whichever delegates the callback touches (`user`, `token`,
 * `auditLog`, etc.) wired with jest.fn()s under each method.
 *
 * Returns the tx mock so callers can chain `.create.mockResolvedValue(...)`.
 */
export const mockPrismaTransaction = <T extends object>(prisma: PrismaServiceMock, tx: T): T => {
  prisma.client.$transaction.mockImplementation(async (cb: (tx: T) => unknown) => cb(tx));
  return tx;
};

/** Build a tx object with the standard auth-flow delegates wired. */
export const buildPrismaTx = () => ({
  user: buildPrismaUserDelegate(),
  token: buildPrismaTokenDelegate(),
  auditLog: { create: jest.fn() },
  tenant: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  permission: { findMany: jest.fn() },
  rolePermission: { findMany: jest.fn(), createMany: jest.fn() },
});

/**
 * Build a tx object with the Workspace delegate wired. Separate from
 * `buildPrismaTx` because these transactions touch a disjoint set of models
 * and mixing the two would let a spec silently assert against a delegate its
 * subject never uses.
 */
export const buildPrismaHrTx = () => ({
  workspace: buildPrismaHrDelegate(),
});

/**
 * Minimal ioredis surface our services touch. Each method is a jest.fn so
 * specs can `mockResolvedValue([])` etc. For SessionService tests that need
 * full SET/STRING semantics, use an `ioredis-mock` instance instead.
 *
 * `multi`/`pipeline` return a self-chaining command builder whose queued
 * calls are recorded on the returned mock; `exec` resolves to `[]` by
 * default; override per spec to shape `[error, reply]` tuples.
 */
export interface RedisMock {
  get: jest.Mock;
  set: jest.Mock;
  setex: jest.Mock;
  del: jest.Mock;
  getdel: jest.Mock;
  ttl: jest.Mock;
  expire: jest.Mock;
  incr: jest.Mock;
  mget: jest.Mock;
  sadd: jest.Mock;
  srem: jest.Mock;
  smembers: jest.Mock;
  scard: jest.Mock;
  multi: jest.Mock;
  pipeline: jest.Mock;
}

/** Chainable MULTI/PIPELINE stub: every command returns the chain; `exec` resolves. */
export interface RedisChainMock {
  incr: jest.Mock;
  expire: jest.Mock;
  setex: jest.Mock;
  sadd: jest.Mock;
  srem: jest.Mock;
  del: jest.Mock;
  set: jest.Mock;
  exec: jest.Mock;
}

export const buildRedisChainMock = (): RedisChainMock => {
  const chain = {} as RedisChainMock;
  chain.incr = jest.fn().mockReturnValue(chain);
  chain.expire = jest.fn().mockReturnValue(chain);
  chain.setex = jest.fn().mockReturnValue(chain);
  chain.sadd = jest.fn().mockReturnValue(chain);
  chain.srem = jest.fn().mockReturnValue(chain);
  chain.del = jest.fn().mockReturnValue(chain);
  chain.set = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue([]);
  return chain;
};

export const buildRedisMock = (): RedisMock => ({
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  getdel: jest.fn(),
  ttl: jest.fn(),
  expire: jest.fn(),
  incr: jest.fn(),
  mget: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
  scard: jest.fn(),
  multi: jest.fn(() => buildRedisChainMock()),
  pipeline: jest.fn(() => buildRedisChainMock()),
});

const buildConfigMock = (defaults: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    TURNSTILE_SECRET_KEY: 'test-secret',
    CSRF_SECRET: 'test-csrf-secret',
    REDIS_URL: 'redis://localhost:6379',
    ...defaults,
  };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const v = values[key];
      if (v === undefined) throw new Error(`Missing config: ${key}`);
      return v;
    }),
  };
};

const buildAuthMocks = (
  overrides: AuthMocksOverrides = {},
  configDefaults: Record<string, string> = {},
): AuthMocks => {
  const base: AuthMocks = {
    password: {
      hash: jest.fn(),
      verify: jest.fn(),
    } as unknown as AuthMocks['password'],
    session: {
      createSession: jest.fn(),
      validateSession: jest.fn(),
      deleteSession: jest.fn(),
      deleteAllUserSessions: jest.fn(),
      getUserSessions: jest.fn(),
      // Session-epoch fence: default to "never revoked" so only the specs that
      // exercise the race have to think about it.
      readEpoch: jest.fn().mockResolvedValue(0),
    },
    lockout: {
      isLocked: jest.fn(),
      // Sync evaluation of an already-loaded row; default to "not locked" so
      // specs only override it when exercising the locked branch.
      isLockedFromUser: jest.fn().mockReturnValue({ locked: false }),
      // Default to "inside the budget", so only the specs that exercise the
      // burst have to think about the admission gate.
      reserveAttempt: jest.fn().mockResolvedValue({ withinBudget: true }),
      recordFailedAttempt: jest.fn(),
      resetAttempts: jest.fn(),
      adminUnlock: jest.fn(),
    },
    token: {
      createVerificationToken: jest.fn(),
      createPasswordResetToken: jest.fn(),
      validateToken: jest.fn(),
      invalidateUserTokens: jest.fn().mockResolvedValue(undefined),
    },
    user: {
      normalizeEmail: jest.fn((e: string) => e.trim().toLowerCase()),
      isDisposableEmail: jest.fn().mockResolvedValue(false),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      findCredentialByEmail: jest.fn(),
      findCredentialById: jest.fn(),
      // Defaults to eligible, so every existing reset spec keeps its meaning:
      // the two refusals this answers are states a spec has to arrange.
      findPasswordResetEligibility: jest.fn().mockResolvedValue({ membershipEnded: false }),
      create: jest.fn(),
      updatePassword: jest.fn(),
      verifyEmail: jest.fn(),
      listUsers: jest.fn(),
      getProfile: jest.fn(),
      updateAvatar: jest.fn(),
      softDeleteById: jest.fn().mockResolvedValue(1),
      // The self-service deletion, guard and write in one serialized act.
      // Permissive by default: a sole user deleting their own account strands
      // nobody, which is the only case that exists today.
      softDeleteSelfKeepingOneAdmin: jest.fn().mockResolvedValue(1),
      assertDeletionLeavesNobodyStranded: jest.fn().mockResolvedValue(undefined),
      revokeAuthState: jest.fn().mockResolvedValue(undefined),
      adminDeleteUser: jest.fn().mockResolvedValue(undefined),
    },
    userRepository: {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findCredentialById: jest.fn(),
      findCredentialByEmail: jest.fn(),
      create: jest.fn(),
      getProfile: jest.fn(),
      listUsers: jest.fn(),
      verifyEmail: jest.fn(),
      updateAvatar: jest.fn(),
      updateAvatarIfCurrent: jest.fn(),
      updatePassword: jest.fn(),
      softDelete: jest.fn(),
      findRoleScoped: jest.fn(),
      softDeleteScopedNonAdmin: jest.fn(),
    },
    mail: {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordChangedEmail: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorEnabledEmail: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorDisabledEmail: jest.fn().mockResolvedValue(undefined),
      sendRecoveryCodeUsedEmail: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorAdminResetEmail: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorPolicyAnnouncementEmail: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorEnforcementReminderEmail: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorSupportResetContestEmail: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeRequestedEmail: jest.fn().mockResolvedValue(undefined),
    },
    events: {
      notifyUser: jest.fn(),
      disconnectUser: jest.fn(),
      disconnectSession: jest.fn(),
      setServer: jest.fn(),
    },
    sessionRevocation: {
      revokeAllAndDisconnect: jest.fn().mockResolvedValue(undefined),
    },
    emailChange: {
      requestEmailChange: jest.fn().mockResolvedValue(undefined),
      confirmEmailChange: jest.fn().mockResolvedValue(undefined),
      invalidatePending: jest.fn().mockResolvedValue(undefined),
    },
    audit: {
      log: jest.fn().mockResolvedValue(undefined),
    },
    shared: {
      appUrl: configDefaults.APP_URL ?? 'http://localhost:3000',
      setSessionCookie: jest.fn(),
      clearSessionCookie: jest.fn(),
      setAuthCookie: jest.fn(),
      clearAuthCookie: jest.fn(),
      establishSession: jest.fn().mockResolvedValue({
        token: 'session-token',
        expiresAt: new Date(Date.now() + 60_000),
      }),
      validateTurnstile: jest.fn().mockResolvedValue(undefined),
      enforceAuthRateLimit: jest.fn().mockResolvedValue(undefined),
      enforceRateLimit: jest.fn().mockResolvedValue(undefined),
    },
    csrf: {
      protect: jest.fn(),
      generate: jest.fn().mockReturnValue('csrf-token'),
      rotate: jest.fn().mockReturnValue('rotated-csrf-token'),
      ensureSessionIdentifier: jest.fn(),
    },
    turnstile: {
      validate: jest.fn().mockResolvedValue(true),
    },
    twoFactorChallenge: {
      // Default: no active factor, session established directly.
      beginOrEstablish: jest.fn().mockResolvedValue({
        kind: 'session',
        expiresAt: new Date(Date.now() + 60_000),
        via: 'no_factor',
      }),
      verifyChallenge: jest.fn(),
    },
    twoFactorPolicy: {
      // Default: no tenant policy in force, so enforcement gates stay inert
      // unless a spec opts in (mirrors the secondFactor "no factors" default).
      isEnrollmentRequiredForTenant: jest.fn().mockResolvedValue(false),
      getTenantPolicy: jest
        .fn()
        .mockResolvedValue({ required: false, graceEndsAt: null, enforced: false }),
      setTenantPolicy: jest
        .fn()
        .mockResolvedValue({ required: false, graceEndsAt: null, enforced: false }),
      resetMemberTwoFactor: jest.fn().mockResolvedValue(undefined),
    },
    totp: {
      generateSecret: jest
        .fn()
        .mockReturnValue({ secretBase32: 'SECRET', otpauthUri: 'otpauth://x' }),
      encryptSecret: jest.fn().mockReturnValue('enc'),
      verify: jest.fn().mockResolvedValue(false),
    },
    trustedDevice: {
      // Default: this browser is not trusted, so logins fall through to the challenge.
      isTrusted: jest.fn().mockResolvedValue(false),
      trust: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
      revokeAll: jest.fn().mockResolvedValue(undefined),
    },
    secondFactor: {
      // Default: no factors, so the 2FA gates are inert unless a spec opts in.
      findActiveNonRecovery: jest.fn().mockResolvedValue(null),
      findActiveTotp: jest.fn().mockResolvedValue(null),
      findPendingTotp: jest.fn().mockResolvedValue(null),
      deletePendingTotp: jest.fn().mockResolvedValue(undefined),
      createPendingTotp: jest.fn().mockResolvedValue({ id: 'sf-1' }),
      activateTotp: jest.fn().mockResolvedValue({ id: 'sf-1' }),
      createRecoveryCodes: jest.fn().mockResolvedValue({ count: 10 }),
      deleteRecoveryCodes: jest.fn().mockResolvedValue({ count: 0 }),
      deleteAllForUser: jest.fn().mockResolvedValue({ count: 1 }),
      countUnusedRecoveryCodes: jest.fn().mockResolvedValue(0),
      redeemRecoveryCode: jest.fn().mockResolvedValue(false),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
    },
    tokenRepo: {
      create: jest.fn(),
      findByHashedToken: jest.fn(),
      deleteById: jest.fn(),
      consumeById: jest.fn(),
      deleteUserTokensByType: jest.fn(),
    },
    lockoutRepo: {
      getLockoutState: jest.fn(),
      incrementFailedAttempts: jest.fn(),
      applyLockout: jest.fn(),
      resetAttempts: jest.fn(),
      fullReset: jest.fn(),
    },
    prisma: buildPrismaMock(),
    config: buildConfigMock(configDefaults),
    redis: buildRedisMock(),
  };

  // Shallow-merge overrides onto each top-level key.
  for (const key of Object.keys(overrides) as (keyof AuthMocks)[]) {
    Object.assign(base[key] as object, overrides[key]);
  }
  return base;
};

export interface CreateAuthTestModuleOptions {
  /** Service(s) under test: added as providers and resolvable via `module.get`. */
  providers?: Provider[];
  /** Per-collaborator overrides: replaces specific methods on the default mocks. */
  overrides?: AuthMocksOverrides;
  /** ConfigService.get(key) defaults. */
  configDefaults?: Record<string, string>;
  /**
   * Use a real `ioredis-mock` for the REDIS_CLIENT instead of the per-method
   * jest.fn stubs. Set this when the service-under-test exercises real Redis
   * semantics (e.g. SessionService).
   */
  realRedisMock?: import('ioredis').Redis | object;
}

export interface AuthTestContext {
  module: TestingModule;
  mocks: AuthMocks;
  get: <T>(token: Type<T> | string | symbol) => T;
}

export const createAuthTestModule = async (
  options: CreateAuthTestModuleOptions = {},
): Promise<AuthTestContext> => {
  const mocks = buildAuthMocks(options.overrides ?? {}, options.configDefaults ?? {});

  const moduleBuilder = Test.createTestingModule({
    // Default mocks first, then the service(s) under test. NestJS resolves a
    // duplicated token last-wins, so a real service passed in `options.providers`
    // (e.g. TwoFactorChallengeService in its own spec) overrides the default mock
    // of the same token, while every spec that does NOT re-provide a token keeps
    // the default mock.
    providers: [
      { provide: PasswordService, useValue: mocks.password },
      { provide: SessionService, useValue: mocks.session },
      { provide: LockoutService, useValue: mocks.lockout },
      { provide: TokenService, useValue: mocks.token },
      { provide: UserService, useValue: mocks.user },
      { provide: UserRepository, useValue: mocks.userRepository },
      { provide: MailService, useValue: mocks.mail },
      { provide: EventsService, useValue: mocks.events },
      { provide: SessionRevocationService, useValue: mocks.sessionRevocation },
      { provide: EmailChangeService, useValue: mocks.emailChange },
      { provide: AuditService, useValue: mocks.audit },
      { provide: AuthSharedService, useValue: mocks.shared },
      { provide: CsrfService, useValue: mocks.csrf },
      { provide: TurnstileService, useValue: mocks.turnstile },
      { provide: TwoFactorChallengeService, useValue: mocks.twoFactorChallenge },
      { provide: TwoFactorPolicyService, useValue: mocks.twoFactorPolicy },
      { provide: TotpService, useValue: mocks.totp },
      { provide: TrustedDeviceService, useValue: mocks.trustedDevice },
      { provide: SecondFactorRepository, useValue: mocks.secondFactor },
      { provide: TokenRepository, useValue: mocks.tokenRepo },
      { provide: LockoutRepository, useValue: mocks.lockoutRepo },
      { provide: PrismaService, useValue: mocks.prisma },
      // ProvisioningService is provided REAL, not mocked: it owns nothing but
      // the organization+owner transaction, which it runs through the mocked
      // PrismaService and TokenService above. A spec asserting on
      // `mocks.prisma.client.$transaction` / `tx.tenant.create` therefore sees
      // the same calls whether the caller inlines the transaction or delegates
      // to this service.
      ProvisioningService,
      // StepUpService is provided REAL for the same reason. It owns nothing but
      // the second-factor gate sequence, which it runs entirely through the
      // mocked SecondFactorRepository, TotpService, AuthSharedService and
      // AuditService above, so a spec asserting on `mocks.secondFactor.*`,
      // `mocks.totp.verify` or the AUTH_2FA_CHALLENGE_FAILURE audit row sees
      // the same calls whether its service inlines the gate or delegates here.
      StepUpService,
      { provide: ConfigService, useValue: mocks.config },
      { provide: REDIS_CLIENT, useValue: options.realRedisMock ?? mocks.redis },
      ...(options.providers ?? []),
    ],
  });

  const module = await moduleBuilder.compile();
  return {
    module,
    mocks,
    get: <T>(token: Type<T> | string | symbol) => module.get<T>(token as Type<T>),
  };
};
