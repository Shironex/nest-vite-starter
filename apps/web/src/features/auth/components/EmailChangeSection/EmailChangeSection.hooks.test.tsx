import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorCode } from '@repo/shared/errors';
import { useEmailChangeSection } from './EmailChangeSection.hooks';

const { requestFn, statusFn, listFn, meFn, toastSuccess, toastError } = vi.hoisted(() => ({
  requestFn: vi.fn(),
  statusFn: vi.fn(),
  listFn: vi.fn(),
  meFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      requestEmailChange: { mutationOptions: () => ({ mutationFn: requestFn }) },
    },
    twoFactor: {
      status: { queryOptions: () => ({ queryKey: ['twoFactor', 'status'], queryFn: statusFn }) },
    },
    user: {
      me: { queryOptions: () => ({ queryKey: ['user', 'me'], queryFn: meFn }) },
    },
  },
}));
vi.mock('@/features/auth/ConnectedAccounts.queries', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    useOAuthAccounts: () => useQuery({ queryKey: ['oauth', 'listAccounts'], queryFn: listFn }),
  };
});

/** tRPC-shaped error: getAppErrorCode reads `error.data.appCode`. */
const appError = (appCode: AppErrorCode) =>
  Object.assign(new Error(appCode), { data: { appCode } });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  meFn.mockResolvedValue({ id: 'u-1', email: 'old@x.com' });
  statusFn.mockResolvedValue({ enabled: false });
  listFn.mockResolvedValue({ accounts: [] });
  requestFn.mockResolvedValue({ success: true });
});

describe('useEmailChangeSection', () => {
  it('exposes the session email, and 2FA/OAuth-driven flags', async () => {
    statusFn.mockResolvedValue({ enabled: true });
    listFn.mockResolvedValue({ accounts: [{ id: 'acc-1' }] });

    const { result } = renderHook(() => useEmailChangeSection(), { wrapper });

    await waitFor(() => {
      expect(result.current.currentEmail).toBe('old@x.com');
      expect(result.current.requiresFactorCode).toBe(true);
      expect(result.current.hasLinkedAccounts).toBe(true);
    });
  });

  it('submits the new address, strips an empty factor code, and records where the link went', async () => {
    const { result } = renderHook(() => useEmailChangeSection(), { wrapper });

    act(() => {
      result.current.onSubmit({ newEmail: 'new@x.com', factorCode: '' });
    });

    await waitFor(() => {
      expect(result.current.pendingSentTo).toBe('new@x.com');
    });
    // First positional arg only: TanStack Query appends its own context arg.
    expect(requestFn.mock.calls[0]?.[0]).toEqual({ newEmail: 'new@x.com' });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('passes a present factor code through', async () => {
    const { result } = renderHook(() => useEmailChangeSection(), { wrapper });

    act(() => {
      result.current.onSubmit({ newEmail: 'new@x.com', factorCode: '123456' });
    });

    await waitFor(() => {
      expect(requestFn.mock.calls[0]?.[0]).toEqual({
        newEmail: 'new@x.com',
        factorCode: '123456',
      });
    });
  });

  it('FORBIDDEN opens the sudo dialog and onSudoConfirmed retries the SAME submission', async () => {
    requestFn.mockRejectedValueOnce(appError(AppErrorCode.FORBIDDEN));

    const { result } = renderHook(() => useEmailChangeSection(), { wrapper });

    act(() => {
      result.current.onSubmit({ newEmail: 'new@x.com', factorCode: '' });
    });

    await waitFor(() => {
      expect(result.current.isDialogOpen).toBe(true);
    });
    // The re-prompt is the NORMAL expired-sudo flow, not an error state.
    expect(toastError).not.toHaveBeenCalled();

    act(() => {
      result.current.onSudoConfirmed();
    });

    await waitFor(() => {
      expect(result.current.pendingSentTo).toBe('new@x.com');
    });
    expect(requestFn).toHaveBeenCalledTimes(2);
    expect(requestFn.mock.calls[1]?.[0]).toEqual({ newEmail: 'new@x.com' });
  });

  it('closing the dialog abandons the pending submission', async () => {
    requestFn.mockRejectedValueOnce(appError(AppErrorCode.FORBIDDEN));

    const { result } = renderHook(() => useEmailChangeSection(), { wrapper });

    act(() => {
      result.current.onSubmit({ newEmail: 'new@x.com', factorCode: '' });
    });
    await waitFor(() => {
      expect(result.current.isDialogOpen).toBe(true);
    });

    act(() => {
      result.current.onDialogOpenChange(false);
    });
    act(() => {
      result.current.onSudoConfirmed();
    });

    // Nothing retried: only the original attempt reached the api.
    expect(requestFn).toHaveBeenCalledTimes(1);
  });

  it('maps EMAIL_IN_USE onto the address field and TWO_FACTOR_INVALID_CODE onto the code field', async () => {
    requestFn.mockRejectedValueOnce(appError(AppErrorCode.EMAIL_IN_USE));

    const { result } = renderHook(() => useEmailChangeSection(), { wrapper });

    act(() => {
      result.current.onSubmit({ newEmail: 'taken@x.com', factorCode: '' });
    });
    await waitFor(() => {
      expect(result.current.form.getFieldState('newEmail').error).toBeDefined();
    });

    requestFn.mockRejectedValueOnce(appError(AppErrorCode.TWO_FACTOR_INVALID_CODE));
    act(() => {
      result.current.onSubmit({ newEmail: 'new@x.com', factorCode: '000000' });
    });
    await waitFor(() => {
      expect(result.current.form.getFieldState('factorCode').error).toBeDefined();
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('surfaces other failures as a toast', async () => {
    requestFn.mockRejectedValueOnce(appError(AppErrorCode.PASSWORD_NOT_SET));

    const { result } = renderHook(() => useEmailChangeSection(), { wrapper });

    act(() => {
      result.current.onSubmit({ newEmail: 'new@x.com', factorCode: '' });
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(result.current.isDialogOpen).toBe(false);
  });
});
