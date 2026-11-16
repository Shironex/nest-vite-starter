import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { STAFF_INVITE_TOKEN_TTL_MS } from '@repo/shared/constants';
import type { PrismaService } from '../../common/database/prisma.service';
import type { AuditService } from '../audit/audit.service';
import {
  EXPIRED_INVITE_GRACE_DAYS,
  EXPIRED_INVITE_MAX_PER_SWEEP,
  ExpiredInviteSweepService,
} from './expired-invite-sweep.service';
import { cronSweepFailuresTotal } from '../metrics/metrics.registry';

const DAY_MS = 24 * 60 * 60 * 1000;

// A fixed clock so the two cutoffs the predicate carries can be asserted
// exactly rather than approximately.
const FIXED_NOW = new Date('2026-09-02T09:00:00.000Z');
jest.mock('../../common/clock', () => {
  const actual = jest.requireActual('../../common/clock');
  return {
    ...actual,
    now: () => new Date('2026-09-02T09:00:00.000Z'),
    nowMs: () => new Date('2026-09-02T09:00:00.000Z').getTime(),
  };
});

const pendingRow = (over: Record<string, unknown> = {}) => ({
  id: 'u-1',
  role: 'USER',
  tenantId: 'tenant-a',
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  ...over,
});

const buildSubject = () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { client: { user: { findMany, deleteMany } } };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ExpiredInviteSweepService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, findMany, deleteMany, audit };
};

describe('ExpiredInviteSweepService.sweep', () => {
  it('asks for rows that were never accepted, are old enough, and hold no recent invite token', async () => {
    const { service, findMany } = buildSubject();

    await service.sweep();

    const [args] = findMany.mock.calls[0] as [{ where: Record<string, unknown>; take: number }];
    expect(args.where).toMatchObject({
      // The deletePendingMember predicate: never a member, never an actor.
      passwordHash: null,
      emailVerified: false,
      deletedAt: null,
      // The other account with no password stays: a provider vouched for it.
      oauthAccounts: { none: {} },
    });
    expect(args.take).toBe(EXPIRED_INVITE_MAX_PER_SWEEP);
  });

  it('requires the row to have outlived a full invite TTL plus the grace window', async () => {
    // createPendingMember and the first token mint are two transactions, so a
    // row with no token at all can be seconds old. The age floor is what stops
    // the sweep reaching it.
    const { service, findMany } = buildSubject();

    await service.sweep();

    const [args] = findMany.mock.calls[0] as [{ where: { createdAt: { lt: Date } } }];
    expect(args.where.createdAt.lt).toEqual(
      new Date(
        FIXED_NOW.getTime() - STAFF_INVITE_TOKEN_TTL_MS - EXPIRED_INVITE_GRACE_DAYS * DAY_MS,
      ),
    );
  });

  /**
   * The token clause can only DEFER. It cannot be the trigger: the hourly token
   * cleanup deletes an invite token an hour after it expires, so a predicate
   * keyed on the token's presence would fire seven days early and then never
   * fire again on a row whose token had already been collected.
   */
  it('keeps any row whose invite token expired inside the grace window, or has not expired', async () => {
    const { service, findMany } = buildSubject();

    await service.sweep();

    const [args] = findMany.mock.calls[0] as [
      { where: { tokens: { none: { type: unknown; expiresAt: { gt: Date } } } } },
    ];
    expect(args.where.tokens.none.type).toEqual({ in: ['STAFF_INVITE'] });
    expect(args.where.tokens.none.expiresAt.gt).toEqual(
      new Date(FIXED_NOW.getTime() - EXPIRED_INVITE_GRACE_DAYS * DAY_MS),
    );
  });

  it('repeats the predicate on the delete so a row accepted since the read is left alone', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    findMany.mockResolvedValue([pendingRow()]);

    await service.sweep();

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'u-1', passwordHash: null, emailVerified: false, deletedAt: null },
    });
  });

  it('writes the staff action, stamped with the invitation OWN organization', async () => {
    const { service, findMany, audit } = buildSubject();
    findMany.mockResolvedValue([pendingRow({ role: 'ADMIN' })]);

    await expect(service.sweep()).resolves.toBe(1);

    expect(audit.log).toHaveBeenCalledWith({
      action: AUDIT_ACTIONS.STAFF_INVITE_EXPIRED,
      userId: null,
      tenantId: 'tenant-a',
      targetType: 'User',
      targetId: 'u-1',
      metadata: { role: 'ADMIN', invitedAt: '2026-06-01T00:00:00.000Z' },
    });
    // Never the address: the invitee's email is their own PII and the row that
    // carried it is gone.
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('@');
  });

  it('does not audit a row another replica already deleted', async () => {
    const { service, findMany, deleteMany, audit } = buildSubject();
    findMany.mockResolvedValue([pendingRow()]);
    deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.sweep()).resolves.toBe(0);

    expect(audit.log).not.toHaveBeenCalled();
  });

  it('defers one failing row and still takes the rest', async () => {
    const { service, findMany, deleteMany } = buildSubject();
    findMany.mockResolvedValue([pendingRow({ id: 'u-1' }), pendingRow({ id: 'u-2' })]);
    deleteMany.mockRejectedValueOnce(new Error('DB down')).mockResolvedValue({ count: 1 });

    await expect(service.sweep()).resolves.toBe(1);
  });

  it('never throws out of a failed tick, and counts it', async () => {
    const { service, findMany } = buildSubject();
    findMany.mockRejectedValue(new Error('DB down'));
    const failures = jest.spyOn(cronSweepFailuresTotal, 'inc').mockImplementation((() => {
      // counter double
    }) as unknown as typeof cronSweepFailuresTotal.inc);

    await expect(service.sweep()).resolves.toBe(0);

    expect(failures).toHaveBeenCalledWith({ sweep: 'expired-invite-sweep' });
    failures.mockRestore();
  });
});
