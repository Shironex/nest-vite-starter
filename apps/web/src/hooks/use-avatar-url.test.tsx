import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAvatarUrl } from './use-avatar-url';

const { getUrlFn } = vi.hoisted(() => ({ getUrlFn: vi.fn() }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    storage: {
      getUrl: {
        queryOptions: (input: { key: string }) => ({
          queryKey: ['storage.getUrl', input],
          queryFn: () => getUrlFn(input),
        }),
      },
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAvatarUrl', () => {
  it('resolves a stored S3 key to its presigned download URL', async () => {
    getUrlFn.mockResolvedValueOnce({ downloadUrl: 'https://s3.example.com/avatars/1.png?sig=x' });
    const { result } = renderHook(() => useAvatarUrl('avatars/1.png'), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.url).toBeUndefined();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getUrlFn).toHaveBeenCalledWith({ key: 'avatars/1.png' });
    expect(result.current.url).toBe('https://s3.example.com/avatars/1.png?sig=x');
    expect(result.current.isError).toBe(false);
  });

  it('reports a failed lookup without a URL', async () => {
    getUrlFn.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useAvatarUrl('avatars/1.png'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.url).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('uses an http(s) URL as is, without a lookup', () => {
    const { result } = renderHook(() => useAvatarUrl('https://lh3.googleusercontent.com/a/x'), {
      wrapper,
    });

    expect(result.current).toEqual({
      url: 'https://lh3.googleusercontent.com/a/x',
      isLoading: false,
      isError: false,
    });
    expect(getUrlFn).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ''])('returns no URL and no lookup for %j', (value) => {
    const { result } = renderHook(() => useAvatarUrl(value), { wrapper });

    expect(result.current).toEqual({ url: undefined, isLoading: false, isError: false });
    expect(getUrlFn).not.toHaveBeenCalled();
  });
});
