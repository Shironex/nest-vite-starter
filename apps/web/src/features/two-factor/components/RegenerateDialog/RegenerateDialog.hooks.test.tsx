import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorCode } from '@repo/shared/errors';
import { i18n } from '@/lib/i18n';
import { useRegenerateDialog } from './RegenerateDialog.hooks';

const { regenerateFn } = vi.hoisted(() => ({ regenerateFn: vi.fn() }));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    twoFactor: {
      regenerateRecoveryCodes: { mutationOptions: () => ({ mutationFn: regenerateFn }) },
      status: { queryOptions: () => ({ queryKey: ['twoFactor.status'] }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useRegenerateDialog', () => {
  it('reveals the new codes on success, then clears them on done', async () => {
    regenerateFn.mockResolvedValue({ recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD'] });
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => useRegenerateDialog({ open: true, onOpenChange }), {
      wrapper,
    });

    act(() => result.current.onSubmit({ password: 'pw' }));
    await waitFor(() => expect(result.current.codes).toHaveLength(2));

    act(() => result.current.onDone());
    expect(result.current.codes).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('flags a wrong password', async () => {
    regenerateFn.mockRejectedValue({ data: { appCode: AppErrorCode.INVALID_CREDENTIALS } });
    const { result } = renderHook(
      () => useRegenerateDialog({ open: true, onOpenChange: vi.fn() }),
      { wrapper },
    );

    act(() => result.current.onSubmit({ password: 'bad' }));
    await waitFor(() =>
      expect(result.current.form.formState.errors.password?.message).toBe(
        i18n.t('twoFactor.regenerate.passwordIncorrect'),
      ),
    );
  });
});
