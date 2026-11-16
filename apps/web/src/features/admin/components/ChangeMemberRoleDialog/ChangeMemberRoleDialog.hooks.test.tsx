import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useChangeMemberRoleDialog } from './ChangeMemberRoleDialog.hooks';

const { changeRoleFn, invalidateQueries, toastSuccess } = vi.hoisted(() => ({
  changeRoleFn: vi.fn(),
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
      updateUserRole: { mutationOptions: () => ({ mutationFn: changeRoleFn }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useChangeMemberRoleDialog', () => {
  it('promotes a user to admin, invalidates the list, toasts, and closes', async () => {
    changeRoleFn.mockResolvedValue({ success: true });
    const onOpenChange = vi.fn();
    const { result } = renderHook(
      () =>
        useChangeMemberRoleDialog({
          open: true,
          onOpenChange,
          memberId: 'u-9',
          email: 'm@example.com',
          memberRole: 'USER',
        }),
      { wrapper },
    );

    expect(result.current.currentRoleLabel).toBe('User');
    expect(result.current.nextRoleLabel).toBe('Administrator');

    act(() => result.current.onConfirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(changeRoleFn.mock.calls[0]?.[0]).toEqual({ userId: 'u-9', role: 'ADMIN' });
    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('demotes an admin back to user', async () => {
    changeRoleFn.mockResolvedValue({ success: true });
    const onOpenChange = vi.fn();
    const { result } = renderHook(
      () =>
        useChangeMemberRoleDialog({
          open: true,
          onOpenChange,
          memberId: 'u-3',
          email: 'a@example.com',
          memberRole: 'ADMIN',
        }),
      { wrapper },
    );

    act(() => result.current.onConfirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(changeRoleFn.mock.calls[0]?.[0]).toEqual({ userId: 'u-3', role: 'USER' });
  });
});
