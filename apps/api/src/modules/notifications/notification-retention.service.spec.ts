import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../common/database/prisma.service';
import {
  NotificationRetentionService,
  NOTIFICATION_RETENTION_BATCH_SIZE,
  NOTIFICATION_RETENTION_MAX_BATCHES,
} from './notification-retention.service';
import { notificationRetentionDeletedTotal } from '../metrics/metrics.registry';

const DAY_MS = 24 * 60 * 60 * 1000;

const idBatch = (size: number) => Array.from({ length: size }, (_, i) => ({ id: `row-${i}` }));

const buildSubject = (retentionDays = 90) => {
  const findMany = jest.fn();
  const deleteMany = jest.fn();
  const prisma = { client: { notification: { findMany, deleteMany } } };
  const config = {
    get: jest.fn((key: string, fallback: number) =>
      key === 'NOTIFICATION_RETENTION_DAYS' ? retentionDays : fallback,
    ),
  };
  const service = new NotificationRetentionService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  return { service, findMany, deleteMany };
};

describe('NotificationRetentionService.sweep', () => {
  let incSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-02T05:00:00Z'));
    incSpy = jest
      .spyOn(notificationRetentionDeletedTotal, 'inc')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    incSpy.mockRestore();
    jest.useRealTimers();
  });

  it('targets only rows older than the cutoff (createdAt < now - NOTIFICATION_RETENTION_DAYS), read or not', async () => {
    const { service, findMany, deleteMany } = buildSubject(90);
    findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 2 });

    const deleted = await service.sweep();

    const expectedCutoff = new Date(Date.now() - 90 * DAY_MS);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expectedCutoff } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: NOTIFICATION_RETENTION_BATCH_SIZE,
    });
    // The delete keys on the ids just selected, never on a broad predicate.
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } } });
    expect(deleted).toBe(2);
    expect(incSpy).toHaveBeenCalledWith(2);
  });

  it('honors a non-default retention window from config', async () => {
    const { service, findMany } = buildSubject(14);
    findMany.mockResolvedValue([]);

    await service.sweep();

    const expectedCutoff = new Date(Date.now() - 14 * DAY_MS);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { lt: expectedCutoff } } }),
    );
  });

  it('loops full batches and terminates on the short final batch', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    const fullBatch = idBatch(NOTIFICATION_RETENTION_BATCH_SIZE);
    findMany
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([{ id: 'last' }]);
    deleteMany
      .mockResolvedValueOnce({ count: NOTIFICATION_RETENTION_BATCH_SIZE })
      .mockResolvedValueOnce({ count: NOTIFICATION_RETENTION_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 1 });

    const deleted = await service.sweep();

    // A short batch proves the predicate is drained: no fourth findMany fires.
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(deleteMany).toHaveBeenCalledTimes(3);
    expect(deleted).toBe(NOTIFICATION_RETENTION_BATCH_SIZE * 2 + 1);
    expect(incSpy).toHaveBeenCalledWith(NOTIFICATION_RETENTION_BATCH_SIZE * 2 + 1);
  });

  it('terminates without deleting when nothing is expired (idempotent by predicate)', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    findMany.mockResolvedValue([]);

    const deleted = await service.sweep();

    expect(deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(incSpy).not.toHaveBeenCalled();
  });

  it('stops at the defensive batch cap even when full batches keep coming', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    const fullBatch = idBatch(NOTIFICATION_RETENTION_BATCH_SIZE);
    findMany.mockResolvedValue(fullBatch);
    deleteMany.mockResolvedValue({ count: NOTIFICATION_RETENTION_BATCH_SIZE });

    const deleted = await service.sweep();

    expect(findMany).toHaveBeenCalledTimes(NOTIFICATION_RETENTION_MAX_BATCHES);
    expect(deleteMany).toHaveBeenCalledTimes(NOTIFICATION_RETENTION_MAX_BATCHES);
    expect(deleted).toBe(NOTIFICATION_RETENTION_BATCH_SIZE * NOTIFICATION_RETENTION_MAX_BATCHES);
  });

  it('never throws (best-effort): a query failure logs, returns 0, and skips the metric', async () => {
    const { service, findMany } = buildSubject();
    findMany.mockRejectedValue(new Error('db down'));
    const errorSpy = jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sweep()).resolves.toBe(0);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('notification-retention sweep failed'),
      expect.any(String),
    );
    expect(incSpy).not.toHaveBeenCalled();
  });

  it('never throws when the delete itself fails mid-loop', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    findMany.mockResolvedValue([{ id: 'a' }]);
    deleteMany.mockRejectedValue(new Error('deadlock'));
    jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sweep()).resolves.toBe(0);
    expect(incSpy).not.toHaveBeenCalled();
  });
});
