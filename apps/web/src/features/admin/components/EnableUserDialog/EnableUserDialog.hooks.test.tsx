import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useEnableUserDialog } from './EnableUserDialog.hooks';

const { actFn, invalidateQueries, toastSuccess, toastError } = vi.hoisted(() => ({
  actFn: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@/lib/trpc', () => ({
  trpc: {
    audit: { list: { pathFilter: () => ({ queryKey: ['audit', 'list'] }) } },
    user: {
      listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) },
      enableUser: { mutationOptions: () => ({ mutationFn: actFn }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useEnableUserDialog', () => {
  it('sends the user id, invalidates the list, toasts, and closes', async () => {
    actFn.mockResolvedValue({ success: true });
    const onOpenChange = vi.fn();
    const { result } = renderHook(
      () =>
        useEnableUserDialog({
          open: true,
          onOpenChange,
          targetId: 'u-9',
          email: 'm@example.com',
        }),
      { wrapper },
    );

    act(() => result.current.onConfirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(actFn.mock.calls[0]?.[0]).toEqual({ userId: 'u-9' });
    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('leaves the dialog open on failure, so the admin sees what did not happen', async () => {
    actFn.mockRejectedValue(new Error('nope'));
    const onOpenChange = vi.fn();
    const { result } = renderHook(
      () =>
        useEnableUserDialog({
          open: true,
          onOpenChange,
          targetId: 'u-9',
          email: 'm@example.com',
        }),
      { wrapper },
    );

    act(() => result.current.onConfirm());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
