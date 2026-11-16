import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { SMALL_FETCH_TIMEOUT_MS } from '@/lib/fetch-timeouts';
import { useOAuthButtons } from './OAuthButtons.hooks';

const { electron, routerSearch } = vi.hoisted(() => ({
  electron: { isElectron: false },
  routerSearch: { current: {} as Record<string, unknown> },
}));

// `IS_ELECTRON` is a module-level const derived from `window.electronAPI`, so it
// is exposed through a getter here rather than a value: the hook reads it on
// every render and each test needs its own answer.
vi.mock('@/lib/electron', () => ({
  get IS_ELECTRON() {
    return electron.isElectron;
  },
  getApiBaseUrl: () => '',
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => routerSearch.current,
}));

const assign = vi.fn();
const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  electron.isElectron = false;
  routerSearch.current = {};
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { assign, href: 'http://localhost/auth/login' },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Discovery answered with the pinned contract: keys only, branding owned here. */
const answerWithGoogle = () =>
  fetchMock.mockResolvedValue(jsonResponse(200, { providers: [{ key: 'google' }] }));

describe('useOAuthButtons', () => {
  it('renders the discovered provider with the localized call to action', async () => {
    answerWithGoogle();
    const { result } = renderHook(() => useOAuthButtons(), { wrapper });

    await waitFor(() => expect(result.current.providers).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/oauth/providers', {
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
    // Google's guidelines forbid translating the proper noun itself.
    expect(result.current.providers[0]).toEqual({ key: 'google', label: 'Continue with Google' });
    expect(result.current.dividerLabel).toBe('or');
  });

  it('stays empty and never asks in the Electron shell', async () => {
    electron.isElectron = true;
    answerWithGoogle();
    const { result } = renderHook(() => useOAuthButtons(), { wrapper });

    // v1 is web-only: no loopback flow exists, so the shell must not
    // even discover, let alone draw a button that cannot complete.
    await waitFor(() => expect(result.current.dividerLabel).toBe('or'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.providers).toEqual([]);
  });

  it.each([
    ['a non-2xx answer', () => fetchMock.mockResolvedValue(jsonResponse(503, {}))],
    ['a body with no providers key', () => fetchMock.mockResolvedValue(jsonResponse(200, {}))],
    [
      'a providers value that is not an array',
      () => fetchMock.mockResolvedValue(jsonResponse(200, { providers: 'google' })),
    ],
    ['a network failure', () => fetchMock.mockRejectedValue(new Error('offline'))],
  ])('hides the surface on %s', async (_label, arrange) => {
    arrange();
    const { result } = renderHook(() => useOAuthButtons(), { wrapper });

    // Degrading to "no providers" rather than rejecting keeps optional chrome
    // out of the global QueryCache onError, which logs and reports to Sentry.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.providers).toEqual([]);
  });

  it('bounds discovery with a timeout and hides the surface when it stalls', async () => {
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const { result } = renderHook(() => useOAuthButtons(), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(timeoutSpy).toHaveBeenCalledWith(SMALL_FETCH_TIMEOUT_MS);
    deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    // Degrades to "no providers" rather than rejecting, like any other failure.
    expect(result.current.providers).toEqual([]);
  });

  it('drops provider keys this build has no branding for', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { providers: [{ key: 'github' }, { key: 'google' }, 'google', null] }),
    );
    const { result } = renderHook(() => useOAuthButtons(), { wrapper });

    await waitFor(() => expect(result.current.providers).toHaveLength(1));
    expect(result.current.providers[0]?.key).toBe('google');
  });

  it('starts the flow as a full-page navigation, defaulting the return target', async () => {
    answerWithGoogle();
    const { result } = renderHook(() => useOAuthButtons(), { wrapper });
    await waitFor(() => expect(result.current.providers).toHaveLength(1));

    result.current.onSelect('google');

    // A top-level navigation, not fetch: the api answers with a 302 into
    // Google's consent screen, which fetch cannot follow.
    expect(assign).toHaveBeenCalledWith('/api/auth/oauth/google/start?returnTo=%2Fdashboard');
  });

  it('carries a safe redirect target through to the start endpoint', async () => {
    routerSearch.current = { redirect: '/settings/security' };
    answerWithGoogle();
    const { result } = renderHook(() => useOAuthButtons(), { wrapper });
    await waitFor(() => expect(result.current.providers).toHaveLength(1));

    result.current.onSelect('google');

    expect(assign).toHaveBeenCalledWith(
      '/api/auth/oauth/google/start?returnTo=%2Fsettings%2Fsecurity',
    );
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'dashboard'])(
    'refuses %s as a return target',
    async (redirect) => {
      routerSearch.current = { redirect };
      answerWithGoogle();
      const { result } = renderHook(() => useOAuthButtons(), { wrapper });
      await waitFor(() => expect(result.current.providers).toHaveLength(1));

      result.current.onSelect('google');

      expect(assign).toHaveBeenCalledWith('/api/auth/oauth/google/start?returnTo=%2Fdashboard');
    },
  );
});
