import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppErrorCode } from '@repo/shared/errors';
import { i18n } from '@/lib/i18n';
import { useDisableDialog } from './DisableDialog.hooks';

const { disableFn, toastSuccess } = vi.hoisted(() => ({
  disableFn: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@repo/ui/sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    twoFactor: {
      disable: { mutationOptions: () => ({ mutationFn: disableFn }) },
      status: { queryOptions: () => ({ queryKey: ['twoFactor.status'] }) },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.clearAllMocks());

describe('useDisableDialog', () => {
  it('closes the dialog and toasts on success', async () => {
    disableFn.mockResolvedValue({ success: true });
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => useDisableDialog({ open: true, onOpenChange }), {
      wrapper,
    });

    act(() => result.current.onSubmit({ password: 'pw', code: '123456' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('flags a wrong password on the password field', async () => {
    disableFn.mockRejectedValue({ data: { appCode: AppErrorCode.INVALID_CREDENTIALS } });
    const { result } = renderHook(() => useDisableDialog({ open: true, onOpenChange: vi.fn() }), {
      wrapper,
    });

    act(() => result.current.onSubmit({ password: 'bad', code: '123456' }));

    await waitFor(() =>
      expect(result.current.form.formState.errors.password?.message).toBe(
        i18n.t('twoFactor.disable.passwordIncorrect'),
      ),
    );
  });
});
