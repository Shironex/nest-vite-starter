import type { ConfigService } from '@nestjs/config';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import type { PrismaService } from '../../common/database/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { AuditService } from '../audit/audit.service';
import type { AuditPiiScrubService } from '../audit/audit-pii-scrub.service';
import { UserPurgeService, USER_PURGE_MAX_PER_SWEEP } from './user-purge.service';
import { userPurgeDeletedTotal, userPurgeFailuresTotal } from '../metrics/metrics.registry';

const DAY_MS = 24 * 60 * 60 * 1000;
const TENANT = 'tenant-1';

const expiredRow = (
  id: string,
  deletedAt = new Date('2026-05-01T00:00:00Z'),
  tenantId: string | null = TENANT,
) => ({
  id,
  deletedAt,
  tenantId,
});

const buildSubject = (graceDays = 30) => {
  const findMany = jest.fn();
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { client: { user: { findMany, deleteMany } } };
  // `getOrThrow`, matching the service: the Joi schema owns the default, so
  // there is no in-code fallback for a double to stand in for.
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key !== 'USER_PURGE_GRACE_DAYS') {
        throw new Error(`Unexpected config key ${key}`);
      }
      return graceDays;
    }),
  };
  const storage = { deletePrefix: jest.fn().mockResolvedValue(0) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const scrub = { scrubUser: jest.fn().mockResolvedValue(3) };
  const service = new UserPurgeService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
    scrub as unknown as AuditPiiScrubService,
  );
  return { service, findMany, deleteMany, storage, audit, scrub };
};

describe('UserPurgeService.sweep', () => {
  let deletedSpy: jest.SpyInstance;
  let failuresSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-01T06:00:00Z'));
    deletedSpy = jest.spyOn(userPurgeDeletedTotal, 'inc').mockImplementation(() => undefined);
    failuresSpy = jest.spyOn(userPurgeFailuresTotal, 'inc').mockImplementation(() => undefined);
  });

  afterEach(() => {
    deletedSpy.mockRestore();
    failuresSpy.mockRestore();
    jest.useRealTimers();
  });

  it('targets only soft-deleted rows past the grace window (deletedAt < now - USER_PURGE_GRACE_DAYS), oldest first, capped', async () => {
    const { service, findMany } = buildSubject(30);
    findMany.mockResolvedValue([]);

    await service.sweep();

    const expectedCutoff = new Date(Date.now() - 30 * DAY_MS);
    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: { not: null, lt: expectedCutoff } },
      select: { id: true, deletedAt: true },
      orderBy: { deletedAt: 'asc' },
      take: USER_PURGE_MAX_PER_SWEEP,
    });
  });

  it('honors a non-default grace window from config', async () => {
    const { service, findMany } = buildSubject(7);
    findMany.mockResolvedValue([]);

    await service.sweep();

    const expectedCutoff = new Date(Date.now() - 7 * DAY_MS);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: { not: null, lt: expectedCutoff } } }),
    );
  });

  it('per user: deletes the S3 prefix FIRST, then the row, then counts and audits the purge as a system event', async () => {
    const { service, findMany, deleteMany, storage, audit } = buildSubject();
    const deletedAt = new Date('2026-05-20T12:00:00Z');
    findMany.mockResolvedValue([expiredRow('u-1', deletedAt)]);

    const purged = await service.sweep();

    expect(purged).toBe(1);
    expect(storage.deletePrefix).toHaveBeenCalledWith('avatars/u-1/');
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'u-1' } });
    // S3 strictly before the row delete: the row is the only pointer to the
    // objects, so the inverse order could orphan them forever.
    expect(storage.deletePrefix.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(deletedSpy).toHaveBeenCalledTimes(1);
    // System sweep: no request context, so every audit field is explicit.
    expect(audit.log).toHaveBeenCalledWith({
      action: AUDIT_ACTIONS.USER_ACCOUNT_PURGED,
      userId: null,
      targetType: 'User',
      targetId: 'u-1',
      metadata: { deletedAt: deletedAt.toISOString(), auditRowsScrubbed: 3 },
    });
  });

  it('scrubs the user audit PII after the S3 delete and BEFORE the row delete', async () => {
    const { service, findMany, deleteMany, storage, scrub } = buildSubject();
    findMany.mockResolvedValue([expiredRow('u-1')]);

    await service.sweep();

    expect(scrub.scrubUser).toHaveBeenCalledWith('u-1');
    // AuditLog.userId is SetNull: the row delete unlinks every row the user
    // acted in from their id, so the scrub must see them first.
    expect(scrub.scrubUser.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(storage.deletePrefix.mock.invocationCallOrder[0]!).toBeLessThan(
      scrub.scrubUser.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the user row when the audit scrub fails, so the next sweep retries it', async () => {
    const { service, findMany, deleteMany, audit, scrub } = buildSubject();
    findMany.mockResolvedValue([expiredRow('u-1'), expiredRow('u-2')]);
    scrub.scrubUser.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(0);
    jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    const purged = await service.sweep();

    expect(purged).toBe(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'u-2' } });
    expect(failuresSpy).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'u-2' }));
  });

  it('skips the row THIS sweep when the S3 prefix delete fails (never orphans objects behind a deleted row)', async () => {
    const { service, findMany, deleteMany, storage, audit } = buildSubject();
    findMany.mockResolvedValue([expiredRow('u-1'), expiredRow('u-2')]);
    storage.deletePrefix.mockRejectedValueOnce(new Error('S3 down')).mockResolvedValueOnce(2);
    jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    const purged = await service.sweep();

    // u-1 deferred (row kept, failure counted), u-2 still purged.
    expect(purged).toBe(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'u-2' } });
    expect(failuresSpy).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'u-2' }));
  });

  it('one failing row does not block the rest: a row-delete failure is counted and the sweep continues', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    findMany.mockResolvedValue([expiredRow('u-1'), expiredRow('u-2')]);
    deleteMany.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValueOnce({ count: 1 });
    jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    const purged = await service.sweep();

    expect(purged).toBe(1);
    expect(failuresSpy).toHaveBeenCalledTimes(1);
    expect(deletedSpy).toHaveBeenCalledTimes(1);
  });

  it('skips metric + audit when another replica already purged the row (guarded delete count 0)', async () => {
    const { service, findMany, deleteMany, audit } = buildSubject();
    findMany.mockResolvedValue([expiredRow('u-1')]);
    deleteMany.mockResolvedValue({ count: 0 });

    const purged = await service.sweep();

    expect(purged).toBe(0);
    expect(deletedSpy).not.toHaveBeenCalled();
    expect(failuresSpy).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('terminates without deleting when nothing is past the grace window (idempotent by predicate)', async () => {
    const { service, findMany, deleteMany, storage } = buildSubject();
    findMany.mockResolvedValue([]);

    const purged = await service.sweep();

    expect(purged).toBe(0);
    expect(storage.deletePrefix).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('never throws (best-effort): a findMany failure logs and returns 0', async () => {
    const { service, findMany } = buildSubject();
    findMany.mockRejectedValue(new Error('db down'));
    const errorSpy = jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sweep()).resolves.toBe(0);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('user-purge sweep failed'),
      expect.any(String),
    );
    expect(deletedSpy).not.toHaveBeenCalled();
  });
});
