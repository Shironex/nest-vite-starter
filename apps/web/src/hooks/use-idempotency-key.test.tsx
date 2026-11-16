import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useIdempotencyKey } from './use-idempotency-key';

/**
 * The whole point of this hook is STABILITY across re-renders and retries: a
 * key that changes per render would silently disable server-side deduplication
 * while still looking wired up, which is the failure mode these assertions pin.
 */
describe('useIdempotencyKey', () => {
  it('mints a key up front', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    expect(result.current.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('keeps the same key across re-renders, so a retry reuses it', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.idempotencyKey;

    rerender();
    rerender();

    expect(result.current.idempotencyKey).toBe(first);
  });

  it('mints a fresh key on reset, so the next submission is new work', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.idempotencyKey;

    act(() => result.current.reset());

    expect(result.current.idempotencyKey).not.toBe(first);
  });

  it('gives two concurrent forms different keys', () => {
    const a = renderHook(() => useIdempotencyKey());
    const b = renderHook(() => useIdempotencyKey());

    expect(a.result.current.idempotencyKey).not.toBe(b.result.current.idempotencyKey);
  });

  it('keeps reset referentially stable so it can be passed straight to onSuccess', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.reset;

    rerender();

    expect(result.current.reset).toBe(first);
  });
});
