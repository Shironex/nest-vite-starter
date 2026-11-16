import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useOrgTwoFactorPolicyCard } from './OrgTwoFactorPolicyCard.hooks';

const { getPolicyFn, setPolicyFn, toastSuccess, toastError } = vi.hoisted(() => ({
  getPolicyFn: vi.fn(),
  setPolicyFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    twoFactor: {
      getTenantPolicy: {
        queryOptions: () => ({ queryKey: ['twoFactor.getTenantPolicy'], queryFn: getPolicyFn }),
      },
      setTenantPolicy: { mutationOptions: () => ({ mutationFn: setPolicyFn }) },
      status: { queryOptions: () => ({ queryKey: ['twoFactor.status'] }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useOrgTwoFactorPolicyCard', () => {
  it('derives status text from the tenant policy query', async () => {
    getPolicyFn.mockResolvedValue({ required: true, graceEndsAt: null, enforced: true });
    const { result } = renderHook(() => useOrgTwoFactorPolicyCard(), { wrapper });
    await waitFor(() => expect(result.current.required).toBe(true));
    expect(result.current.statusText).toBe('Required for all members');
    expect(result.current.enforced).toBe(true);
  });

  it('formats the grace deadline in the app locale', async () => {
    getPolicyFn.mockResolvedValue({
      required: true,
      // Midday UTC keeps the calendar day stable in any test time zone.
      graceEndsAt: new Date('2026-07-28T12:00:00Z'),
      enforced: false,
    });
    const { result } = renderHook(() => useOrgTwoFactorPolicyCard(), { wrapper });
    await waitFor(() => expect(result.current.deadlineText).not.toBeNull());
    expect(result.current.deadlineText).toContain('07/28/2026');
  });

  it('turning the switch on asks for confirmation before mutating', () => {
    getPolicyFn.mockResolvedValue({ required: false, graceEndsAt: null, enforced: false });
    const { result } = renderHook(() => useOrgTwoFactorPolicyCard(), { wrapper });
    act(() => result.current.onToggle(true));
    expect(result.current.confirmEnableOpen).toBe(true);
    expect(setPolicyFn).not.toHaveBeenCalled();
  });

  it('confirming enable calls setTenantPolicy(required: true) and toasts', async () => {
    getPolicyFn.mockResolvedValue({ required: false, graceEndsAt: null, enforced: false });
    setPolicyFn.mockResolvedValue({ required: true, graceEndsAt: null, enforced: false });
    const { result } = renderHook(() => useOrgTwoFactorPolicyCard(), { wrapper });
    act(() => result.current.onConfirmEnable());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(setPolicyFn).toHaveBeenCalledWith({ required: true }, expect.anything());
    expect(result.current.confirmEnableOpen).toBe(false);
  });

  it('turning the switch off disables immediately without a confirm', async () => {
    getPolicyFn.mockResolvedValue({ required: true, graceEndsAt: null, enforced: false });
    setPolicyFn.mockResolvedValue({ required: false, graceEndsAt: null, enforced: false });
    const { result } = renderHook(() => useOrgTwoFactorPolicyCard(), { wrapper });
    act(() => result.current.onToggle(false));
    await waitFor(() =>
      expect(setPolicyFn).toHaveBeenCalledWith({ required: false }, expect.anything()),
    );
    expect(result.current.confirmEnableOpen).toBe(false);
  });
});
