import { idCursorArgs, pageByIdCursor } from './cursor-page';

const rowsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `r-${index}` }));

describe('pageByIdCursor', () => {
  it('trims the probe row and points the cursor at the LAST ROW THE CLIENT SEES', () => {
    // The off-by-one this helper exists for: reading the cursor off the
    // unsliced rows would skip one row per page, silently, on every list.
    const { rows, nextCursor } = pageByIdCursor(rowsOf(4), 3);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.id)).toEqual(['r-0', 'r-1', 'r-2']);
    expect(nextCursor).toBe('r-2');
  });

  it('ends the walk with a null cursor when the page is exactly full', () => {
    // A cursor here would make a client that pages until null request an empty
    // page forever.
    expect(pageByIdCursor(rowsOf(3), 3).nextCursor).toBeNull();
  });

  it('ends the walk with a null cursor on a short page', () => {
    const { rows, nextCursor } = pageByIdCursor(rowsOf(2), 3);
    expect(rows).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });

  it('answers an empty result with no page and no cursor', () => {
    expect(pageByIdCursor([], 25)).toEqual({ rows: [], nextCursor: null });
  });

  it('reports more when there is more, whatever the overshoot', () => {
    const { rows, nextCursor } = pageByIdCursor(rowsOf(50), 2);
    expect(rows.map((row) => row.id)).toEqual(['r-0', 'r-1']);
    expect(nextCursor).toBe('r-1');
  });
});

describe('idCursorArgs', () => {
  it('contributes nothing at all for a first page', () => {
    // Not `cursor: undefined`, which Prisma treats differently from absent.
    expect(idCursorArgs(undefined)).toEqual({});
    expect(Object.hasOwn(idCursorArgs(undefined), 'cursor')).toBe(false);
  });

  it('skips the cursor row, because Prisma cursors are INCLUSIVE', () => {
    // Without skip: 1 every page after the first repeats the row the previous
    // page ended on.
    expect(idCursorArgs('r-7')).toEqual({ cursor: { id: 'r-7' }, skip: 1 });
  });
});
