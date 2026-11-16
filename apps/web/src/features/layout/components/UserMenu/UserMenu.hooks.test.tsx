import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUserMenu } from './UserMenu.hooks';

const { logoutFn, navigate, clear, resetCsrfToken, toastError, authUser } = vi.hoisted(() => ({
  logoutFn: vi.fn(),
  navigate: vi.fn(),
  clear: vi.fn(),
  resetCsrfToken: vi.fn(),
  toastError: vi.fn(),
  authUser: {
    current: { email: 'jane@example.com', displayName: 'Jane Doe' } as {
      email: string;
      displayName: string | null;
    } | null,
  },
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@repo/ui/sonner', () => ({ toast: { error: toastError } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: authUser.current }) }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { logout: { mutationOptions: (opts?: object) => ({ mutationFn: logoutFn, ...opts }) } },
  },
  resetCsrfToken,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ clear }) };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  authUser.current = { email: 'jane@example.com', displayName: 'Jane Doe' };
});

describe('useUserMenu', () => {
  it('returns null until the profile has loaded', () => {
    authUser.current = null;
    const { result } = renderHook(() => useUserMenu(), { wrapper });
    expect(result.current).toBeNull();
  });

  it('derives the display name, email and initials', () => {
    const { result } = renderHook(() => useUserMenu(), { wrapper });
    expect(result.current?.displayName).toBe('Jane Doe');
    expect(result.current?.email).toBe('jane@example.com');
    expect(result.current?.initials).toBe('JD');
  });

  it('falls back to the email when the profile has no display name', () => {
    authUser.current = { email: 'jane@example.com', displayName: null };
    const { result } = renderHook(() => useUserMenu(), { wrapper });
    expect(result.current?.displayName).toBe('jane@example.com');
  });

  it('names the icon-only trigger with the current user', () => {
    const { result } = renderHook(() => useUserMenu(), { wrapper });
    expect(result.current?.labels.trigger).toContain('Jane Doe');
  });

  it('clears the CSRF token and query cache then routes to login on logout', async () => {
    logoutFn.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useUserMenu(), { wrapper });

    result.current?.onLogout();

    await waitFor(() => expect(resetCsrfToken).toHaveBeenCalledOnce());
    expect(clear).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ to: '/auth/login' });
  });

  it('surfaces a toast when logout fails', async () => {
    logoutFn.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useUserMenu(), { wrapper });

    result.current?.onLogout();

    await waitFor(() => expect(toastError).toHaveBeenCalledOnce());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('routes to settings from the menu action', () => {
    const { result } = renderHook(() => useUserMenu(), { wrapper });
    result.current?.onNavigateToSettings();
    expect(navigate).toHaveBeenCalledWith({ to: '/settings' });
  });
});
