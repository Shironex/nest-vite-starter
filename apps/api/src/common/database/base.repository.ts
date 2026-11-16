import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { PrismaService } from './prisma.service';
import { ConcurrencyError } from './concurrency-error';
import { PRISMA_ERROR, isPrismaErrorCode } from './prisma-error';
import type { IPageRowsWithTotal } from '../utils/cursor-page';
import { InvariantError } from '../errors/invariant-error';

export abstract class BaseRepository {
  constructor(protected readonly prisma: PrismaService) {}

  protected get client() {
    return this.prisma.client;
  }

  /**
   * Standard soft-delete filter condition.
   * Apply to any query on models that support soft deletion.
   */
  protected get notDeleted() {
    return { deletedAt: null } as const;
  }

  /**
   * Resolve a keyset page read and, on a FIRST page, the COUNT that labels it.
   *
   * The list surfaces render a range summary ("Showing 1-25 of 312"), which
   * needs a total the cursor deliberately does not compute. The failure worth
   * engineering against is not staleness, it is a count that measures a
   * DIFFERENT POPULATION than the rows above it: a second hand-written `where`
   * that forgets the soft-delete filter or another clause of the page's
   * predicate. That number looks plausible and is wrong, and no type catches
   * it.
   *
   * So the contract on every caller is two lines, and both are load bearing:
   *
   *   1. build ONE `where` object and hand it to both statements. Not two
   *      objects that look alike - one binding, used twice.
   *   2. take both delegates off the SAME client the page read uses
   *      (`tx ?? this.client`), so a count inside a transaction sees what the
   *      page read sees.
   *
   * COUNTED ONLY WHEN `cursor` IS UNDEFINED, in this one place, so the three
   * list repositories cannot each decide it differently. A COUNT over one
   * traversal's predicate answers the same number on every page of that
   * traversal, so re-running it per page paid for a footer that had not changed
   * - page 7 of a board re-counting a table that grows without bound. A cursored page returns `total: null` and the
   * client carries the first page's answer forward; every filter, sort, tab or
   * search change drops the cursor, which is what makes the recount happen
   * exactly when the population it describes can have changed shape.
   *
   * THE COUNT IS A THUNK, not a promise, and that is the whole mechanism. A
   * Prisma promise is lazy, so an un-awaited `delegate.count(...)` would not
   * run - but it would still have been BUILT, and a later refactor that awaited
   * it (or a floating-promise lint fix that did) would silently reinstate the
   * per-page count. Taking a function means the query is never constructed on a
   * cursored page and there is nothing to accidentally await.
   *
   * The rows are awaited HERE rather than handed back as a pair, and that is
   * not style either: an un-awaited promise would execute after the caller's
   * ALS request scope had exited, and anything reading the ALS would see no
   * store.
   *
   * DELIBERATELY NOT AN INTERACTIVE TRANSACTION. One was considered and is the
   * wrong trade here. Prisma inherits the database default isolation level,
   * which is READ COMMITTED, where every statement takes its own snapshot - so
   * a plain `$transaction` would buy the shared connection and none of the
   * consistency it appears to promise. Buying the consistency means
   * `RepeatableRead` and a pool connection held across two statements on the
   * hottest read paths in the app, to prevent a footer reading "z 135" in the
   * instant the truth became 136. The rows are right either way, the cursor
   * still traverses correctly, and the next first page corrects the label.
   * Point 1 above is the guarantee that actually matters, and it costs nothing.
   */
  protected async pageWithTotal<TRow>(
    rows: Promise<TRow[]>,
    count: () => Promise<number>,
    cursor: string | undefined,
  ): Promise<IPageRowsWithTotal<TRow>> {
    if (cursor !== undefined) return { rows: await rows, total: null };
    const [pageRows, matching] = await Promise.all([rows, count()]);
    return { rows: pageRows, total: matching };
  }

  /**
   * Optimistic-lock update helper.
   *
   * Conventions:
   *   - Every editable aggregate gets `version Int @default(0)` in
   *     schema.prisma.
   *   - The caller reads the row, gets `version`, runs business logic, then
   *     calls `updateWithVersion(model, id, version, data)`.
   *   - The query bumps `version` by 1 atomically. If the row no longer matches
   *     `expectedVersion` it was changed since the caller read it, so Prisma
   *     raises P2025 and this translates it to `ConcurrencyError`. The router
   *     surfaces HTTP 409.
   *
   * Why this matters: `prisma.invoice.update({ where: { id }, data: ... })`
   * silently last-write-wins. Two AP clerks editing the same invoice = one
   * loses changes with zero indication. With this helper, the loser gets a
   * conflict error and can re-fetch.
   *
   * One statement, not two. `version` is a non-unique field in a where-unique,
   * which Prisma's extended `whereUnique` allows, so the guard and the write are
   * a single atomic `update` that also RETURNS the row it wrote. The earlier
   * `updateMany` + `findUniqueOrThrow` pair could return a row a concurrent
   * writer had already moved past, and raised a bare P2025 if that writer
   * deleted it between the two statements.
   *
   * Pass `tx` when calling inside `$transaction`. Without it the helper would
   * take a SECOND pool connection and block on row locks held by the enclosing
   * uncommitted transaction: a self-deadlock that only unwinds on
   * `statement_timeout`.
   *
   * Usage in a concrete repository:
   *
   *   class InvoiceRepository extends BaseRepository {
   *     update(id: string, version: number, patch: Partial<Invoice>) {
   *       return this.updateWithVersion('invoice', id, version, patch);
   *     }
   *   }
   *
   * `model` is the lowercased delegate name on `prisma.client`
   * (`'invoice'`, `'user'`, etc.). Typed loosely on purpose: the generic
   * client type is the source of truth, this helper is a thin wrapper.
   */
  protected async updateWithVersion<T = unknown>(
    model: string,
    id: string,
    expectedVersion: number,
    data: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<T> {
    // Dynamic delegate lookup by name: Prisma's typed client doesn't expose the
    // write methods generically, so concrete repositories wrap this with strong
    // types. `tx ?? this.client` keeps the write on the caller's connection.
    const delegate = (
      (tx ?? this.client) as unknown as Record<string, { update: (args: unknown) => Promise<T> }>
    )[model];
    if (!delegate) {
      throw new InvariantError(`Unknown Prisma delegate: ${model}`);
    }

    try {
      return await delegate.update({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (err) {
      // P2025 here means the id+version pair matched nothing: either another
      // writer bumped the version, or the row is gone. Both are the conflict
      // this helper exists to report.
      if (isPrismaErrorCode(err, PRISMA_ERROR.RECORD_NOT_FOUND)) {
        throw new ConcurrencyError(model, id, expectedVersion);
      }
      throw err;
    }
  }
}
