import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useEnrollOnlyScreen } from './EnrollOnlyScreen.hooks';

const navigate = vi.fn();
const { logoutFn, resetCsrfToken } = vi.hoisted(() => ({
  logoutFn: vi.fn(),
  resetCsrfToken: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { logout: { mutationOptions: () => ({ mutationFn: logoutFn }) } },
    user: { me: { queryOptions: () => ({ queryKey: ['user.me'] }) } },
  },
  resetCsrfToken,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useEnrollOnlyScreen', () => {
  it('logs out to the login route', async () => {
    logoutFn.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useEnrollOnlyScreen(), { wrapper });

    act(() => result.current.onLogout());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/auth/login' }));
    expect(resetCsrfToken).toHaveBeenCalled();
  });

  it('lands on the dashboard once enrollment completes', () => {
    const { result } = renderHook(() => useEnrollOnlyScreen(), { wrapper });
    act(() => result.current.onEnrollComplete());
    expect(navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });
});
