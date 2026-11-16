import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@repo/shared/permissions';
import { layoutStrings } from '@/features/layout/Layout.strings';
import { useAppSidebar } from './AppSidebar.hooks';

const { pathname, user } = vi.hoisted(() => ({
  pathname: { current: '/dashboard' },
  user: { current: { role: 'USER' } as { role: string } | null },
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ location: { pathname: pathname.current } }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: user.current }),
}));

function hrefs() {
  const { result } = renderHook(() => useAppSidebar());
  return result.current.groups.flatMap((group) => group.items.map((item) => item.href));
}

beforeEach(() => {
  pathname.current = '/dashboard';
  user.current = { role: 'USER' };
});

describe('useAppSidebar', () => {
  it('exposes only entries backed by a real route', () => {
    expect(hrefs()).toEqual(['/dashboard', '/workspaces', '/settings']);
  });

  it('adds the admin-only audit log for an admin', () => {
    user.current = { role: ROLES.ADMIN };
    expect(hrefs()).toContain('/audit');
  });

  it('hides the admin-only entry from a signed-out reader', () => {
    user.current = null;
    expect(hrefs()).not.toContain('/audit');
  });

  it('marks the entry for the current route active', () => {
    pathname.current = '/workspaces';
    const { result } = renderHook(() => useAppSidebar());
    const items = result.current.groups.flatMap((group) => group.items);
    expect(items.filter((item) => item.isActive).map((item) => item.href)).toEqual(['/workspaces']);
  });

  it('keeps the parent entry active on a nested route', () => {
    pathname.current = '/workspaces/f-1';
    const { result } = renderHook(() => useAppSidebar());
    const items = result.current.groups.flatMap((group) => group.items);
    expect(items.find((item) => item.href === '/workspaces')?.isActive).toBe(true);
  });

  it('does not activate /settings from /compliance/settings', () => {
    pathname.current = '/compliance/settings';
    user.current = { role: ROLES.ADMIN };
    const { result } = renderHook(() => useAppSidebar());
    const items = result.current.groups.flatMap((group) => group.items);
    expect(items.find((item) => item.href === '/settings')?.isActive).toBe(false);
  });

  it('names the group labels and the landmark name', () => {
    const { result } = renderHook(() => useAppSidebar());
    expect(result.current.navLabel).toBe(layoutStrings.nav.primary);
    expect(result.current.groups.map((group) => group.label)).toEqual([
      layoutStrings.nav.groupMain,
      layoutStrings.nav.groupSettings,
    ]);
  });
});
