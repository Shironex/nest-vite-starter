import type { ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@repo/shared/errors';
import enLocale from '@/lib/i18n/locales/en.json';
import { useConfirmEmailChange } from './ConfirmEmailChange.hooks';

/**
 * Auto-confirm runs through a REAL `useMutation`.
 *
 * Only the transport is mocked, so `MutationObserver` and its lifecycle are
 * the real ones. The call is fired from a ref-guarded effect, and TanStack
 * Query runs a per-call `mutate(vars, { onSuccess })` handler only while the
 * issuing observer still has listeners: a remount between the ask and the
 * reply would strand this screen on "Confirming your new address" with no way out.
 * These options live on `useMutation` instead, which runs them off the
 * mutation itself, and `reactStrictMode` below is what keeps that honest.
 */
const confirmFn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/trpc', () => ({
  trpc: { auth: { confirmEmailChange: { mutationOptions: () => ({ mutationFn: confirmFn }) } } },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * `reactStrictMode` here, NOT a `<StrictMode>` inside `wrapper`. Testing
 * Library puts its own StrictMode outside the wrapper, and only that placement
 * re-runs the effect and its cleanup; nested, it double-renders and leaves
 * effects single-invoked, which is the quiet way to lose this file's teeth.
 */
const renderConfirm = (token: string) =>
  renderHook(({ tok }: { tok: string }) => useConfirmEmailChange(tok), {
    wrapper,
    reactStrictMode: true,
    initialProps: { tok: token },
  });

beforeEach(() => {
  confirmFn.mockReset();
});

describe('useConfirmEmailChange', () => {
  it('confirms exactly once on arrival and reports success', async () => {
    confirmFn.mockResolvedValue({ success: true });
    const { result } = renderConfirm('tok-1');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(confirmFn.mock.calls[0]![0]).toEqual({ token: 'tok-1' });
  });

  it('re-confirms when the token changes, because the guard is keyed by token', async () => {
    confirmFn.mockResolvedValue({ success: true });
    const { result, rerender } = renderConfirm('tok-1');
    await waitFor(() => expect(result.current.status).toBe('success'));

    rerender({ tok: 'tok-2' });

    await waitFor(() => expect(confirmFn).toHaveBeenCalledTimes(2));
    expect(confirmFn.mock.calls[1]![0]).toEqual({ token: 'tok-2' });
  });

  it('sends a consumed or expired link back to settings rather than offering a retry', async () => {
    confirmFn.mockRejectedValue({ data: { appCode: AppErrorCode.INVALID_TOKEN } });
    const { result } = renderConfirm('tok-1');

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toMatch(/request the change again from settings/i);
  });

  it('says the address was taken in the meantime when it is already in use', async () => {
    confirmFn.mockRejectedValue({ data: { appCode: AppErrorCode.EMAIL_IN_USE } });
    const { result } = renderConfirm('tok-1');

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toMatch(/taken in the meantime/i);
  });

  it('passes a real server response through with its own sentence', async () => {
    confirmFn.mockRejectedValue({
      message: 'Service unavailable',
      data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
    });
    const { result } = renderConfirm('tok-1');

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe('Service unavailable');
  });

  // A transport failure never reached the api, so its message is a browser
  // internal ("Failed to fetch"); the user gets catalog copy instead.
  it('shows the network sentence for a transport failure', async () => {
    confirmFn.mockRejectedValue(
      Object.assign(new Error('Failed to fetch'), { name: 'TRPCClientError' }),
    );
    const { result } = renderConfirm('tok-1');

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe(enLocale.common.errors.network);
    expect(result.current.errorMessage).not.toContain('fetch');
  });

  it('retries the same token and clears the previous failure', async () => {
    confirmFn.mockRejectedValueOnce({ message: 'blip' });
    const { result } = renderConfirm('tok-1');
    await waitFor(() => expect(result.current.status).toBe('error'));

    confirmFn.mockResolvedValueOnce({ success: true });
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.errorMessage).toBeNull();
    expect(confirmFn).toHaveBeenCalledTimes(2);
  });
});
