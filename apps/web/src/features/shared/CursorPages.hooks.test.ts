import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCarriedTotal, useCursorPages } from './CursorPages.hooks';

describe('useCursorPages', () => {
  it('opens on page one with no cursor and nowhere to go back to', () => {
    const { result } = renderHook(() => useCursorPages());

    expect(result.current.cursor).toBeUndefined();
    expect(result.current.page).toBe(1);
    expect(result.current.hasPrevious).toBe(false);
  });

  it('remembers the cursor that opened each page, so back is a pop not a query', () => {
    const { result } = renderHook(() => useCursorPages());

    act(() => result.current.onNext('c2'));
    expect(result.current).toMatchObject({ cursor: 'c2', page: 2, hasPrevious: true });

    act(() => result.current.onNext('c3'));
    expect(result.current).toMatchObject({ cursor: 'c3', page: 3 });

    act(() => result.current.onPrevious());
    expect(result.current).toMatchObject({ cursor: 'c2', page: 2 });

    act(() => result.current.onPrevious());
    expect(result.current).toMatchObject({ cursor: undefined, page: 1, hasPrevious: false });
  });

  it('refuses to advance past the last page', () => {
    // A null nextCursor means the API said there is nothing after this. Pushing
    // it would re-query page one while the footer claimed page two.
    const { result } = renderHook(() => useCursorPages());

    act(() => result.current.onNext(null));

    expect(result.current.page).toBe(1);
    expect(result.current.cursor).toBeUndefined();
  });

  it('cannot be walked back past page one', () => {
    const { result } = renderHook(() => useCursorPages());

    act(() => result.current.onPrevious());

    expect(result.current.page).toBe(1);
  });

  it('returns to page one on reset, because a cursor belongs to one filter set', () => {
    const { result } = renderHook(() => useCursorPages());
    act(() => result.current.onNext('c2'));
    act(() => result.current.onNext('c3'));

    act(() => result.current.reset());

    expect(result.current).toMatchObject({ cursor: undefined, page: 1, hasPrevious: false });
  });
});

describe('useCarriedTotal', () => {
  it('reports nothing until the first page answers', () => {
    // Undefined rather than 0, so a caller can tell "not counted yet" from
    // "counted zero" and render no footer instead of "z 0".
    const { result } = renderHook(({ total }) => useCarriedTotal(total), {
      initialProps: { total: undefined as number | null | undefined },
    });

    expect(result.current).toBeUndefined();
  });

  it('holds the first page total across pages that report null', () => {
    // The contract: `total` is a number on the request with no cursor and null
    // on every page after it, so without this the summary would lose its
    // "of 312" the moment the reader pressed "Next".
    const { result, rerender } = renderHook(({ total }) => useCarriedTotal(total), {
      initialProps: { total: 312 as number | null },
    });
    expect(result.current).toBe(312);

    rerender({ total: null });
    expect(result.current).toBe(312);

    rerender({ total: null });
    expect(result.current).toBe(312);
  });

  it('takes the new number as soon as a first page recounts', () => {
    // Which is what a filter, tab, sort or search change causes: the reset
    // drops the cursor, so the next request counts again.
    const { result, rerender } = renderHook(({ total }) => useCarriedTotal(total), {
      initialProps: { total: 312 as number | null },
    });
    rerender({ total: null });

    rerender({ total: 12 });

    expect(result.current).toBe(12);
  });

  it('carries a zero, because zero is a counted answer', () => {
    const { result, rerender } = renderHook(({ total }) => useCarriedTotal(total), {
      initialProps: { total: 0 as number | null },
    });

    rerender({ total: null });

    expect(result.current).toBe(0);
  });
});
