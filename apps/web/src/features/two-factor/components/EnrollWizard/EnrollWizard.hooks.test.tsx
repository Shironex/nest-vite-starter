import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useEnrollWizard } from './EnrollWizard.hooks';

const { beginFn, activateFn } = vi.hoisted(() => ({ beginFn: vi.fn(), activateFn: vi.fn() }));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/qr', () => ({ otpauthUriToQrDataUri: () => 'data:image/svg+xml,qr' }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    twoFactor: {
      beginEnrollment: { mutationOptions: () => ({ mutationFn: beginFn }) },
      activate: { mutationOptions: () => ({ mutationFn: activateFn }) },
    },
  },
  resetCsrfToken: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useEnrollWizard', () => {
  it('walks password -> confirm -> codes and finishes', async () => {
    beginFn.mockResolvedValue({ otpauthUri: 'otpauth://totp/x', secretBase32: 'ABCDEF' });
    activateFn.mockResolvedValue({ recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD'] });
    const onComplete = vi.fn();
    const { result } = renderHook(() => useEnrollWizard({ onComplete }), { wrapper });

    expect(result.current.step).toBe('password');

    act(() => result.current.onBeginEnrollment({ password: 'pw' }));
    await waitFor(() => expect(result.current.step).toBe('confirm'));
    expect(result.current.qrDataUri).toBe('data:image/svg+xml,qr');
    expect(result.current.secretBase32).toBe('ABCDEF');

    act(() => result.current.onActivate({ code: '123456' }));
    await waitFor(() => expect(result.current.step).toBe('codes'));
    expect(result.current.recoveryCodes).toHaveLength(2);

    act(() => result.current.onFinish());
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
