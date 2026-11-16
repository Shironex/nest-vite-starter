import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorCode } from '@repo/shared/errors';
import { useStaffInviteCard } from './StaffInviteCard.hooks';

const { probeFn, acceptFn, navigate, toastSuccess, appErrorCode } = vi.hoisted(() => ({
  probeFn: vi.fn(),
  acceptFn: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  appErrorCode: { current: null as string | null },
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ token: 'tok-1' }),
  useNavigate: () => navigate,
}));
vi.mock('@/lib/trpc-errors', () => ({ getAppErrorCode: () => appErrorCode.current }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      staffInviteState: { mutationOptions: (o?: object) => ({ mutationFn: probeFn, ...o }) },
      acceptStaffInvite: { mutationOptions: (o?: object) => ({ mutationFn: acceptFn, ...o }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const READY = { valid: true, requiresTwoFactor: false, movesExistingAccount: false };

beforeEach(() => {
  appErrorCode.current = null;
  probeFn.mockResolvedValue(READY);
  acceptFn.mockResolvedValue({ success: true });
});

afterEach(() => vi.clearAllMocks());

describe('useStaffInviteCard', () => {
  it('probes once on mount, without consuming the invitation', async () => {
    // Single-use, with no self-service resend: a page load that burned the
    // token would leave the invitee with nothing to do but phone the organization.
    const { result, rerender } = renderHook(() => useStaffInviteCard(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    rerender();

    expect(probeFn).toHaveBeenCalledTimes(1);
    expect(probeFn.mock.calls[0]?.[0]).toEqual({ token: 'tok-1' });
  });

  it('carries the two facts the form cannot be built without', async () => {
    probeFn.mockResolvedValue({
      valid: true,
      requiresTwoFactor: true,
      movesExistingAccount: true,
    });
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.requiresTwoFactor).toBe(true);
    expect(result.current.movesExistingAccount).toBe(true);
  });

  it('calls a spent link invalid', async () => {
    probeFn.mockResolvedValue({ ...READY, valid: false });
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('invalid'));
  });

  it('separates "we could not ask" from "the link is dead"', async () => {
    // The probe budget is per IP, so a shared office address can exhaust it for
    // somebody whose invitation is perfectly good. Telling them it is dead
    // because a request was throttled is the wrong sentence.
    appErrorCode.current = AppErrorCode.RATE_LIMITED;
    probeFn.mockRejectedValue(new Error('slow down'));
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('failed'));
  });

  it('treats a rejected token as invalid rather than as a failure to ask', async () => {
    appErrorCode.current = AppErrorCode.INVALID_TOKEN;
    probeFn.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe('invalid'));
  });

  it('re-asks on retry', async () => {
    appErrorCode.current = AppErrorCode.RATE_LIMITED;
    probeFn.mockRejectedValueOnce(new Error('slow down'));
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('failed'));

    appErrorCode.current = null;
    act(() => result.current.onRetry());

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(probeFn).toHaveBeenCalledTimes(2);
  });

  it('sends the password and then routes to sign-in, never into the app', async () => {
    // Acceptance mints no session by design, so the new credential goes through
    // the ordinary login path with lockout and the 2FA seam.
    vi.useFakeTimers();
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });
    await vi.waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onSubmit({ token: 'tok-1', password: 'Str0ng-Pass!' }));

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    act(() => void vi.runAllTimers());
    expect(navigate).toHaveBeenCalledWith({ to: '/auth/login' });
    vi.useRealTimers();
  });

  it('sends no factorCode at all rather than an empty one', async () => {
    // The schema accepts an empty string, and the server would read a blank
    // field as a WRONG code rather than as an account with no factor.
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.onSubmit({ token: 'tok-1', password: 'p', factorCode: '' }));

    await waitFor(() => expect(acceptFn).toHaveBeenCalled());
    expect(acceptFn.mock.calls[0]?.[0]).toMatchObject({ factorCode: undefined });
  });

  it('takes the form away when the link dies mid-attempt', async () => {
    // No password makes a dead token work, so leaving the field there invites a
    // second attempt that cannot succeed.
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    appErrorCode.current = AppErrorCode.INVALID_TOKEN;
    acceptFn.mockRejectedValue(new Error('gone'));
    act(() => result.current.onSubmit({ token: 'tok-1', password: 'p' }));

    await waitFor(() => expect(result.current.isLinkDead).toBe(true));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('puts a bad 2FA code on the field, not in a banner', async () => {
    const { result } = renderHook(() => useStaffInviteCard(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    appErrorCode.current = AppErrorCode.TWO_FACTOR_INVALID_CODE;
    acceptFn.mockRejectedValue(new Error('bad code'));
    act(() => result.current.onSubmit({ token: 'tok-1', password: 'p', factorCode: '000000' }));

    await waitFor(() => expect(result.current.form.formState.errors.factorCode).toBeDefined());
    expect(result.current.isLinkDead).toBe(false);
    expect(result.current.serverError).toBeNull();
  });
});
