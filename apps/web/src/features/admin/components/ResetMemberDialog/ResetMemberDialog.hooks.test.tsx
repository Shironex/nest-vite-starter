import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useResetMemberDialog } from './ResetMemberDialog.hooks';

const { resetFn, invalidateQueries, toastSuccess } = vi.hoisted(() => ({
  resetFn: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@/lib/trpc', () => ({
  trpc: {
    user: { listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) } },
    twoFactor: {
      resetMemberTwoFactor: { mutationOptions: () => ({ mutationFn: resetFn }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useResetMemberDialog', () => {
  it('resets the member, invalidates the list, toasts, and closes', async () => {
    resetFn.mockResolvedValue({ success: true });
    const onOpenChange = vi.fn();
    const { result } = renderHook(
      () =>
        useResetMemberDialog({
          open: true,
          onOpenChange,
          memberId: 'u-9',
          email: 'm@example.com',
        }),
      { wrapper },
    );

    act(() => result.current.onConfirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(resetFn.mock.calls[0]?.[0]).toEqual({ userId: 'u-9' });
    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });
});
