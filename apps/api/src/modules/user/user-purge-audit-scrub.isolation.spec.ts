/**
 * SCRUB ON PURGE, end to end, against the LIVE sandbox Postgres. Excluded from
 * the fast jest lane; runs via the integration config:
 *
 *   pnpm sandbox:up
 *   export DATABASE_URL="$(pnpm sandbox:inspect --lane-url=isolation | tail -n 1)"
 *   pnpm --filter @repo/api test:integration
 *
 * The claim under test: an audit row that carries a field declared in the audit
 * PII registry (AUDIT_PII_FIELDS, the list `observability/audit-pii-declared`
 * enforces) keeps that value while its user exists, and after the purge cron
 * erases the user the row SURVIVES with the value unrecoverable.
 *
 * The rows are not hand-built. The real EmailChangeService writes them through
 * the real AuditService (request, then confirm, from the mailed token), so the
 * payload shapes are the ones production writes: `metadata.newEmail` and
 * `before.email` / `after.email`. The real UserPurgeService then runs its real
 * sweep with the real AuditPiiScrubService. Only outbound and unrelated
 * collaborators are stubbed: mail, Redis (ioredis-mock), rate limits, step
 * up and session revocation.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { AUDIT_ACTIONS, AUDIT_PII_ERASED_VALUE } from '@repo/shared/audit';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import { esmImport } from '../../common/utils/esm-import';
import type { PrismaService } from '../../common/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditPiiScrubService } from '../audit/audit-pii-scrub.service';
import type { SessionService } from '../auth/services/session.service';
import type { MailService } from '../mail/mail.service';
import type { AuthSharedService } from '../auth/services/auth-shared.service';
import { EmailChangeService } from '../auth/services/email-change.service';
import type { StepUpService } from '../auth/services/step-up.service';
import type { TokenService } from '../auth/services/token.service';
import type { UserService } from './user.service';
import { UserPurgeService } from './user-purge.service';

let unscoped: PrismaClient;
let prismaService: PrismaService;

const createdTenantIds = new Set<string>();
const createdUserIds = new Set<string>();

const GRACE_DAYS = 30;
/**
 * Far older than any row another isolation spec soft-deletes (they all use
 * `new Date()`, inside the grace window), so this sweep can only ever select
 * users this file created, and they sort first under the sweep's cap.
 */
const LONG_AGO = new Date('2001-01-01T00:00:00Z');
/** Test-only placeholder, never a real hash. */
const FAKE_HASH = 'argon2-existing';

const makeTenant = async () => {
  const uid = randomUUID();
  const tenant = await unscoped.tenant.create({
    data: { name: `scrub-${uid}`, slug: `scrub-${uid}` },
  });
  createdTenantIds.add(tenant.id);
  return tenant;
};

const makeUser = async (tenantId: string) => {
  const uid = randomUUID();
  const user = await unscoped.user.create({
    data: {
      email: `scrub-old-${uid}@example.test`,
      tenantId,
      role: 'ADMIN',
      passwordHash: FAKE_HASH,
      emailVerified: true,
    },
    select: { id: true, email: true },
  });
  createdUserIds.add(user.id);
  return user;
};

/** The real email-change flow, writing through the real AuditService. */
const buildEmailChange = (audit: AuditService) => {
  const redis = new RedisMock() as unknown as Redis;
  const mailed: string[] = [];
  const userService = {
    findById: (id: string) => unscoped.user.findFirst({ where: { id, deletedAt: null } }),
    findByEmail: (email: string) => unscoped.user.findFirst({ where: { email } }),
    normalizeEmail: (email: string) => email.trim().toLowerCase(),
    isDisposableEmail: async () => false,
  };
  const mail = {
    sendEmailChangeVerificationEmail: jest.fn(async (_to: string, url: string) => {
      mailed.push(url);
    }),
    sendEmailChangeRequestedEmail: jest.fn().mockResolvedValue(undefined),
  };
  const shared = {
    enforceRateLimit: jest.fn().mockResolvedValue(undefined),
    enforceAuthRateLimit: jest.fn().mockResolvedValue(undefined),
    appUrl: 'http://app.test',
  };
  const service = new EmailChangeService(
    userService as unknown as UserService,
    mail as unknown as MailService,
    audit,
    { deleteAllUserSessions: jest.fn() } as unknown as SessionService,
    prismaService,
    { invalidateUserTokens: jest.fn() } as unknown as TokenService,
    { assertSecondFactor: jest.fn() } as unknown as StepUpService,
    shared as unknown as AuthSharedService,
    redis,
  );
  const lastToken = (): string => {
    const url = mailed.at(-1);
    const token = url === undefined ? null : new URL(url).searchParams.get('token');
    if (token === null) {
      throw new Error('no confirmation link was mailed');
    }
    return token;
  };
  return { service, lastToken };
};

const buildPurge = (audit: AuditService) =>
  new UserPurgeService(
    prismaService,
    { getOrThrow: () => GRACE_DAYS } as unknown as ConfigService,
    audit,
    new AuditPiiScrubService(prismaService),
  );

/** Every audit row this user is the subject of, as the audit trail stores it. */
const subjectRows = (userId: string) =>
  unscoped.auditLog.findMany({
    where: { targetType: 'User', targetId: userId },
    orderBy: { createdAt: 'asc' },
  });

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  const client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;
  prismaService = { client, unscoped } as unknown as PrismaService;
});

afterAll(async () => {
  if (createdUserIds.size > 0) {
    const ids = [...createdUserIds];
    await unscoped.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await unscoped.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (createdTenantIds.size > 0) {
    await unscoped.tenant.deleteMany({ where: { id: { in: [...createdTenantIds] } } });
  }
});

describe('scrub on purge (audit PII registry -> user purge)', () => {
  it('erases the declared email fields of a purged user and keeps every audit row', async () => {
    const audit = new AuditService(prismaService);
    const tenant = await makeTenant();
    const user = await makeUser(tenant.id);
    const oldEmail = user.email;
    const newEmail = `scrub-new-${randomUUID()}@example.test`;

    // 1. The real flow writes the PII-bearing rows.
    const emailChange = buildEmailChange(audit);
    await emailChange.service.requestEmailChange(
      user.id,
      newEmail,
      undefined,
      '203.0.113.7',
      'iso',
    );
    await emailChange.service.confirmEmailChange(emailChange.lastToken(), '203.0.113.7');

    const before = await subjectRows(user.id);
    const requested = before.find((r) => r.action === AUDIT_ACTIONS.AUTH_EMAIL_CHANGE_REQUESTED);
    const changed = before.find((r) => r.action === AUDIT_ACTIONS.AUTH_EMAIL_CHANGED);
    // While the user exists the raw addresses ARE there: the policy is scrub on
    // purge, not "never store", so this is the precondition, not a leak.
    expect(requested?.metadata).toEqual({ newEmail });
    expect(changed?.before).toEqual({ email: oldEmail });
    expect(changed?.after).toEqual({ email: newEmail });
    expect(requested?.userId).toBe(user.id);

    // 2. The user deletes their account and the grace window lapses.
    await unscoped.user.update({ where: { id: user.id }, data: { deletedAt: LONG_AGO } });

    // 3. The real cron sweep.
    const purged = await buildPurge(audit).sweep();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await unscoped.user.findUnique({ where: { id: user.id } })).toBeNull();

    // 4. Every row survives, keyed by the same id, with the same action.
    const after = await subjectRows(user.id);
    for (const row of before) {
      const survivor = after.find((r) => r.id === row.id);
      expect(survivor?.action).toBe(row.action);
      expect(survivor?.createdAt).toEqual(row.createdAt);
      // Still attributable to an actor id-wise via the target, not an address.
      expect(survivor?.targetId).toBe(user.id);
    }
    const requestedAfter = after.find((r) => r.id === requested?.id);
    const changedAfter = after.find((r) => r.id === changed?.id);
    expect(requestedAfter?.metadata).toEqual({ newEmail: AUDIT_PII_ERASED_VALUE });
    expect(changedAfter?.before).toEqual({ email: AUDIT_PII_ERASED_VALUE });
    expect(changedAfter?.after).toEqual({ email: AUDIT_PII_ERASED_VALUE });

    // 5. Unrecoverable: neither address appears ANYWHERE in the user's trail,
    // in any column, including the purge's own row.
    const serialized = JSON.stringify(after);
    expect(serialized).not.toContain(oldEmail);
    expect(serialized).not.toContain(newEmail);

    // 6. The purge's own trail records the erasure it did.
    const purgeRow = after.find((r) => r.action === AUDIT_ACTIONS.USER_ACCOUNT_PURGED);
    expect(purgeRow?.metadata).toEqual({
      deletedAt: LONG_AGO.toISOString(),
      auditRowsScrubbed: 2,
    });
  });

  it("leaves a surviving user's declared fields alone", async () => {
    const audit = new AuditService(prismaService);
    const tenant = await makeTenant();
    const doomed = await makeUser(tenant.id);
    const survivor = await makeUser(tenant.id);
    const survivorNew = `scrub-keep-${randomUUID()}@example.test`;

    const emailChange = buildEmailChange(audit);
    await emailChange.service.requestEmailChange(
      survivor.id,
      survivorNew,
      undefined,
      '203.0.113.8',
      'iso',
    );

    await unscoped.user.update({ where: { id: doomed.id }, data: { deletedAt: LONG_AGO } });
    await buildPurge(audit).sweep();

    const rows = await subjectRows(survivor.id);
    const requested = rows.find((r) => r.action === AUDIT_ACTIONS.AUTH_EMAIL_CHANGE_REQUESTED);
    expect(requested?.metadata).toEqual({ newEmail: survivorNew });
  });
});
