import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useWithdrawInviteByEmailDialog } from './WithdrawInviteByEmailDialog.hooks';

const { withdrawFn, invalidateQueries, toastSuccess, toastError } = vi.hoisted(() => ({
  withdrawFn: vi.fn(),
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
    staffInvite: { withdrawByEmail: { mutationOptions: () => ({ mutationFn: withdrawFn }) } },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const arrange = (onOpenChange = vi.fn()) => ({
  onOpenChange,
  ...renderHook(() => useWithdrawInviteByEmailDialog({ open: true, onOpenChange }), { wrapper }),
});

afterEach(() => vi.clearAllMocks());

describe('useWithdrawInviteByEmailDialog', () => {
  it('sends the typed address, toasts, and closes', async () => {
    withdrawFn.mockResolvedValue({ success: true });
    const { result, onOpenChange } = arrange();

    act(() => result.current.onSubmit({ email: 'elsewhere@example.com' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(withdrawFn.mock.calls[0]?.[0]).toEqual({ email: 'elsewhere@example.com' });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.form.getValues('email')).toBe('');
  });

  it('says the same thing for an address with an open invitation and one without', async () => {
    // The api acks both identically so it cannot be asked which addresses have
    // an account elsewhere. A UI that worded the two differently would
    // reintroduce that oracle, so the message is conditional and never varies.
    withdrawFn.mockResolvedValue({ success: true });
    const { result } = arrange();

    act(() => result.current.onSubmit({ email: 'pending@example.com' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    act(() => result.current.onSubmit({ email: 'nobody@example.com' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(2));

    const [first, second] = toastSuccess.mock.calls.map((call) => String(call[0]));
    expect(first).toBe(second?.replace('nobody@example.com', 'pending@example.com'));
    expect(first).toMatch(/^if an invitation/i);
  });

  it('refreshes no list: the invitation it reaches was never a row', async () => {
    withdrawFn.mockResolvedValue({ success: true });
    const { result, onOpenChange } = arrange();

    act(() => result.current.onSubmit({ email: 'elsewhere@example.com' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('reports a refusal and stays open with the address intact', async () => {
    withdrawFn.mockRejectedValue(
      Object.assign(new Error('No active organization.'), { data: { appCode: 'FORBIDDEN' } }),
    );
    const { result, onOpenChange } = arrange();

    act(() => result.current.form.setValue('email', 'elsewhere@example.com'));
    act(() => result.current.onSubmit({ email: 'elsewhere@example.com' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(result.current.form.getValues('email')).toBe('elsewhere@example.com');
  });
});
