import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from './auth';

/**
 * The auth layout sends an already-signed-in visitor to the app shell.
 */
const { profile } = vi.hoisted(() => ({
  profile: { current: null as unknown, error: null as unknown },
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
}));

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
  location: { pathname: string };
  search: Record<string, unknown>;
}) => Promise<void>;

const run = (pathname = '/auth/login') =>
  beforeLoad({ context, location: { pathname }, search: {} });

async function redirectTarget(pathname?: string): Promise<unknown> {
  try {
    await run(pathname);
  } catch (thrown) {
    return (thrown as { options?: unknown }).options;
  }
  throw new Error('expected a redirect');
}

beforeEach(() => {
  profile.current = null;
  profile.error = new Error('unauthorized');
});

describe('/auth layout guard', () => {
  it('lets a signed-out visitor reach the sign-in screen', async () => {
    await expect(run()).resolves.toBeUndefined();
  });

  it('sends a signed-in account to the app shell', async () => {
    profile.error = null;
    profile.current = { role: 'USER' };

    await expect(redirectTarget()).resolves.toMatchObject({ to: '/dashboard' });
  });

  it('forwards a bare /auth visit to the sign-in screen', async () => {
    await expect(redirectTarget('/auth')).resolves.toMatchObject({ to: '/auth/login' });
  });
});
