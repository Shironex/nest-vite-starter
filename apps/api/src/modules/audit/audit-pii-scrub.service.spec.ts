import { AUDIT_PII_ERASED_VALUE } from '@repo/shared/audit';
import type { PrismaService } from '../../common/database/prisma.service';
import {
  AUDIT_PII_SCRUB_BATCH_SIZE,
  AuditPiiScrubService,
  eraseRegisteredPii,
} from './audit-pii-scrub.service';

describe('eraseRegisteredPii', () => {
  it('erases a registered key at the top level and leaves the rest', () => {
    expect(eraseRegisteredPii({ newEmail: 'a@example.net', reason: 'x' })).toEqual({
      newEmail: AUDIT_PII_ERASED_VALUE,
      reason: 'x',
    });
  });

  it('erases registered keys at any depth, inside arrays too', () => {
    expect(
      eraseRegisteredPii({
        outer: { email: 'a@example.net' },
        list: [{ email: 'c@example.org' }, 1],
      }),
    ).toEqual({
      outer: { email: AUDIT_PII_ERASED_VALUE },
      list: [{ email: AUDIT_PII_ERASED_VALUE }, 1],
    });
  });

  it('reports "nothing to do" for payloads without a registered key', () => {
    expect(eraseRegisteredPii({ reason: 'x', count: 2 })).toBeUndefined();
    expect(eraseRegisteredPii(null)).toBeUndefined();
    expect(eraseRegisteredPii('email')).toBeUndefined();
  });

  it('is idempotent: an already erased or null value is left alone', () => {
    expect(eraseRegisteredPii({ email: AUDIT_PII_ERASED_VALUE })).toBeUndefined();
    expect(eraseRegisteredPii({ email: null })).toBeUndefined();
  });

  it('does not treat a PII-shaped but unregistered key as registered', () => {
    // The registry is the contract, not the rule's name heuristics.
    expect(eraseRegisteredPii({ phone: '+1 555-0100' })).toBeUndefined();
  });
});

describe('AuditPiiScrubService.scrubUser', () => {
  const buildSubject = () => {
    const findMany = jest.fn();
    const update = jest.fn().mockResolvedValue({});
    const prisma = { client: { auditLog: { findMany, update } } };
    const service = new AuditPiiScrubService(prisma as unknown as PrismaService);
    return { service, findMany, update };
  };

  it('selects the rows the user is the subject or the actor of', async () => {
    const { service, findMany } = buildSubject();
    findMany.mockResolvedValue([]);

    await service.scrubUser('user-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ userId: 'user-1' }, { targetType: 'User', targetId: 'user-1' }] },
        orderBy: { id: 'asc' },
        take: AUDIT_PII_SCRUB_BATCH_SIZE,
      }),
    );
  });

  it('rewrites only the columns that carried a registered key, and only those rows', async () => {
    const { service, findMany, update } = buildSubject();
    findMany.mockResolvedValue([
      { id: 'a', metadata: { newEmail: 'x@example.org' }, before: null, after: null },
      { id: 'b', metadata: { reason: 'nothing here' }, before: null, after: null },
      {
        id: 'c',
        metadata: null,
        before: { email: 'old@example.org' },
        after: { email: 'new@example.org' },
      },
    ]);

    await expect(service.scrubUser('user-1')).resolves.toBe(2);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { metadata: { newEmail: AUDIT_PII_ERASED_VALUE } },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c' },
      data: {
        before: { email: AUDIT_PII_ERASED_VALUE },
        after: { email: AUDIT_PII_ERASED_VALUE },
      },
    });
  });

  it('pages past a full batch by id and stops on a short one', async () => {
    const { service, findMany } = buildSubject();
    const fullPage = Array.from({ length: AUDIT_PII_SCRUB_BATCH_SIZE }, (_, i) => ({
      id: `r${String(i).padStart(4, '0')}`,
      metadata: null,
      before: null,
      after: null,
    }));
    findMany.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([]);

    await service.scrubUser('user-1');

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: {
          OR: [{ userId: 'user-1' }, { targetType: 'User', targetId: 'user-1' }],
          id: { gt: fullPage.at(-1)?.id },
        },
      }),
    );
  });

  it('propagates a failed write so the purge keeps the user row', async () => {
    const { service, findMany, update } = buildSubject();
    findMany.mockResolvedValue([
      { id: 'a', metadata: { email: 'x@example.org' }, before: null, after: null },
    ]);
    update.mockRejectedValue(new Error('db down'));

    await expect(service.scrubUser('user-1')).rejects.toThrow('db down');
  });
});
