/**
 * The two halves of the repo's keyset-pagination idiom, written once.
 *
 * Every list surface pages the same way: order by a deterministic key with `id`
 * as the tiebreak, ask for `limit + 1` rows, and let the presence of that extra
 * row answer "is there another page" without a COUNT. It was re-implemented at
 * five call sites, and two of them had already drifted apart cosmetically,
 * proof that the sixth would be a copy of whichever one the next author found.
 *
 * The off-by-one is the reason to share it rather than the repetition. Slicing
 * to `limit` and then reading the cursor off the SLICED page is what makes the
 * next request start after the last row the client actually saw; reading it off
 * the unsliced `rows` would skip one row per page, silently, on every list in
 * the app.
 *
 * DELIBERATELY NOT AN ABSTRACTION OVER THE QUERY. The `where`, the `orderBy`
 * and the `include` differ per surface for real reasons, and a generic list
 * repository would either flatten those differences or grow an options object
 * that is harder to read than the query it replaced.
 */

/**
 * `limit + 1` fetched rows plus the TOTAL matching the same `where`, on the
 * FIRST page only.
 *
 * The shape a repository hands back once its list surface has to label itself
 * ("Showing 1-25 of 312"). The rows still page by cursor; the total only
 * says how big the population under them is. Produced by
 * `BaseRepository.pageWithTotal`, whose docblock carries the contract: one
 * `where` binding, one client, so the count cannot measure a different
 * population than the rows.
 *
 * Not every list gets one. `audit.list` deliberately refuses a total; the reason
 * is written on `auditLogListOutput` in `@repo/shared/schemas`.
 *
 * NULL ON EVERY CURSORED PAGE, and that is the point of the field being
 * nullable rather than a defensive `| null`. A COUNT over one traversal's
 * predicate answers the same number on every page of that traversal, so the
 * count used to re-run per page to redraw a footer that had not changed, on
 * tables that grow without bound. `pageWithTotal` now issues it only when the caller supplied no
 * `cursor`, and the client carries the answer forward for as long as its filter
 * set holds; a filter, sort, tab or search change resets to page one, which is
 * the request that recounts.
 *
 * The alternatives that were considered and are worse: a capped `LIMIT 10001`
 * count makes the footer start lying at the exact volume where the saving would
 * matter, and echoing the previous total back as an INPUT would let a client
 * name the number the server prints.
 */
export interface IPageRowsWithTotal<TRow> {
  readonly rows: TRow[];
  /** The matching count on a first page, null on a page cut from a cursor. */
  readonly total: number | null;
}

/** One page of rows plus the cursor that continues it. */
export interface IIdCursorPage<TRow> {
  readonly rows: readonly TRow[];
  /** The id to pass back as `cursor`, or null when this is the last page. */
  readonly nextCursor: string | null;
}

/**
 * Turn `limit + 1` fetched rows into a page of at most `limit` and its cursor.
 *
 * `nextCursor` is null on the final page rather than the last row's id, so a
 * client that keeps paging until it is null stops instead of re-requesting an
 * empty page forever.
 */
export function pageByIdCursor<TRow extends { readonly id: string }>(
  rows: readonly TRow[],
  limit: number,
): IIdCursorPage<TRow> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { rows: page, nextCursor: hasMore && last !== undefined ? last.id : null };
}

/**
 * The `cursor` / `skip` half, for spreading into a Prisma `findMany`.
 *
 * `skip: 1` is not optional and is the half that is easy to forget: Prisma's
 * cursor is INCLUSIVE, so without it every page after the first repeats the row
 * the previous page ended on. An absent cursor contributes nothing at all
 * rather than `cursor: undefined`, which Prisma treats differently.
 */
export function idCursorArgs(cursor: string | undefined): {
  cursor?: { id: string };
  skip?: number;
} {
  return cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 };
}
