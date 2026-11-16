import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppErrorCode } from '@repo/shared/errors';
import { useUIStore } from '@/stores/ui-store';
import { Route } from './_authenticated';

/**
 * The app shell's guard: a signed-out visitor goes to sign-in with their
 * destination, a 2FA-enrollment refusal goes to the enroll screen, and anything
 * else rethrows so a transient failure never logs a valid session out.
 */
const { profile, isUnauthorized, appErrorCode } = vi.hoisted(() => ({
  profile: { current: null as unknown, error: null as unknown },
  isUnauthorized: { current: false },
  appErrorCode: { current: undefined as string | undefined },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({ options }),
    Outlet: () => null,
  };
});

vi.mock('@/lib/trpc', () => ({
  trpc: { user: { me: { queryOptions: () => ({ queryKey: ['user.me'] }) } } },
  isUnauthorizedError: () => isUnauthorized.current,
}));

vi.mock('@/lib/trpc-errors', () => ({ getAppErrorCode: () => appErrorCode.current }));

vi.mock('@/hooks/use-socket', () => ({ useSocket: () => undefined }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ isAuthenticated: true }),
  USER_ME_STALE_TIME: 0,
}));
vi.mock('@/features/notifications/components/NotificationBell', () => ({
  NotificationBell: () => null,
}));
vi.mock('@/features/two-factor/components/GraceBanner', () => ({ GraceBanner: () => null }));

/*
 * Stand-ins for the two shell pieces, kept on the REAL primitives so the thing
 * under test is untouched: `AppSidebar` renders a `Sidebar` with the same
 * `collapsible="icon"` it uses in production, which is what carries
 * `data-state`, and the topbar contributes the real `SidebarTrigger`. Their nav
 * content is what makes them expensive to mount and is not what is being
 * asserted.
 */
vi.mock('@/features/layout/components/AppSidebar', async () => {
  const { Sidebar } = await import('@repo/ui/sidebar');
  return { AppSidebar: () => <Sidebar collapsible="icon" /> };
});
vi.mock('@/features/layout/components/AppTopbar', async () => {
  const { SidebarTrigger } = await import('@repo/ui/sidebar');
  return { AppTopbar: () => <SidebarTrigger /> };
});

afterEach(cleanup);

const context = {
  queryClient: {
    ensureQueryData: () => {
      if (profile.error !== null) return Promise.reject(profile.error);
      return Promise.resolve(profile.current);
    },
  },
};

const beforeLoad = Route.options.beforeLoad as unknown as (args: {
  context: typeof context;
  location: { href: string };
}) => Promise<void>;

const run = () => beforeLoad({ context, location: { href: '/settings' } });

/** A TanStack redirect carries its target under `options`, not on itself. */
async function redirectTarget(): Promise<unknown> {
  try {
    await run();
  } catch (thrown) {
    return (thrown as { options?: unknown }).options;
  }
  throw new Error('expected a redirect');
}

beforeEach(() => {
  profile.current = { role: 'USER' };
  profile.error = null;
  isUnauthorized.current = false;
  appErrorCode.current = undefined;
});

describe('/_authenticated guard', () => {
  it('lets a signed-in account through', async () => {
    await expect(run()).resolves.toBeUndefined();
  });

  it('still sends a signed-out visitor to sign in with their destination', async () => {
    profile.error = new Error('unauthorized');
    isUnauthorized.current = true;

    await expect(redirectTarget()).resolves.toMatchObject({
      to: '/auth/login',
      search: { redirect: '/settings' },
    });
  });

  it('still routes a 2FA-enrollment refusal to the enroll screen', async () => {
    profile.error = new Error('enroll first');
    appErrorCode.current = AppErrorCode.TWO_FACTOR_ENROLLMENT_REQUIRED;

    await expect(redirectTarget()).resolves.toMatchObject({ to: '/enroll-two-factor' });
  });

  it('rethrows a transport failure rather than logging a valid session out', async () => {
    profile.error = new Error('boom');

    await expect(run()).rejects.toThrow('boom');
  });
});

/**
 * The staff shell's sidebar wiring.
 *
 * WHY THIS RENDERS THE LAYOUT RATHER THAN THE PRIMITIVE. `SidebarProvider`
 * works: given `open` it collapses. The defect lived in how this ROUTE handed
 * it over, `onOpenChange` with no `open`, which orphaned the provider's
 * internal state so a toggle persisted to the store and changed nothing on
 * screen until the next mount reseeded it from `defaultOpen`. A test of the
 * primitive alone passes against that bug, so the assertion has to be made
 * where the two halves meet.
 */
describe('/_authenticated sidebar', () => {
  const Layout = Route.options.component as () => ReactElement;

  beforeEach(() => {
    useUIStore.setState({ sidebarCollapsed: false });
  });

  it('collapses the rail on the same render as the toggle, with no remount', () => {
    render(<Layout />);
    const rail = () => document.querySelector('[data-slot="sidebar"]');

    expect(rail()).toHaveAttribute('data-state', 'expanded');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));

    expect(rail()).toHaveAttribute('data-state', 'collapsed');
  });

  it('records the collapse in the store, so it survives a reload', () => {
    render(<Layout />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));

    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it('follows the store when something other than the trigger collapses it', () => {
    render(<Layout />);

    act(() => {
      useUIStore.getState().setSidebarCollapsed(true);
    });

    expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-state',
      'collapsed',
    );
  });

  it('re-expands, so the control is not one way', () => {
    useUIStore.setState({ sidebarCollapsed: true });
    render(<Layout />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));

    expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-state',
      'expanded',
    );
  });
});
