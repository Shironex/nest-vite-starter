import { useState } from 'react';

/**
 * Forward-and-back traversal of a keyset-paged list.
 *
 * WHY THIS EXISTS. Both admin lists (users and the audit log) page by keyset,
 * and each used to keep its own `useState<string | undefined>(cursor)` plus a
 * `previousPages` array that APPENDED every page onto the last, behind a
 * "Show more" button: the same twenty lines twice, and two different footers.
 *
 * A keyset cursor cannot answer "give me page 7" (it names a row, not a
 * position), so no list in this app has numbered pages. What they all have is
 * prev/next with a stated position and, where the contract can afford a count,
 * the total beside it. Getting BACK is the part a bare cursor cannot do on its
 * own, and this hook is that part: a stack of the cursors already visited, one
 * per page, so "Previous" is a pop rather than a second query the API has no
 * way to express.
 *
 * The stack holds the cursor that OPENS each page. `stack[0]` is `undefined`,
 * which is page one, so `page` is simply the stack's length.
 */
export interface ICursorPagesView {
  /** The cursor for the page currently on screen. Feed it to the query. */
  readonly cursor: string | undefined;
  /** 1-based, for the footer's range summary. */
  readonly page: number;
  readonly hasPrevious: boolean;
  readonly onPrevious: () => void;
  /**
   * Advance, given the `nextCursor` the current page's response carried. A
   * `null` is a no-op rather than a state that would query the first page
   * again while claiming to be further along.
   */
  readonly onNext: (nextCursor: string | null) => void;
  /**
   * Return to page one. A cursor minted under one filter set does not address
   * the same rows under another, so every filter change calls this.
   */
  readonly reset: () => void;
}

export function useCursorPages(): ICursorPagesView {
  const [stack, setStack] = useState<readonly (string | undefined)[]>([undefined]);

  return {
    cursor: stack[stack.length - 1],
    page: stack.length,
    hasPrevious: stack.length > 1,
    onPrevious: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    onNext: (nextCursor: string | null) => {
      if (nextCursor === null) return;
      setStack((current) => [...current, nextCursor]);
    },
    reset: () => setStack([undefined]),
  };
}

/**
 * Hold on to the total the FIRST page reported, for the pages after it.
 *
 * The list contracts count only when the request carries no cursor: a COUNT
 * over one traversal's predicate answers the same number on every page of it,
 * so re-running it per page bought a footer that had not changed. `total` is
 * therefore a number on page one and null on every page after, and something on
 * the client has to remember it or the summary would lose its "of 312" the
 * moment the reader pressed "Next".
 *
 * THE LIVE VALUE WINS OVER THE REMEMBERED ONE, which is what makes this
 * flicker-free. A response that carries a number is returned in the same render
 * it arrived in, and the store behind it is only what the CURSORED pages read.
 * Returning the stored value instead would show the previous filter set's total
 * for one render every time a filter change recounted.
 *
 * The store is adjusted DURING RENDER rather than from an effect, which is
 * React's own answer for state derived from a changing input
 * (react.dev, "You Might Not Need an Effect"). React discards the render in
 * progress and re-runs this component immediately, before anything is painted,
 * so there is no second frame; an effect would schedule a cascading render
 * after the paint instead, and the lint refuses one for that reason.
 *
 * NOTHING CLEARS IT, because nothing needs to. A filter, tab, sort or search
 * change resets the cursor stack, which makes the next request a first page,
 * which returns a fresh count that supersedes this one. In the moment between
 * those two the footer states the previous filter set's total over the previous
 * filter set's rows, which `keepPreviousData` is already showing dimmed and
 * aria-busy: the summary and the rows stay consistent with each other, which is
 * the invariant that matters.
 *
 * Undefined until the first page answers, so a caller can tell "no total yet"
 * from "counted zero" and render no footer rather than "z 0".
 */
export function useCarriedTotal(total: number | null | undefined): number | undefined {
  const [carried, setCarried] = useState<number | undefined>(undefined);

  if (total !== null && total !== undefined && total !== carried) setCarried(total);

  return total ?? carried;
}
