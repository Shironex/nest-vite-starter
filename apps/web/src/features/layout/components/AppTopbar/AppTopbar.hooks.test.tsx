import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { commonStrings } from '@/lib/strings';
import { useTopbarStore } from '@/stores/topbar-store';
import { useAppTopbar } from './AppTopbar.hooks';

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/dashboard' } }));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ location: { pathname: pathname.current } }),
}));

function titleFor(path: string) {
  pathname.current = path;
  return renderHook(() => useAppTopbar()).result.current.title;
}

beforeEach(() => {
  pathname.current = '/dashboard';
});

describe('useAppTopbar', () => {
  it('uses the route page title, which can differ from the sidebar label', () => {
    expect(titleFor('/dashboard')).toBe(commonStrings.pageTitle.dashboard);
  });

  it('resolves a nested route to its parent entry', () => {
    expect(titleFor('/admin/a-1')).toBe(commonStrings.pageTitle.admin);
  });

  it('prefers the deepest matching entry', () => {
    expect(titleFor('/settings/security')).toBe(commonStrings.pageTitle.settings);
  });

  it('falls back to the product name outside the nav', () => {
    expect(titleFor('/somewhere-else')).toBe(PRODUCT_NAME);
  });

  it('leaves the subtitle empty until a page publishes one', () => {
    const { result } = renderHook(() => useAppTopbar());
    expect(result.current.subtitle).toBeNull();
  });

  it('surfaces whatever the mounted page published', () => {
    // The shell cannot fetch this itself: the design's subtitles are live data
    // (a localized date, a record count) and `no-cross-feature-imports` stops
    // `layout` reaching into the features that own it, so the page publishes
    // into a shared store and the topbar reads it back.
    useTopbarStore.getState().publish('owner-1', '12 users, 9 active');

    const { result } = renderHook(() => useAppTopbar());
    expect(result.current.subtitle).toBe('12 users, 9 active');

    useTopbarStore.setState({ subtitle: null, ownerId: null });
  });
});
