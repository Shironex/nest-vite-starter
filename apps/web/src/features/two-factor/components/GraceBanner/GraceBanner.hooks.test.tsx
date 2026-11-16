import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGraceBanner } from './GraceBanner.hooks';

const { statusData } = vi.hoisted(() => ({ statusData: { value: undefined as unknown } }));

vi.mock('../../TwoFactor.queries', () => ({
  useTwoFactorStatus: () => ({ data: statusData.value }),
}));

afterEach(() => {
  statusData.value = undefined;
});

describe('useGraceBanner', () => {
  it('hides when already enabled', () => {
    statusData.value = {
      enabled: true,
      policy: { required: true, enforced: false, graceEndsAt: null },
    };
    const { result } = renderHook(() => useGraceBanner());
    expect(result.current.show).toBe(false);
  });

  it('hides once enforcement has kicked in', () => {
    statusData.value = {
      enabled: false,
      policy: { required: true, enforced: true, graceEndsAt: null },
    };
    const { result } = renderHook(() => useGraceBanner());
    expect(result.current.show).toBe(false);
  });

  it('shows with the deadline in the app locale during grace', () => {
    statusData.value = {
      enabled: false,
      // Midday UTC keeps the calendar day stable in any test time zone.
      policy: { required: true, enforced: false, graceEndsAt: new Date('2026-08-01T12:00:00Z') },
    };
    const { result } = renderHook(() => useGraceBanner());
    expect(result.current.show).toBe(true);
    // The app formatter's numeric date, not whatever the browser locale says.
    expect(result.current.deadlineLabel).toBe('08/01/2026');
  });

  it('has no deadline label when grace has no end date', () => {
    statusData.value = {
      enabled: false,
      policy: { required: true, enforced: false, graceEndsAt: null },
    };
    const { result } = renderHook(() => useGraceBanner());
    expect(result.current.deadlineLabel).toBeNull();
  });
});
