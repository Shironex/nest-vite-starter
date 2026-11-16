import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useSecurityCard } from './SecurityCard.hooks';

const { revokeFn, invalidateQueries, toastSuccess } = vi.hoisted(() => ({
  revokeFn: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('../../TwoFactor.queries', () => ({
  useTwoFactorStatus: () => ({ data: undefined, isLoading: true }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@/lib/trpc', () => ({
  trpc: {
    twoFactor: {
      status: { queryOptions: () => ({ queryKey: ['twoFactor.status'] }) },
      revokeTrustedDevices: { mutationOptions: () => ({ mutationFn: revokeFn }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useSecurityCard', () => {
  it('revokes trusted devices and invalidates status', async () => {
    revokeFn.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useSecurityCard(), { wrapper });

    act(() => result.current.onRevokeTrusted());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('closes the enroll dialog and refetches on completion', () => {
    const { result } = renderHook(() => useSecurityCard(), { wrapper });
    act(() => result.current.onEnrollOpenChange(true));
    expect(result.current.isEnrollOpen).toBe(true);

    act(() => result.current.onEnrollComplete());
    expect(result.current.isEnrollOpen).toBe(false);
    expect(invalidateQueries).toHaveBeenCalled();
  });
});
