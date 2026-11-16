import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorCode } from '@repo/shared/errors';
import { useResetPasswordForm } from './ResetPasswordForm.hooks';

const { tokenStateFn, resetFn, toastSuccess, navigateFn } = vi.hoisted(() => ({
  tokenStateFn: vi.fn(),
  resetFn: vi.fn(),
  toastSuccess: vi.fn(),
  navigateFn: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => ({ token: 'reset-tok' }) }),
  useNavigate: () => navigateFn,
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      resetPasswordTokenState: { mutationOptions: () => ({ mutationFn: tokenStateFn }) },
      resetPassword: { mutationOptions: () => ({ mutationFn: resetFn }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Rendered under StrictMode, because the 2FA probe is fired from a ref-guarded
 * effect.
 *
 * TanStack Query runs a per-call `mutate(vars, { onSuccess })` handler only
 * while the issuing observer still has listeners, so a remount between the ask
 * and the reply would drop it while the ref guard suppressed the second ask,
 * and the code field would silently never appear. The probe's handler lives on
 * `useMutation` instead, which runs it off the mutation itself; this is what
 * holds that shape in place.
 *
 * `reactStrictMode` here, NOT a `<StrictMode>` inside `wrapper`. Testing
 * Library puts its own StrictMode outside the wrapper, and only that placement
 * re-runs the effect and its cleanup; nested, it double-renders and leaves
 * effects single-invoked.
 */
const render = () => renderHook(() => useResetPasswordForm(), { wrapper, reactStrictMode: true });

const submitPayload = { token: 'reset-tok', password: 'N3wP@ssw0rd!', factorCode: '' };

afterEach(() => vi.clearAllMocks());

describe('useResetPasswordForm', () => {
  it('probes the token state on mount and reveals the code field for a 2FA account', async () => {
    tokenStateFn.mockResolvedValue({ valid: true, requiresTwoFactor: true });
    const { result } = render();

    await waitFor(() => expect(result.current.requiresTwoFactor).toBe(true));
    expect(tokenStateFn).toHaveBeenCalledWith({ token: 'reset-tok' }, expect.anything());
    // Once, not twice: the budget is per IP, so the guard against StrictMode's
    // second effect pass is a real cost saved rather than tidiness.
    expect(tokenStateFn).toHaveBeenCalledTimes(1);
  });

  it('toasts and disables the button on a successful reset', async () => {
    tokenStateFn.mockResolvedValue({ valid: true, requiresTwoFactor: false });
    resetFn.mockResolvedValue({ success: true });
    const { result } = render();

    act(() => result.current.onSubmit(submitPayload));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(result.current.isPending).toBe(true);
  });

  it('shows the request-new-link message on an invalid or expired token', async () => {
    tokenStateFn.mockResolvedValue({ valid: false, requiresTwoFactor: false });
    resetFn.mockRejectedValue({ data: { appCode: AppErrorCode.TOKEN_EXPIRED } });
    const { result } = render();

    act(() => result.current.onSubmit(submitPayload));

    await waitFor(() => expect(result.current.showRequestNewLink).toBe(true));
    expect(result.current.serverError).toMatch(/invalid or has expired/i);
  });

  it('flags a wrong second-factor code on the code field and reveals it', async () => {
    tokenStateFn.mockResolvedValue({ valid: true, requiresTwoFactor: false });
    resetFn.mockRejectedValue({ data: { appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE } });
    const { result } = render();

    act(() => result.current.onSubmit({ ...submitPayload, factorCode: '000000' }));

    await waitFor(() => expect(result.current.form.formState.errors.factorCode).toBeTruthy());
    expect(result.current.requiresTwoFactor).toBe(true);
  });

  it('surfaces any other server error as a generic message', async () => {
    tokenStateFn.mockResolvedValue({ valid: true, requiresTwoFactor: false });
    resetFn.mockRejectedValue({ message: 'Something broke', data: {} });
    const { result } = render();

    act(() => result.current.onSubmit(submitPayload));

    await waitFor(() => expect(result.current.serverError).toBe('Something broke'));
    expect(result.current.showRequestNewLink).toBe(false);
  });
});
