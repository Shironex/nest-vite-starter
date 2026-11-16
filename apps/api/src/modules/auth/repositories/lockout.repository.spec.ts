import { Test } from '@nestjs/testing';
import { LockoutRepository } from './lockout.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { buildPrismaMock } from '@test/test-module';

const buildSubject = async () => {
  const prisma = buildPrismaMock();
  const module = await Test.createTestingModule({
    providers: [LockoutRepository, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return { repo: module.get(LockoutRepository), prisma };
};

describe('LockoutRepository', () => {
  it('getLockoutState selects only lockedUntil, guarded by the soft-delete filter', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue({ lockedUntil: null });
    await expect(repo.getLockoutState('u-1')).resolves.toEqual({ lockedUntil: null });
    expect(prisma.client.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
      select: { lockedUntil: true },
    });
  });

  it('getLockoutState returns null for a missing or soft-deleted user', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(null);
    await expect(repo.getLockoutState('ghost')).resolves.toBeNull();
  });

  it('incrementFailedAttempts guards on { id, deletedAt: null }, increments, and re-reads the counters on the same tx', async () => {
    const { repo, prisma } = await buildSubject();
    // Default $transaction(cb) -> cb(client), so the tx IS the client mock.
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.client.user.findFirst.mockResolvedValue({ failedAttempts: 1, lockoutCount: 0 });

    await expect(repo.incrementFailedAttempts('u-1')).resolves.toEqual({
      failedAttempts: 1,
      lockoutCount: 0,
    });
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
      data: { failedAttempts: { increment: 1 } },
    });
    expect(prisma.client.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u-1', deletedAt: null },
      select: { failedAttempts: true, lockoutCount: true },
    });
  });

  it('incrementFailedAttempts returns null without re-reading when zero rows matched', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.incrementFailedAttempts('ghost')).resolves.toBeNull();
    expect(prisma.client.user.findFirst).not.toHaveBeenCalled();
  });

  it('applyLockout guards on not-already-locked and increments lockoutCount, resets failedAttempts', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });
    const lockedUntil = new Date('2030-01-01');
    await repo.applyLockout('u-1', lockedUntil);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      // `deletedAt: null` is asserted, not incidental: a lockout armed on an
      // erased account is one nothing can ever unlock.
      where: {
        id: 'u-1',
        deletedAt: null,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: expect.any(Date) } }],
      },
      data: {
        lockedUntil,
        lockoutCount: { increment: 1 },
        failedAttempts: 0,
      },
    });
  });

  it('resetAttempts zeroes failedAttempts and lockedUntil (keeps lockoutCount), guarded so a clean record writes zero rows', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });
    await repo.resetAttempts('u-1');
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'u-1',
        deletedAt: null,
        OR: [{ failedAttempts: { gt: 0 } }, { lockedUntil: { not: null } }],
      },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it('fullReset zeroes everything on the live row and returns the count', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 1 });
    const count = await repo.fullReset('u-1');
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      // Live rows only, and in step with `getAdminUnlockState`: the snapshot the
      // audit entry reports has to describe the row this reset touches.
      where: { id: 'u-1', deletedAt: null },
      data: { failedAttempts: 0, lockoutCount: 0, lockedUntil: null },
    });
    expect(count).toBe(1);
  });

  it('fullReset returns 0 when no live row matched', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });
    const count = await repo.fullReset('gone-user');
    expect(count).toBe(0);
  });
});
