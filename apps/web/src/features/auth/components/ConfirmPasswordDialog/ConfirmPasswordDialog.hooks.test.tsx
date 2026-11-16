import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorCode } from '@repo/shared/errors';
import { useConfirmPasswordDialog } from './ConfirmPasswordDialog.hooks';

const { confirmFn, toastError } = vi.hoisted(() => ({
  confirmFn: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { confirmPassword: { mutationOptions: () => ({ mutationFn: confirmFn }) } },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

const renderDialogHook = (onOpenChange = vi.fn(), onConfirmed = vi.fn()) =>
  renderHook(() => useConfirmPasswordDialog({ open: true, onOpenChange, onConfirmed }), {
    wrapper,
  });

/** Reject with the duck-typed shape getAppErrorCode reads off a tRPC error. */
const rejectWithCode = (code: AppErrorCode) =>
  confirmFn.mockRejectedValue({ data: { appCode: code }, message: code });

describe('useConfirmPasswordDialog', () => {
  it('confirms BEFORE closing, so the caller still holds its pending action', async () => {
    confirmFn.mockResolvedValue({ success: true });
    const onOpenChange = vi.fn();
    const onConfirmed = vi.fn();
    const { result } = renderDialogHook(onOpenChange, onConfirmed);

    act(() => result.current.onSubmit({ password: 'correct horse' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(confirmFn.mock.calls[0]?.[0]).toEqual({ password: 'correct horse' });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    // The ordering contract from the types: onConfirmed fires first, because
    // closing is what makes the caller drop its pending action.
    expect(onConfirmed.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenChange.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('pins a wrong password to the field and keeps the dialog open', async () => {
    rejectWithCode(AppErrorCode.INVALID_CREDENTIALS);
    const onOpenChange = vi.fn();
    const onConfirmed = vi.fn();
    const { result } = renderDialogHook(onOpenChange, onConfirmed);

    act(() => result.current.onSubmit({ password: 'wrong' }));

    await waitFor(() =>
      expect(result.current.form.getFieldState('password').error?.message).toBe(
        'Password is incorrect.',
      ),
    );
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('swaps to the set-a-password-first state on PASSWORD_NOT_SET', async () => {
    rejectWithCode(AppErrorCode.PASSWORD_NOT_SET);
    const { result } = renderDialogHook();

    expect(result.current.hasNoPassword).toBe(false);
    act(() => result.current.onSubmit({ password: 'anything' }));

    // An OAuth-only account cannot succeed by retyping, so no field error and
    // no toast: the body swap is the whole answer.
    await waitFor(() => expect(result.current.hasNoPassword).toBe(true));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('pins the rate-limit sentence to the field on RATE_LIMITED', async () => {
    rejectWithCode(AppErrorCode.RATE_LIMITED);
    const { result } = renderDialogHook();

    act(() => result.current.onSubmit({ password: 'wrong' }));

    await waitFor(() =>
      expect(result.current.form.getFieldState('password').error?.message).toBe(
        'Too many attempts. Wait a moment and try again.',
      ),
    );
  });
});
