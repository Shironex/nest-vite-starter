import { Test } from '@nestjs/testing';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { LockoutService } from './lockout.service';
import { LockoutRepository } from '../repositories/lockout.repository';
import { AuditService } from '../../audit/audit.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { buildRedisChainMock, type RedisChainMock } from '@test/test-module';

type MockLockoutRepository = {
  getLockoutState: jest.Mock;
  getAdminUnlockState: jest.Mock;
  incrementFailedAttempts: jest.Mock;
  applyLockout: jest.Mock;
  resetAttempts: jest.Mock;
  fullReset: jest.Mock;
};

describe('LockoutService', () => {
  let service: LockoutService;
  let repo: MockLockoutRepository;
  let audit: { log: jest.Mock };
  let chain: RedisChainMock;
  let redis: { multi: jest.Mock; del: jest.Mock };

  /** Shape the reservation MULTI reply: [incr count, expire reply]. */
  const mockReservedCount = (count: number) => {
    chain.exec.mockResolvedValue([
      [null, count],
      [null, 1],
    ]);
  };

  beforeEach(async () => {
    repo = {
      getLockoutState: jest.fn(),
      getAdminUnlockState: jest.fn(),
      incrementFailedAttempts: jest.fn(),
      applyLockout: jest.fn(),
      resetAttempts: jest.fn(),
      fullReset: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    chain = buildRedisChainMock();
    redis = { multi: jest.fn(() => chain), del: jest.fn().mockResolvedValue(1) };
    mockReservedCount(1);

    const module = await Test.createTestingModule({
      providers: [
        LockoutService,
        { provide: LockoutRepository, useValue: repo },
        { provide: AuditService, useValue: audit },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get(LockoutService);
  });

  describe('isLocked', () => {
    it('should return locked: false when user has no lock', async () => {
      repo.getLockoutState.mockResolvedValue({ lockedUntil: null });
      const result = await service.isLocked('user-1');
      expect(result).toEqual({ locked: false });
    });

    it('should return locked: false when lock has expired', async () => {
      const pastDate = new Date(Date.now() - 60_000);
      repo.getLockoutState.mockResolvedValue({ lockedUntil: pastDate });
      const result = await service.isLocked('user-1');
      expect(result).toEqual({ locked: false });
    });

    it('should return locked: true when lockedUntil is in the future', async () => {
      const futureDate = new Date(Date.now() + 300_000);
      repo.getLockoutState.mockResolvedValue({ lockedUntil: futureDate });
      const result = await service.isLocked('user-1');
      expect(result).toEqual({ locked: true, lockedUntil: futureDate });
    });

    it('should throw NOT_FOUND when the user is missing or soft-deleted', async () => {
      repo.getLockoutState.mockResolvedValue(null);
      await expect(service.isLocked('ghost')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
    });
  });

  describe('isLockedFromUser', () => {
    it('returns locked: false for a row with no lock, without any repository read', () => {
      const result = service.isLockedFromUser({ lockedUntil: null });
      expect(result).toEqual({ locked: false });
      expect(repo.getLockoutState).not.toHaveBeenCalled();
    });

    it('returns locked: false when the row lock has expired', () => {
      const pastDate = new Date(Date.now() - 60_000);
      expect(service.isLockedFromUser({ lockedUntil: pastDate })).toEqual({ locked: false });
    });

    it('returns locked: true with lockedUntil when the row lock is in the future', () => {
      const futureDate = new Date(Date.now() + 300_000);
      expect(service.isLockedFromUser({ lockedUntil: futureDate })).toEqual({
        locked: true,
        lockedUntil: futureDate,
      });
    });
  });

  describe('recordFailedAttempt', () => {
    it('should return locked: false with remaining attempts when under threshold', async () => {
      repo.incrementFailedAttempts.mockResolvedValue({ failedAttempts: 2, lockoutCount: 0 });
      const result = await service.recordFailedAttempt('user-1');
      expect(result).toEqual({ locked: false, attemptsRemaining: 3 });
      expect(repo.applyLockout).not.toHaveBeenCalled();
    });

    it('should return attemptsRemaining: 1 at exactly 4 failed attempts (boundary)', async () => {
      repo.incrementFailedAttempts.mockResolvedValue({ failedAttempts: 4, lockoutCount: 0 });
      const result = await service.recordFailedAttempt('user-1');
      expect(result).toEqual({ locked: false, attemptsRemaining: 1 });
    });

    it('should lock the account after 5 failed attempts (1st lockout = 5 min)', async () => {
      repo.incrementFailedAttempts.mockResolvedValue({ failedAttempts: 5, lockoutCount: 0 });
      repo.applyLockout.mockResolvedValue(undefined);

      const result = await service.recordFailedAttempt('user-1');

      expect(result).toEqual({ locked: true, attemptsRemaining: 0 });
      expect(repo.applyLockout).toHaveBeenCalledTimes(1);
      const [userId, lockedUntil] = repo.applyLockout.mock.calls[0];
      expect(userId).toBe('user-1');
      const expectedLockMs = 5 * 60 * 1000;
      const lockDuration = (lockedUntil as Date).getTime() - Date.now();
      expect(lockDuration).toBeGreaterThan(expectedLockMs - 1000);
      expect(lockDuration).toBeLessThanOrEqual(expectedLockMs);
    });

    it('should still lock when failedAttempts is over by one (6)', async () => {
      repo.incrementFailedAttempts.mockResolvedValue({ failedAttempts: 6, lockoutCount: 0 });
      repo.applyLockout.mockResolvedValue(undefined);
      const result = await service.recordFailedAttempt('user-1');
      expect(result).toEqual({ locked: true, attemptsRemaining: 0 });
    });

    it('should apply 15-minute lock on 2nd lockout', async () => {
      repo.incrementFailedAttempts.mockResolvedValue({ failedAttempts: 5, lockoutCount: 1 });
      repo.applyLockout.mockResolvedValue(undefined);

      await service.recordFailedAttempt('user-1');

      const [, lockedUntil] = repo.applyLockout.mock.calls[0];
      const expectedLockMs = 15 * 60 * 1000;
      const lockDuration = (lockedUntil as Date).getTime() - Date.now();
      expect(lockDuration).toBeGreaterThan(expectedLockMs - 1000);
      expect(lockDuration).toBeLessThanOrEqual(expectedLockMs);
    });

    it('should apply 1-hour lock on 3rd lockout', async () => {
      repo.incrementFailedAttempts.mockResolvedValue({ failedAttempts: 5, lockoutCount: 2 });
      repo.applyLockout.mockResolvedValue(undefined);

      await service.recordFailedAttempt('user-1');

      const [, lockedUntil] = repo.applyLockout.mock.calls[0];
      const expectedLockMs = 60 * 60 * 1000;
      const lockDuration = (lockedUntil as Date).getTime() - Date.now();
      expect(lockDuration).toBeGreaterThan(expectedLockMs - 1000);
      expect(lockDuration).toBeLessThanOrEqual(expectedLockMs);
    });

    it('should apply permanent lock on 4th+ lockout (lockoutCount = 3)', async () => {
      repo.incrementFailedAttempts.mockResolvedValue({ failedAttempts: 5, lockoutCount: 3 });
      repo.applyLockout.mockResolvedValue(undefined);

      await service.recordFailedAttempt('user-1');

      const [, lockedUntil] = repo.applyLockout.mock.calls[0];
      expect(lockedUntil).toEqual(new Date('9999-12-31T23:59:59Z'));
    });

    it('should apply permanent lock when lockoutCount = 4 (above 3 boundary)', async () => {
      repo.incrementFailedAttempts.mockResolvedValue({ failedAttempts: 5, lockoutCount: 4 });
      repo.applyLockout.mockResolvedValue(undefined);

      await service.recordFailedAttempt('user-1');

      const [, lockedUntil] = repo.applyLockout.mock.calls[0];
      expect(lockedUntil).toEqual(new Date('9999-12-31T23:59:59Z'));
    });

    it('should throw NOT_FOUND when the guarded increment matches zero rows', async () => {
      repo.incrementFailedAttempts.mockResolvedValue(null);
      await expect(service.recordFailedAttempt('ghost')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
      expect(repo.applyLockout).not.toHaveBeenCalled();
    });
  });

  describe('reserveAttempt', () => {
    it('reserves with INCR + EXPIRE NX in ONE multi, so counting never extends the window', async () => {
      mockReservedCount(1);

      await service.reserveAttempt('user-1');

      expect(redis.multi).toHaveBeenCalledTimes(1);
      expect(chain.incr).toHaveBeenCalledWith('ratelimit:lockout:user-1');
      // NX, or a burst would keep pushing its own deadline out and the window
      // would never drain. One MULTI, or a crash could strand a TTL-less
      // counter and lock the account out until somebody found the key by hand.
      expect(chain.expire).toHaveBeenCalledWith('ratelimit:lockout:user-1', 300, 'NX');
      expect(chain.exec).toHaveBeenCalledTimes(1);
    });

    it('is inside the budget up to and including the fifth attempt', async () => {
      for (const count of [1, 2, 3, 4, 5]) {
        mockReservedCount(count);
        await expect(service.reserveAttempt('user-1')).resolves.toEqual({ withinBudget: true });
      }
    });

    it('is over budget from the sixth attempt on', async () => {
      mockReservedCount(6);
      await expect(service.reserveAttempt('user-1')).resolves.toEqual({ withinBudget: false });
      mockReservedCount(97);
      await expect(service.reserveAttempt('user-1')).resolves.toEqual({ withinBudget: false });
    });

    it('propagates an INCR error rather than reporting a budget it never read', async () => {
      chain.exec.mockResolvedValue([[new Error('redis down'), null]]);
      await expect(service.reserveAttempt('user-1')).rejects.toThrow('redis down');
    });

    it('fails OPEN on a null reply, which is the same answer as "first attempt"', async () => {
      // ioredis returns null from exec when the MULTI was discarded. Reading it
      // as 0 admits the attempt; the DB row still refuses once the budget is
      // spent, so the gate degrades to the pre-existing behavior rather than
      // locking everyone out of a working account.
      chain.exec.mockResolvedValue(null);
      await expect(service.reserveAttempt('user-1')).resolves.toEqual({ withinBudget: true });
    });
  });

  describe('resetAttempts', () => {
    it('should delegate to repository.resetAttempts', async () => {
      repo.resetAttempts.mockResolvedValue(undefined);
      await service.resetAttempts('user-1');
      expect(repo.resetAttempts).toHaveBeenCalledWith('user-1');
    });

    it('drops the Redis reservation too, so a proven owner is not refused for the rest of the window', async () => {
      repo.resetAttempts.mockResolvedValue(undefined);
      await service.resetAttempts('user-1');
      expect(redis.del).toHaveBeenCalledWith('ratelimit:lockout:user-1');
    });
  });

  describe('adminUnlock', () => {
    const LOCKED_UNTIL = new Date('2026-08-27T09:00:00.000Z');

    /** A target that is locked out for the third time, i.e. permanently. */
    const lockedOutTarget = () =>
      repo.getAdminUnlockState.mockResolvedValue({
        failedAttempts: 5,
        lockoutCount: 3,
        lockedUntil: LOCKED_UNTIL,
      });

    it('should delegate to repository.fullReset', async () => {
      lockedOutTarget();
      repo.fullReset.mockResolvedValue(1);
      await service.adminUnlock('user-1');
      expect(repo.fullReset).toHaveBeenCalledWith('user-1');
    });

    it('clears the Redis reservation, or the row says open while the gate still refuses', async () => {
      lockedOutTarget();
      repo.fullReset.mockResolvedValue(1);
      await service.adminUnlock('user-1');
      expect(redis.del).toHaveBeenCalledWith('ratelimit:lockout:user-1');
    });

    it('does not clear the reservation for an unknown target', async () => {
      repo.getAdminUnlockState.mockResolvedValue(null);
      await expect(service.adminUnlock('user-1')).rejects.toThrow();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('audits the clear with the lockout state it erased', async () => {
      // The whole point of the row: fullReset zeroes both counters, so after it
      // runs there is nowhere else the pre-reset state survives.
      lockedOutTarget();
      repo.fullReset.mockResolvedValue(1);

      await service.adminUnlock('user-1');

      expect(audit.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.AUTH_LOCKOUT_ADMIN_CLEARED,
        targetType: 'User',
        targetId: 'user-1',
        before: {
          lockoutCount: 3,
          failedAttempts: 5,
          lockedUntil: LOCKED_UNTIL.toISOString(),
        },
      });
    });

    it('reads the pre-reset state of the same row it resets', async () => {
      lockedOutTarget();
      repo.fullReset.mockResolvedValue(1);
      await service.adminUnlock('user-1');
      expect(repo.getAdminUnlockState).toHaveBeenCalledWith('user-1');
    });

    it('should throw NOT_FOUND for an unknown target and never reset or audit', async () => {
      // No live row: the probe matches nothing, so the reset is never attempted.
      repo.getAdminUnlockState.mockResolvedValue(null);
      await expect(service.adminUnlock('gone-user')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
      expect(repo.getAdminUnlockState).toHaveBeenCalledWith('gone-user');
      expect(repo.fullReset).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('should throw NOT_FOUND and not audit when the row moves between probe and reset', async () => {
      // Deleted in the gap: the reset matched nothing, so there
      // is no clear to record.
      lockedOutTarget();
      repo.fullReset.mockResolvedValue(0);
      await expect(service.adminUnlock('user-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: AppErrorCode.NOT_FOUND,
      });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('records a null lockedUntil when the account was throttled but never locked', async () => {
      repo.getAdminUnlockState.mockResolvedValue({
        failedAttempts: 3,
        lockoutCount: 0,
        lockedUntil: null,
      });
      repo.fullReset.mockResolvedValue(1);

      await service.adminUnlock('user-1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          before: { lockoutCount: 0, failedAttempts: 3, lockedUntil: null },
        }),
      );
    });
  });
});
