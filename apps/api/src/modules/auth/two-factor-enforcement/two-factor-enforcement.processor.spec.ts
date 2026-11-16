import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { buildPrismaMock } from '@test/test-module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { cronSweepFailuresTotal, twoFactorEnforcedTotal } from '../../metrics/metrics.registry';
import { TWO_FACTOR_ENFORCED_MARKER_TTL_SECONDS } from '../auth.constants';
import { TwoFactorEnforcementProcessor } from './two-factor-enforcement.processor';
import {
  TWO_FACTOR_ENFORCEMENT_JOB_NAMES,
  TWO_FACTOR_ENFORCEMENT_REMINDER_WINDOW_MS,
} from './two-factor-enforcement.constants';

// Fix the wall clock so the sweep's `asOf` (and the derived 24h reminder window)
// are exact, deterministic Dates the `where`-clause assertions can compare.
const FIXED_NOW_ISO = '2026-07-19T09:00:00.000Z';
jest.mock('../../../common/clock', () => ({
  now: () => new Date('2026-07-19T09:00:00.000Z'),
  nowMs: () => new Date('2026-07-19T09:00:00.000Z').getTime(),
  nowIso: () => '2026-07-19T09:00:00.000Z',
}));

const ASOF = new Date(FIXED_NOW_ISO);
const WINDOW_END = new Date(ASOF.getTime() + TWO_FACTOR_ENFORCEMENT_REMINDER_WINDOW_MS);
// A grace deadline already in the past, used by the deadline-pass policy mocks so
// the enforce loop reaches its members (a null graceEndsAt is structurally skipped).
const EXPIRED_GRACE = new Date(ASOF.getTime() - 60 * 60 * 1000);

const makeJob = (name: string, data: unknown = {}, id: string | null = 'sweep-1'): Job =>
  ({ name, data, id: id ?? undefined, attemptsMade: 0, opts: { attempts: 1 } }) as Job;

const runSweepJob = (processor: TwoFactorEnforcementProcessor) =>
  processor.processJob(
    makeJob(TWO_FACTOR_ENFORCEMENT_JOB_NAMES.SWEEP, { _ctx: { requestId: 'r' } }),
  );

const buildSubject = () => {
  const prisma = buildPrismaMock();
  // Safe defaults: both twoFactorPolicy.findMany passes and user.findMany return
  // empty, so a test only overrides the pass it exercises.
  prisma.unscoped.twoFactorPolicy.findMany.mockResolvedValue([]);
  prisma.unscoped.user.findMany.mockResolvedValue([]);

  const sessionRevocation = { revokeAllAndDisconnect: jest.fn().mockResolvedValue(undefined) };
  const trustedDevice = { revokeAll: jest.fn().mockResolvedValue(undefined) };
  const mail = { sendTwoFactorEnforcementReminderEmail: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // Default: the marker is absent, so SET NX claims it ('OK') and the member is
  // enforced. A test overrides this with `null` to simulate an already-claimed marker.
  const redis = { set: jest.fn().mockResolvedValue('OK') };

  const processor = new TwoFactorEnforcementProcessor(
    prisma as unknown as ConstructorParameters<typeof TwoFactorEnforcementProcessor>[0],
    sessionRevocation as unknown as ConstructorParameters<typeof TwoFactorEnforcementProcessor>[1],
    trustedDevice as unknown as ConstructorParameters<typeof TwoFactorEnforcementProcessor>[2],
    mail as unknown as ConstructorParameters<typeof TwoFactorEnforcementProcessor>[3],
    audit as unknown as ConstructorParameters<typeof TwoFactorEnforcementProcessor>[4],
    redis as unknown as ConstructorParameters<typeof TwoFactorEnforcementProcessor>[5],
  );
  return { processor, prisma, sessionRevocation, trustedDevice, mail, audit, redis };
};

describe('TwoFactorEnforcementProcessor', () => {
  let enforcedIncSpy: jest.SpyInstance;
  let failureIncSpy: jest.SpyInstance;

  beforeEach(() => {
    enforcedIncSpy = jest.spyOn(twoFactorEnforcedTotal, 'inc').mockImplementation(() => undefined);
    failureIncSpy = jest.spyOn(cronSweepFailuresTotal, 'inc').mockImplementation(() => undefined);
  });

  afterEach(() => {
    enforcedIncSpy.mockRestore();
    failureIncSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('deadline sweep (grace already passed)', () => {
    it('selects only required policies whose grace deadline is in the past', async () => {
      const { processor, prisma } = buildSubject();

      await runSweepJob(processor);

      // First twoFactorPolicy.findMany call = the deadline pass.
      expect(prisma.unscoped.twoFactorPolicy.findMany.mock.calls[0]![0]).toEqual({
        where: { required: true, graceEndsAt: { lt: ASOF } },
        select: { tenantId: true, graceEndsAt: true },
      });
    });

    it('filters members to the NON-enrolled via the derived "2FA enabled" predicate', async () => {
      const { processor, prisma } = buildSubject();
      prisma.unscoped.twoFactorPolicy.findMany
        .mockResolvedValueOnce([{ tenantId: 't-1', graceEndsAt: EXPIRED_GRACE }])
        .mockResolvedValueOnce([]);
      prisma.unscoped.user.findMany.mockResolvedValueOnce([]);

      await runSweepJob(processor);

      expect(prisma.unscoped.user.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 't-1',
          deletedAt: null,
          secondFactors: {
            none: { status: 'ACTIVE', type: { not: 'RECOVERY_CODE' } },
          },
        },
        select: { id: true, email: true },
      });
    });

    it('revokes sessions + trusted devices and audits AUTH_2FA_ENFORCED per non-enrolled member', async () => {
      const { processor, prisma, sessionRevocation, trustedDevice, audit, mail } = buildSubject();
      prisma.unscoped.twoFactorPolicy.findMany
        .mockResolvedValueOnce([{ tenantId: 't-1', graceEndsAt: EXPIRED_GRACE }])
        .mockResolvedValueOnce([]);
      prisma.unscoped.user.findMany.mockResolvedValueOnce([
        { id: 'u-1', email: 'a@example.com' },
        { id: 'u-2', email: 'b@example.com' },
      ]);

      await runSweepJob(processor);

      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-1');
      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-2');
      expect(trustedDevice.revokeAll).toHaveBeenCalledWith('u-1');
      expect(trustedDevice.revokeAll).toHaveBeenCalledWith('u-2');
      expect(audit.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.AUTH_2FA_ENFORCED,
        userId: 'u-1',
        tenantId: 't-1',
        targetType: 'User',
        targetId: 'u-1',
      });
      expect(enforcedIncSpy).toHaveBeenCalledTimes(2);
      // A grace-passed tenant is enforced, never merely reminded.
      expect(mail.sendTwoFactorEnforcementReminderEmail).not.toHaveBeenCalled();
    });

    it('enforces nobody when every member is already enrolled (empty member set)', async () => {
      const { processor, prisma, sessionRevocation, audit } = buildSubject();
      prisma.unscoped.twoFactorPolicy.findMany
        .mockResolvedValueOnce([{ tenantId: 't-1', graceEndsAt: EXPIRED_GRACE }])
        .mockResolvedValueOnce([]);
      prisma.unscoped.user.findMany.mockResolvedValueOnce([]);

      await runSweepJob(processor);

      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(enforcedIncSpy).not.toHaveBeenCalled();
    });

    it('claims a per-(member, grace window) marker and enforces when it is absent', async () => {
      const { processor, prisma, sessionRevocation, trustedDevice, audit, redis } = buildSubject();
      prisma.unscoped.twoFactorPolicy.findMany
        .mockResolvedValueOnce([{ tenantId: 't-1', graceEndsAt: EXPIRED_GRACE }])
        .mockResolvedValueOnce([]);
      prisma.unscoped.user.findMany.mockResolvedValueOnce([{ id: 'u-1', email: 'a@example.com' }]);
      // Default redis.set resolves 'OK' -> the marker was absent and is now claimed.

      await runSweepJob(processor);

      expect(redis.set).toHaveBeenCalledWith(
        RedisKeys.twoFactorEnforced('u-1', EXPIRED_GRACE.getTime()),
        '1',
        'EX',
        TWO_FACTOR_ENFORCED_MARKER_TTL_SECONDS,
        'NX',
      );
      expect(sessionRevocation.revokeAllAndDisconnect).toHaveBeenCalledWith('u-1');
      expect(trustedDevice.revokeAll).toHaveBeenCalledWith('u-1');
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(enforcedIncSpy).toHaveBeenCalledTimes(1);
    });

    it('skips revoke + audit + metric when the marker is already present (later tick)', async () => {
      const { processor, prisma, sessionRevocation, trustedDevice, audit, redis } = buildSubject();
      prisma.unscoped.twoFactorPolicy.findMany
        .mockResolvedValueOnce([{ tenantId: 't-1', graceEndsAt: EXPIRED_GRACE }])
        .mockResolvedValueOnce([]);
      prisma.unscoped.user.findMany.mockResolvedValueOnce([{ id: 'u-1', email: 'a@example.com' }]);
      // A null reply means SET NX lost: this member was already enforced this window.
      redis.set.mockResolvedValue(null);

      await runSweepJob(processor);

      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(trustedDevice.revokeAll).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(enforcedIncSpy).not.toHaveBeenCalled();
    });
  });

  describe('T-24h reminder sweep', () => {
    it('selects required policies whose grace ends within the next 24h (strictly after now)', async () => {
      const { processor, prisma } = buildSubject();

      await runSweepJob(processor);

      // Second twoFactorPolicy.findMany call = the reminder pass.
      const reminderCall = prisma.unscoped.twoFactorPolicy.findMany.mock.calls[1]![0];
      expect(reminderCall).toEqual({
        where: { required: true, graceEndsAt: { gt: ASOF, lte: WINDOW_END } },
        select: { tenantId: true, graceEndsAt: true },
      });
      // Upper bound is exactly 24h after now, and the deadline pass's `lt` is the
      // same instant as the reminder pass's `gt` (one `asOf` per sweep).
      expect(
        reminderCall.where.graceEndsAt.lte.getTime() - reminderCall.where.graceEndsAt.gt.getTime(),
      ).toBe(TWO_FACTOR_ENFORCEMENT_REMINDER_WINDOW_MS);
      const deadlineCall = prisma.unscoped.twoFactorPolicy.findMany.mock.calls[0]![0];
      expect(deadlineCall.where.graceEndsAt.lt).toEqual(reminderCall.where.graceEndsAt.gt);
    });

    it('emails each non-enrolled member the tenant deadline, without revoking anything', async () => {
      const { processor, prisma, mail, sessionRevocation, trustedDevice, audit } = buildSubject();
      const graceEndsAt = new Date(ASOF.getTime() + 12 * 60 * 60 * 1000);
      prisma.unscoped.twoFactorPolicy.findMany
        .mockResolvedValueOnce([]) // deadline pass: nothing expired
        .mockResolvedValueOnce([{ tenantId: 't-2', graceEndsAt }]);
      prisma.unscoped.user.findMany.mockResolvedValueOnce([{ id: 'u-9', email: 'c@example.com' }]);

      await runSweepJob(processor);

      expect(mail.sendTwoFactorEnforcementReminderEmail).toHaveBeenCalledWith(
        'c@example.com',
        graceEndsAt,
      );
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
      expect(trustedDevice.revokeAll).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('continues the fan-out when a single reminder enqueue fails', async () => {
      const { processor, prisma, mail } = buildSubject();
      const graceEndsAt = new Date(ASOF.getTime() + 60_000);
      prisma.unscoped.twoFactorPolicy.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ tenantId: 't-2', graceEndsAt }]);
      prisma.unscoped.user.findMany.mockResolvedValueOnce([
        { id: 'u-1', email: 'first@example.com' },
        { id: 'u-2', email: 'second@example.com' },
      ]);
      mail.sendTwoFactorEnforcementReminderEmail
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce(undefined);

      await expect(runSweepJob(processor)).resolves.toBeUndefined();

      expect(mail.sendTwoFactorEnforcementReminderEmail).toHaveBeenCalledTimes(2);
    });
  });

  describe('resilience contract', () => {
    it('never throws out of the sweep and counts a failure metric when a query rejects', async () => {
      const { processor, prisma, sessionRevocation } = buildSubject();
      prisma.unscoped.twoFactorPolicy.findMany.mockReset();
      prisma.unscoped.twoFactorPolicy.findMany.mockRejectedValue(new Error('db down'));

      await expect(runSweepJob(processor)).resolves.toBeUndefined();

      expect(failureIncSpy).toHaveBeenCalledWith({ sweep: 'two-factor-enforcement' });
      expect(sessionRevocation.revokeAllAndDisconnect).not.toHaveBeenCalled();
    });

    it('fails an unknown job name straight to the DLQ with UnrecoverableError', async () => {
      const { processor } = buildSubject();
      const failure = processor.processJob(makeJob('nope'));
      await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
      await expect(failure).rejects.toThrow(/Unknown two-factor-enforcement job name/);
    });
  });
});
