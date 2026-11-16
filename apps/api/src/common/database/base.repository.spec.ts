import { BaseRepository } from './base.repository';
import { ConcurrencyError } from './concurrency-error';
import { buildPrismaMock, type PrismaServiceMock } from '@test/test-module';
import type { PrismaService } from './prisma.service';

class TestRepo extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
  // Expose the protected helpers for direct testing.
  callPage<TRow>(rows: Promise<TRow[]>, count: () => Promise<number>, cursor: string | undefined) {
    return this.pageWithTotal(rows, count, cursor);
  }
  callUpdate(
    model: string,
    id: string,
    version: number,
    data: Record<string, unknown>,
    tx?: Parameters<TestRepo['updateWithVersion']>[4],
  ) {
    return this.updateWithVersion(model, id, version, data, tx);
  }
}

/** A P2025 shaped like Prisma's known-request error, for the conflict path. */
const recordNotFound = Object.assign(new Error('record not found'), {
  name: 'PrismaClientKnownRequestError',
  code: 'P2025',
});

describe('BaseRepository.updateWithVersion', () => {
  let prisma: PrismaServiceMock;
  let repo: TestRepo;

  beforeEach(() => {
    prisma = buildPrismaMock();
    repo = new TestRepo(prisma as unknown as PrismaService);
  });

  it('happy path: guards on version, bumps it, and returns the written row', async () => {
    prisma.client.user.update.mockResolvedValue({ id: 'u-1', version: 2 });

    const result = await repo.callUpdate('user', 'u-1', 1, { displayName: 'X' });

    // One statement: the version guard lives in the where, so the row returned
    // is the row this call wrote.
    expect(prisma.client.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1', version: 1 },
      data: { displayName: 'X', version: { increment: 1 } },
    });
    expect(result).toEqual({ id: 'u-1', version: 2 });
    expect(prisma.client.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('translates P2025 into ConcurrencyError (version mismatch or row gone)', async () => {
    prisma.client.user.update.mockRejectedValue(recordNotFound);

    await expect(repo.callUpdate('user', 'u-1', 1, {})).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('ConcurrencyError carries model / id / expectedVersion', async () => {
    prisma.client.user.update.mockRejectedValue(recordNotFound);

    await expect(repo.callUpdate('user', 'u-1', 7, {})).rejects.toMatchObject({
      name: 'ConcurrencyError',
      model: 'user',
      id: 'u-1',
      expectedVersion: 7,
    });
  });

  it('rethrows a non-P2025 failure untouched', async () => {
    const boom = new Error('connection reset');
    prisma.client.user.update.mockRejectedValue(boom);

    await expect(repo.callUpdate('user', 'u-1', 1, {})).rejects.toBe(boom);
  });

  it('uses the transaction client when one is passed', async () => {
    const txUpdate = jest.fn().mockResolvedValue({ id: 'u-1', version: 2 });
    const tx = { user: { update: txUpdate } };

    await repo.callUpdate(
      'user',
      'u-1',
      1,
      {},
      tx as unknown as Parameters<TestRepo['callUpdate']>[4],
    );

    // The write must land on the caller's transaction, not on a second
    // connection taken from the pool.
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it('throws when an unknown delegate is requested', async () => {
    await expect(repo.callUpdate('does_not_exist', 'x', 0, {})).rejects.toThrow(
      'Unknown Prisma delegate: does_not_exist',
    );
  });
});

/**
 * The count-only-on-the-first-page rule, asserted where it lives rather than
 * three times over in the repositories that inherit it.
 *
 * The saving is real and the correctness argument is narrow: a COUNT over one
 * traversal's predicate answers the same number on every page of that
 * traversal, so re-running it per page paid for a footer that had not changed.
 * What has to hold is that a cursored page does not merely DISCARD the count,
 * it never issues it - which is why every assertion below is on the thunk
 * rather than on the returned total.
 */
describe('BaseRepository.pageWithTotal', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = new TestRepo(buildPrismaMock() as unknown as PrismaService);
  });

  it('counts on a first page and reports the number', async () => {
    const count = jest.fn().mockResolvedValue(312);

    const page = await repo.callPage(Promise.resolve([{ id: 'r-1' }]), count, undefined);

    expect(count).toHaveBeenCalledTimes(1);
    expect(page).toEqual({ rows: [{ id: 'r-1' }], total: 312 });
  });

  it('never issues the count on a cursored page', async () => {
    // Not "runs it and throws the answer away": the thunk exists so the query
    // is never built, and this is the assertion that keeps it that way.
    const count = jest.fn().mockResolvedValue(312);

    const page = await repo.callPage(Promise.resolve([{ id: 'r-2' }]), count, 'r-1');

    expect(count).not.toHaveBeenCalled();
    // Null, not zero and not a stale echo: "did not count" and "counted zero"
    // have to be different observations on the client.
    expect(page).toEqual({ rows: [{ id: 'r-2' }], total: null });
  });

  it('still returns the rows on a cursored page', async () => {
    const page = await repo.callPage(
      Promise.resolve([{ id: 'r-2' }, { id: 'r-3' }]),
      jest.fn(),
      'r-1',
    );

    expect(page.rows).toHaveLength(2);
  });

  it('awaits the rows itself rather than handing back a lazy promise', async () => {
    // A Prisma promise is lazy. Returning an un-awaited pair would execute the
    // query after the caller's ALS request scope had exited, and the tenant
    // extension fails closed there.
    let settled = false;
    const rows = Promise.resolve([{ id: 'r-1' }]).then((value) => {
      settled = true;
      return value;
    });

    await repo.callPage(rows, jest.fn().mockResolvedValue(1), undefined);

    expect(settled).toBe(true);
  });

  it('counts an empty first page as zero rather than skipping the count', async () => {
    // A footer reading "0" is a real answer, and it is the one the empty state
    // is drawn from. Skipping the count on an empty page would make it null and
    // the summary would silently disappear.
    const count = jest.fn().mockResolvedValue(0);

    const page = await repo.callPage(Promise.resolve([]), count, undefined);

    expect(count).toHaveBeenCalledTimes(1);
    expect(page.total).toBe(0);
  });
});
