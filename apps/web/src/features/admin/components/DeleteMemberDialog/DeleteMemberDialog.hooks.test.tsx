import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useDeleteMemberDialog } from './DeleteMemberDialog.hooks';

const { deleteFn, invalidateQueries, toastSuccess } = vi.hoisted(() => ({
  deleteFn: vi.fn(),
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
    user: {
      listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) },
      adminDeleteUser: { mutationOptions: () => ({ mutationFn: deleteFn }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useDeleteMemberDialog', () => {
  it('deletes the member, invalidates the list, toasts, and closes', async () => {
    deleteFn.mockResolvedValue({ deleted: true });
    const onOpenChange = vi.fn();
    const { result } = renderHook(
      () =>
        useDeleteMemberDialog({
          open: true,
          onOpenChange,
          memberId: 'u-9',
          email: 'm@example.com',
        }),
      { wrapper },
    );

    act(() => result.current.onConfirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(deleteFn.mock.calls[0]?.[0]).toEqual({ userId: 'u-9' });
    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });
});
