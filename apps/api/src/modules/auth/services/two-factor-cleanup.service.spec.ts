import { buildPrismaMock } from '@test/test-module';
import type { PrismaService } from '../../../common/database/prisma.service';
import {
  cronSweepFailuresTotal,
  twoFactorPendingCleanupDeletedTotal,
} from '../../metrics/metrics.registry';
import { PENDING_ENROLLMENT_EXPIRY_MS } from '../auth.constants';
import { TwoFactorCleanupService } from './two-factor-cleanup.service';

const FIXED_NOW_ISO = '2026-07-19T09:00:00.000Z';
jest.mock('../../../common/clock', () => ({
  now: () => new Date('2026-07-19T09:00:00.000Z'),
  nowMs: () => new Date('2026-07-19T09:00:00.000Z').getTime(),
  nowIso: () => '2026-07-19T09:00:00.000Z',
}));

const EXPECTED_CUTOFF = new Date(new Date(FIXED_NOW_ISO).getTime() - PENDING_ENROLLMENT_EXPIRY_MS);

describe('TwoFactorCleanupService.sweep', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: TwoFactorCleanupService;
  let deletedIncSpy: jest.SpyInstance;
  let failureIncSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new TwoFactorCleanupService(prisma as unknown as PrismaService);
    deletedIncSpy = jest
      .spyOn(twoFactorPendingCleanupDeletedTotal, 'inc')
      .mockImplementation(() => undefined);
    failureIncSpy = jest.spyOn(cronSweepFailuresTotal, 'inc').mockImplementation(() => undefined);
  });

  afterEach(() => {
    deletedIncSpy.mockRestore();
    failureIncSpy.mockRestore();
  });

  it('deletes PENDING rows older than the 1-hour activation window and counts the deletions', async () => {
    prisma.client.secondFactor.deleteMany.mockResolvedValue({ count: 4 });

    const deleted = await service.sweep();

    expect(prisma.client.secondFactor.deleteMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', createdAt: { lt: EXPECTED_CUTOFF } },
    });
    expect(deletedIncSpy).toHaveBeenCalledWith(4);
    expect(deleted).toBe(4);
  });

  it('does not increment the counter when nothing was deleted', async () => {
    prisma.client.secondFactor.deleteMany.mockResolvedValue({ count: 0 });

    const deleted = await service.sweep();

    expect(deletedIncSpy).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });

  it('never throws (best-effort): a failure returns 0 and counts the sweep failure metric', async () => {
    prisma.client.secondFactor.deleteMany.mockRejectedValue(new Error('db down'));

    await expect(service.sweep()).resolves.toBe(0);

    expect(deletedIncSpy).not.toHaveBeenCalled();
    expect(failureIncSpy).toHaveBeenCalledWith({ sweep: 'two-factor-pending-cleanup' });
  });
});
