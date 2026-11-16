import type { ConfigService } from '@nestjs/config';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import type { PrismaService } from '../../common/database/prisma.service';
import type { AuditService } from './audit.service';
import {
  AuditRetentionService,
  AUDIT_RETENTION_BATCH_SIZE,
  AUDIT_RETENTION_MAX_BATCHES,
} from './audit-retention.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const idBatch = (size: number) => Array.from({ length: size }, (_, i) => ({ id: `row-${i}` }));

const buildSubject = (retentionDays = 365) => {
  const findMany = jest.fn();
  const deleteMany = jest.fn();
  const prisma = { client: { auditLog: { findMany, deleteMany } } };
  const config = {
    get: jest.fn((key: string, fallback: number) =>
      key === 'AUDIT_LOG_RETENTION_DAYS' ? retentionDays : fallback,
    ),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AuditRetentionService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    audit as unknown as AuditService,
  );
  return { service, findMany, deleteMany, audit };
};

describe('AuditRetentionService.sweep', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-01T04:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('targets only rows older than the retention cutoff (createdAt < now - AUDIT_LOG_RETENTION_DAYS)', async () => {
    const { service, findMany, deleteMany } = buildSubject(365);
    findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 2 });

    const deleted = await service.sweep();

    const expectedCutoff = new Date(Date.now() - 365 * DAY_MS);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expectedCutoff } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: AUDIT_RETENTION_BATCH_SIZE,
    });
    // The delete keys on the ids just selected, never on a broad predicate.
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } } });
    expect(deleted).toBe(2);
  });

  it('honors a non-default retention window from config', async () => {
    const { service, findMany } = buildSubject(30);
    findMany.mockResolvedValue([]);

    await service.sweep();

    const expectedCutoff = new Date(Date.now() - 30 * DAY_MS);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { lt: expectedCutoff } } }),
    );
  });

  it('loops full batches and terminates on the short final batch', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    const fullBatch = idBatch(AUDIT_RETENTION_BATCH_SIZE);
    findMany
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([{ id: 'last' }]);
    deleteMany
      .mockResolvedValueOnce({ count: AUDIT_RETENTION_BATCH_SIZE })
      .mockResolvedValueOnce({ count: AUDIT_RETENTION_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 1 });

    const deleted = await service.sweep();

    // A short batch proves the predicate is drained: no fourth findMany fires.
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(deleteMany).toHaveBeenCalledTimes(3);
    expect(deleted).toBe(AUDIT_RETENTION_BATCH_SIZE * 2 + 1);
  });

  it('terminates without deleting when nothing is expired (idempotent by predicate)', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    findMany.mockResolvedValue([]);

    const deleted = await service.sweep();

    expect(deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('stops at the defensive batch cap even when full batches keep coming', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    const fullBatch = idBatch(AUDIT_RETENTION_BATCH_SIZE);
    findMany.mockResolvedValue(fullBatch);
    deleteMany.mockResolvedValue({ count: AUDIT_RETENTION_BATCH_SIZE });

    const deleted = await service.sweep();

    expect(findMany).toHaveBeenCalledTimes(AUDIT_RETENTION_MAX_BATCHES);
    expect(deleteMany).toHaveBeenCalledTimes(AUDIT_RETENTION_MAX_BATCHES);
    expect(deleted).toBe(AUDIT_RETENTION_BATCH_SIZE * AUDIT_RETENTION_MAX_BATCHES);
  });

  it('never throws (best-effort): a query failure logs and returns 0', async () => {
    const { service, findMany } = buildSubject();
    findMany.mockRejectedValue(new Error('db down'));
    const errorSpy = jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sweep()).resolves.toBe(0);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('audit-log-retention sweep failed'),
      expect.any(String),
    );
  });

  it('never throws when the delete itself fails mid-loop', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    findMany.mockResolvedValue([{ id: 'a' }]);
    deleteMany.mockRejectedValue(new Error('deadlock'));
    jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sweep()).resolves.toBe(0);
  });
});

describe('AuditRetentionService durable record', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-01T04:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes one row naming the CUTOFF DATE, not the retention day count', async () => {
    // The day count is the rule; the cutoff is what the rule actually selected,
    // and it is the only one of the two that can be checked years later.
    const { service, findMany, deleteMany, audit } = buildSubject(365);
    findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 2 });

    await service.sweep();

    expect(audit.log).toHaveBeenCalledWith({
      action: AUDIT_ACTIONS.AUDIT_RETENTION_SWEEP,
      userId: null,
      targetType: 'AuditLog',
      metadata: {
        cutoff: new Date(Date.now() - 365 * DAY_MS).toISOString(),
        retentionDays: 365,
        deleted: 2,
      },
    });
  });

  it('writes the row AFTER the deletes, so the sweep cannot erase its own evidence', async () => {
    const { service, findMany, deleteMany, audit } = buildSubject();
    findMany.mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 1 });

    await service.sweep();

    expect(deleteMany.mock.invocationCallOrder[0]!).toBeLessThan(
      audit.log.mock.invocationCallOrder[0]!,
    );
  });

  it('records a zero-delete run too: "nothing was due" is an answer, not a silence', async () => {
    const { service, findMany, audit } = buildSubject();
    findMany.mockResolvedValue([]);

    await service.sweep();

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ deleted: 0 }) }),
    );
  });

  it('does not write the row when the sweep threw', async () => {
    const { service, findMany, audit } = buildSubject();
    findMany.mockRejectedValue(new Error('db down'));
    jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sweep()).resolves.toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
