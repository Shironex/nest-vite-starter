import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorCode } from '@repo/shared/errors';
import { useTwoFactorChallenge } from './TwoFactorChallenge.hooks';

const navigate = vi.fn();
const { verifyFn, resetCsrfToken, toastError, search } = vi.hoisted(() => ({
  verifyFn: vi.fn(),
  resetCsrfToken: vi.fn(),
  toastError: vi.fn(),
  search: { redirect: '/settings' as string | undefined },
}));

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => search }),
  useNavigate: () => navigate,
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { verifyTwoFactor: { mutationOptions: () => ({ mutationFn: verifyFn }) } },
    user: { me: { queryOptions: () => ({ queryKey: ['user.me'] }) } },
  },
  resetCsrfToken,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
  search.redirect = '/settings';
});

describe('useTwoFactorChallenge', () => {
  it('toggles recovery mode and clears the code', () => {
    const { result } = renderHook(() => useTwoFactorChallenge(), { wrapper });
    expect(result.current.isRecoveryMode).toBe(false);
    act(() => result.current.onToggleRecoveryMode());
    expect(result.current.isRecoveryMode).toBe(true);
  });

  it('navigates to the redirect target on success', async () => {
    verifyFn.mockResolvedValue({ status: 'ok', user: {}, requiresVerification: false });
    const { result } = renderHook(() => useTwoFactorChallenge(), { wrapper });

    act(() => result.current.onSubmit({ code: '123456' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/settings' }));
    expect(resetCsrfToken).toHaveBeenCalled();
  });

  it('lands on the dashboard when nothing asked for a redirect', async () => {
    search.redirect = undefined;
    verifyFn.mockResolvedValue({
      status: 'ok',
      user: {},
      requiresVerification: false,
    });
    const { result } = renderHook(() => useTwoFactorChallenge(), { wrapper });

    act(() => result.current.onSubmit({ code: '123456' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/dashboard' }));
  });

  it('bounces to login when the challenge expired', async () => {
    verifyFn.mockRejectedValue({ data: { appCode: AppErrorCode.TWO_FACTOR_CHALLENGE_EXPIRED } });
    const { result } = renderHook(() => useTwoFactorChallenge(), { wrapper });

    act(() => result.current.onSubmit({ code: '000000' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/auth/login' }));
    expect(toastError).toHaveBeenCalled();
  });

  it('shows an inline error for an invalid code', async () => {
    verifyFn.mockRejectedValue({ data: { appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE } });
    const { result } = renderHook(() => useTwoFactorChallenge(), { wrapper });

    act(() => result.current.onSubmit({ code: '999999' }));

    await waitFor(() => expect(result.current.serverError).toBeTruthy());
    expect(navigate).not.toHaveBeenCalled();
  });
});
