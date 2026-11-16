import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDashboardPage } from './DashboardPage.hooks';

const state = vi.hoisted(() => ({
  data: undefined as { displayName?: string | null; email?: string | null } | undefined,
}));

vi.mock('../../Dashboard.queries', () => ({
  useDashboardUser: () => ({ data: state.data }),
}));

afterEach(() => {
  state.data = undefined;
});

describe('useDashboardPage', () => {
  it('greets by display name when the profile has one', () => {
    state.data = { displayName: 'Ada Lovelace', email: 'ada@example.com' };
    const { result } = renderHook(() => useDashboardPage());

    expect(result.current.greeting).toBe('Good day, Ada Lovelace');
  });

  it('falls back to the email HANDLE, not the whole address', () => {
    state.data = { displayName: null, email: 'ada@example.com' };
    const { result } = renderHook(() => useDashboardPage());

    // The recon screenshots caught "Good day, admin@example.com": greeting
    // somebody with a mailbox is the thing this pins out.
    expect(result.current.greeting).toBe('Good day, ada');
  });

  it('never renders "undefined" while user.me is still in flight', () => {
    const { result } = renderHook(() => useDashboardPage());

    expect(result.current.greeting).toBe('Good day, there');
    expect(result.current.greeting).not.toMatch(/undefined|null/);
  });

  it('translates the subtitle rather than returning a raw key', () => {
    const { result } = renderHook(() => useDashboardPage());

    expect(result.current.subtitle).toBe('Here is what is happening in your organization today.');
  });

  it('publishes an English long date for the topbar, capitalized', () => {
    const { result } = renderHook(() => useDashboardPage());

    // Weekday, month name, day and year. The leading capital is the thing
    // worth pinning: it is applied deliberately rather than by a CSS
    // capitalize that would also touch the month, so it must hold for any
    // locale the app is configured with.
    expect(result.current.todayLabel).toMatch(/^[A-Z]\p{L}*, \p{L}+ \d{1,2}, \d{4}$/u);
  });
});
