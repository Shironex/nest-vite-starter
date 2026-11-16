import { buildPrismaMock } from '@test/test-module';
import type { PrismaService } from '../../../common/database/prisma.service';
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

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new TwoFactorCleanupService(prisma as unknown as PrismaService);
  });

  it('deletes PENDING rows older than the 1-hour activation window and returns the count', async () => {
    prisma.client.secondFactor.deleteMany.mockResolvedValue({ count: 4 });

    const deleted = await service.sweep();

    expect(prisma.client.secondFactor.deleteMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', createdAt: { lt: EXPECTED_CUTOFF } },
    });
    expect(deleted).toBe(4);
  });

  it('returns 0 when nothing was deleted', async () => {
    prisma.client.secondFactor.deleteMany.mockResolvedValue({ count: 0 });

    const deleted = await service.sweep();

    expect(deleted).toBe(0);
  });

  it('never throws (best-effort): a failure returns 0', async () => {
    prisma.client.secondFactor.deleteMany.mockRejectedValue(new Error('db down'));

    await expect(service.sweep()).resolves.toBe(0);
  });
});
