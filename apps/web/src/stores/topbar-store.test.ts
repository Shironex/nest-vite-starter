import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSetTopbarSubtitle, useTopbarStore } from './topbar-store';

afterEach(() => {
  useTopbarStore.setState({ subtitle: null, ownerId: null });
});

describe('topbar subtitle store', () => {
  it('publishes while a page is mounted and clears when it unmounts', () => {
    const { unmount } = renderHook(() => useSetTopbarSubtitle('12 users'));
    expect(useTopbarStore.getState().subtitle).toBe('12 users');

    unmount();
    expect(useTopbarStore.getState().subtitle).toBeNull();
  });

  it('republishes when the value changes without losing ownership', () => {
    const { rerender } = renderHook(({ value }) => useSetTopbarSubtitle(value), {
      initialProps: { value: 'loading' },
    });

    rerender({ value: '12 users' });
    expect(useTopbarStore.getState().subtitle).toBe('12 users');
  });

  it('lets a page publish nothing, leaving the shell with the title alone', () => {
    renderHook(() => useSetTopbarSubtitle(null));
    expect(useTopbarStore.getState().subtitle).toBeNull();
  });

  /**
   * The regression this store exists to avoid.
   *
   * On navigation React can mount the incoming page BEFORE running the outgoing
   * page's cleanup. With an unconditional clear, the outgoing cleanup would wipe
   * the subtitle the incoming page had already published, and the row would sit
   * empty until something else happened to re-render it. Only the current owner
   * may withdraw.
   */
  it('does not let a stale unmount clear the subtitle a newer page published', () => {
    const outgoing = renderHook(() => useSetTopbarSubtitle('page A'));
    const incoming = renderHook(() => useSetTopbarSubtitle('page B'));

    // Incoming mounted second, so it owns the slot.
    expect(useTopbarStore.getState().subtitle).toBe('page B');

    // Outgoing now cleans up, out of order.
    outgoing.unmount();

    expect(useTopbarStore.getState().subtitle).toBe('page B');

    incoming.unmount();
    expect(useTopbarStore.getState().subtitle).toBeNull();
  });
});
