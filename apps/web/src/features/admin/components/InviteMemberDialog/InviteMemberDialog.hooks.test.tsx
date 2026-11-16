import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ROLES } from '@repo/shared/permissions';
import { useInviteMemberDialog } from './InviteMemberDialog.hooks';

const { sendFn, invalidateQueries, toastSuccess, toastError } = vi.hoisted(() => ({
  sendFn: vi.fn(),
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
    user: { listUsers: { pathFilter: () => ({ queryKey: ['user', 'listUsers'] }) } },
    staffInvite: { send: { mutationOptions: () => ({ mutationFn: sendFn }) } },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const arrange = (onOpenChange = vi.fn()) => ({
  onOpenChange,
  ...renderHook(() => useInviteMemberDialog({ open: true, onOpenChange }), { wrapper }),
});

afterEach(() => vi.clearAllMocks());

describe('useInviteMemberDialog', () => {
  it('starts on the narrower role', () => {
    const { result } = arrange();

    expect(result.current.form.getValues('role')).toBe(ROLES.USER);
  });

  it('sends the invitation, refreshes the list, toasts, and closes', async () => {
    sendFn.mockResolvedValue({ pending: true, emailSent: true });
    const { result, onOpenChange } = arrange();

    act(() => result.current.onSubmit({ email: 'new@example.com', role: ROLES.USER }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sendFn.mock.calls[0]?.[0]).toEqual({ email: 'new@example.com', role: ROLES.USER });
    expect(invalidateQueries).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
    expect(result.current.undeliveredEmail).toBeNull();
  });

  it('keeps the dialog open and names the address when the mail never went out', async () => {
    // The account and the link exist but nothing was sent, and the invitee
    // cannot ask for another. A toast that disappears cannot carry that.
    sendFn.mockResolvedValue({ pending: true, emailSent: false });
    const { result, onOpenChange } = arrange();

    act(() => result.current.onSubmit({ email: 'new@example.com', role: ROLES.ADMIN }));

    await waitFor(() => expect(result.current.undeliveredEmail).toBe('new@example.com'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The row still exists, so the table has to show it.
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('clears a previous undelivered warning when a new attempt starts', async () => {
    sendFn.mockResolvedValueOnce({ pending: true, emailSent: false });
    const { result } = arrange();

    act(() => result.current.onSubmit({ email: 'a@example.com', role: ROLES.USER }));
    await waitFor(() => expect(result.current.undeliveredEmail).toBe('a@example.com'));

    sendFn.mockResolvedValueOnce({ pending: true, emailSent: true });
    act(() => result.current.onSubmit({ email: 'a@example.com', role: ROLES.USER }));

    await waitFor(() => expect(result.current.undeliveredEmail).toBeNull());
  });

  it('reports a refusal without closing, so the typed address survives', async () => {
    sendFn.mockRejectedValue(new Error('That person is already a member of this organization.'));
    const { result, onOpenChange } = arrange();

    act(() => result.current.onSubmit({ email: 'col@example.com', role: ROLES.USER }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
