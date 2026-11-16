import type { ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@repo/shared/errors';
import { commonStrings } from '@/lib/strings';
import { useVerifyEmail, useVerifyWithToken } from './VerifyEmail.hooks';

/**
 * The auto-verify branch runs through a REAL `useMutation`.
 *
 * Only the transport and the router are mocked, so `MutationObserver` and its
 * lifecycle are the real ones. That matters because the call is fired from a
 * ref-guarded effect: TanStack Query runs a per-call
 * `mutate(vars, { onSuccess })` handler only while the issuing observer still
 * has listeners, so a remount between the ask and the reply would strand this
 * screen on its spinner. These options live on `useMutation` instead, which
 * runs them off the mutation itself, and `reactStrictMode` below is what keeps
 * that honest.
 */
const { search, verifyFn } = vi.hoisted(() => ({
  search: { current: {} as { token?: string; emailSent?: boolean } },
  verifyFn: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => search.current }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: { auth: { verifyEmail: { mutationOptions: () => ({ mutationFn: verifyFn }) } } },
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
const renderVerify = (token: string) =>
  renderHook(({ tok }: { tok: string }) => useVerifyWithToken(tok), {
    wrapper,
    reactStrictMode: true,
    initialProps: { tok: token },
  });

beforeEach(() => {
  search.current = {};
  verifyFn.mockReset();
});

describe('useVerifyEmail', () => {
  it('reads the token and the send outcome off the URL rather than a prop', () => {
    search.current = { token: 'tok-1', emailSent: false };
    const { result } = renderHook(() => useVerifyEmail(), { wrapper });

    expect(result.current).toEqual({ token: 'tok-1', emailSent: false });
  });
});

describe('useVerifyWithToken', () => {
  it('verifies exactly once on arrival and reports success', async () => {
    verifyFn.mockResolvedValue({ success: true });
    const { result } = renderVerify('tok-1');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(verifyFn).toHaveBeenCalledTimes(1);
    expect(verifyFn.mock.calls[0]![0]).toEqual({ token: 'tok-1' });
  });

  it('re-verifies when the token changes, because the guard is keyed by token', async () => {
    verifyFn.mockResolvedValue({ success: true });
    const { result, rerender } = renderVerify('tok-1');
    await waitFor(() => expect(result.current.status).toBe('success'));

    rerender({ tok: 'tok-2' });

    await waitFor(() => expect(verifyFn).toHaveBeenCalledTimes(2));
    expect(verifyFn.mock.calls[1]![0]).toEqual({ token: 'tok-2' });
  });

  it('names a spent or expired link instead of echoing the server', async () => {
    verifyFn.mockRejectedValue({ data: { appCode: AppErrorCode.TOKEN_EXPIRED } });
    const { result } = renderVerify('tok-1');

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toMatch(/invalid or has expired/i);
  });

  it('passes a real server response through with its own sentence', async () => {
    verifyFn.mockRejectedValue({
      message: 'Service unavailable',
      data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
    });
    const { result } = renderVerify('tok-1');

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe('Service unavailable');
  });

  // A transport failure never reached the api, so its message is a browser
  // internal ("Failed to fetch"); the user gets the app's own copy instead.
  it('shows the network sentence for a transport failure', async () => {
    verifyFn.mockRejectedValue(
      Object.assign(new Error('Failed to fetch'), { name: 'TRPCClientError' }),
    );
    const { result } = renderVerify('tok-1');

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe(commonStrings.errors.network);
    expect(result.current.errorMessage).not.toContain('fetch');
  });

  it('retries the same token and clears the previous failure', async () => {
    verifyFn.mockRejectedValueOnce({ message: 'blip' });
    const { result } = renderVerify('tok-1');
    await waitFor(() => expect(result.current.status).toBe('error'));

    verifyFn.mockResolvedValueOnce({ success: true });
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.errorMessage).toBeNull();
    expect(verifyFn).toHaveBeenCalledTimes(2);
  });
});
