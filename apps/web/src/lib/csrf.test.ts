import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CSRF_TOKEN_PATH } from '@repo/shared/constants';
import { SMALL_FETCH_TIMEOUT_MS } from '@/lib/fetch-timeouts';

/**
 * Two contracts live in lib/csrf.ts and both are proven only here.
 *
 * 1. Laziness. GET /api/csrf-token is throttled at 30 per 60s per IP, so a
 *    token must be minted only for requests the api actually validates. A
 *    render-only boot that spends a slot is what throttled real users who
 *    reload quickly, and no e2e can assert "no request happened".
 * 2. The 403 self-heal, the only client recovery path for an expired or raced
 *    token. The cold-start login e2e never trips a 403 (login succeeds cleanly
 *    once the sid race is fixed in main.ts), so these are its sole proof.
 *
 * Each test re-imports the module after resetModules so the module-level CSRF
 * token cache starts empty.
 */

// Minimal Response-like stub: fetchWithCsrfRetry only touches status/clone/json,
// and getCsrfToken only touches ok/json. Avoids happy-dom Response.clone quirks.
const fakeResponse = (status: number, body: unknown) => {
  const make = (): unknown => ({
    status,
    ok: status >= 200 && status < 300,
    clone: () => make(),
    json: async () => body,
  });
  return make();
};

/** Every URL the mocked fetch was called with, in order. */
const calledUrls = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls.map((call) => String(call[0]));

/** The CSRF header on the nth fetch call, or null when it carried none. */
const csrfHeaderOn = (fetchMock: ReturnType<typeof vi.fn>, index: number): string | null => {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers).get('x-csrf-token');
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('lazy CSRF token fetching', () => {
  it('mints no token on a read-only boot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    // tRPC sends queries as GET; this is what a render-only page load looks like.
    await fetchWithCsrfRetry('/trpc/auth.me', { method: 'GET' });
    await fetchWithCsrfRetry('/trpc/user.list,user.stats', { method: 'GET' });

    expect(calledUrls(fetchMock)).not.toContain(CSRF_TOKEN_PATH);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(csrfHeaderOn(fetchMock, 0)).toBeNull();
  });

  it('treats a missing method as GET rather than as a mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    await fetchWithCsrfRetry('/trpc/auth.me');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrls(fetchMock)).not.toContain(CSRF_TOKEN_PATH);
  });

  it.each(['HEAD', 'OPTIONS'])('mints no token for a %s request', async (method) => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    await fetchWithCsrfRetry('/trpc/auth.me', { method });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrls(fetchMock)).not.toContain(CSRF_TOKEN_PATH);
  });

  it('mints one and attaches it when a mutation finally runs', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, {})) // boot query, no token
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'minted-token' }))
      .mockResolvedValueOnce(fakeResponse(200, {})); // the mutation itself
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    await fetchWithCsrfRetry('/trpc/auth.me', { method: 'GET' });
    const res = await fetchWithCsrfRetry('/trpc/auth.login', { method: 'POST', body: '{}' });

    expect(res.status).toBe(200);
    // The token is fetched between the read and the write, not before the read.
    expect(calledUrls(fetchMock)).toEqual(['/trpc/auth.me', CSRF_TOKEN_PATH, '/trpc/auth.login']);
    expect(csrfHeaderOn(fetchMock, 2)).toBe('minted-token');
  });

  it('reuses the minted token across later mutations instead of refetching', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'minted-token' }))
      .mockResolvedValue(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    await fetchWithCsrfRetry('/trpc/user.update', { method: 'POST' });
    await fetchWithCsrfRetry('/trpc/user.rename', { method: 'POST' });

    expect(calledUrls(fetchMock).filter((url) => url === CSRF_TOKEN_PATH)).toHaveLength(1);
    expect(csrfHeaderOn(fetchMock, 2)).toBe('minted-token');
  });

  it('shares a single request when parallel mutations race the first mint', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'minted-token' }))
      .mockResolvedValue(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    await Promise.all([
      fetchWithCsrfRetry('/trpc/user.update', { method: 'POST' }),
      fetchWithCsrfRetry('/trpc/user.rename', { method: 'POST' }),
    ]);

    expect(calledUrls(fetchMock).filter((url) => url === CSRF_TOKEN_PATH)).toHaveLength(1);
  });

  it('mints again after resetCsrfToken, so a post-login mutation is not stale', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'pre-login' }))
      .mockResolvedValueOnce(fakeResponse(200, {}))
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'post-login' }))
      .mockResolvedValueOnce(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry, resetCsrfToken } = await import('@/lib/csrf');
    await fetchWithCsrfRetry('/trpc/auth.login', { method: 'POST' });
    resetCsrfToken();
    await fetchWithCsrfRetry('/trpc/user.update', { method: 'POST' });

    expect(csrfHeaderOn(fetchMock, 1)).toBe('pre-login');
    expect(csrfHeaderOn(fetchMock, 3)).toBe('post-login');
  });

  it('preserves headers the caller set, such as the idempotency key', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'minted-token' }))
      .mockResolvedValue(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    await fetchWithCsrfRetry('/trpc/user.create', {
      method: 'POST',
      headers: { 'idempotency-key': 'abc-123' },
    });

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toBe('abc-123');
    expect(headers.get('x-csrf-token')).toBe('minted-token');
  });

  it('rejects a wrong-shape 200 rather than sending the header value "undefined"', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { notATokenAtAll: true }))
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'second-try' }))
      .mockResolvedValue(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');

    await expect(fetchWithCsrfRetry('/trpc/user.update', { method: 'POST' })).rejects.toThrow(
      /Malformed CSRF token response/,
    );
    // The rejection is not cached, so the next mutation mints a real token.
    await fetchWithCsrfRetry('/trpc/user.update', { method: 'POST' });
    expect(csrfHeaderOn(fetchMock, 2)).toBe('second-try');
  });

  it('surfaces a failed mint to the caller instead of sending an unprotected mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(500, { message: 'gateway down' }));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');

    await expect(fetchWithCsrfRetry('/trpc/user.update', { method: 'POST' })).rejects.toThrow(
      /CSRF token request failed with 500/,
    );
    // Only the token attempt went out; the mutation never left without a token.
    expect(calledUrls(fetchMock)).toEqual([CSRF_TOKEN_PATH]);
  });
});

describe('fetchWithCsrfRetry', () => {
  it('retries once on a 403 whose nested error.message mentions csrf, with a fresh token', async () => {
    const fetchMock = vi.fn();
    fetchMock
      // 1) GET CSRF_TOKEN_PATH mints the token the mutation carries
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'stale-token' }))
      // 2) initial request rejected with the standard CSRF envelope
      .mockResolvedValueOnce(
        fakeResponse(403, { error: { message: 'Invalid CSRF token', code: 403 } }),
      )
      // 3) GET CSRF_TOKEN_PATH issues a fresh token
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'fresh-token' }))
      // 4) retry succeeds
      .mockResolvedValueOnce(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    const res = await fetchWithCsrfRetry('/trpc/auth.login', { method: 'POST', headers: {} });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // The refreshed token must ride on the retry request's headers.
    expect(csrfHeaderOn(fetchMock, 3)).toBe('fresh-token');
  });

  it('does not retry on a 403 that is not csrf-related', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'minted-token' }))
      .mockResolvedValue(fakeResponse(403, { error: { message: 'Forbidden', code: 403 } }));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    const res = await fetchWithCsrfRetry('/trpc/secret', { method: 'POST' });

    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a non-403 response', async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'minted-token' }))
      .mockResolvedValue(fakeResponse(500, { error: { message: 'boom', code: 500 } }));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithCsrfRetry } = await import('@/lib/csrf');
    const res = await fetchWithCsrfRetry('/trpc/secret', { method: 'POST' });

    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('CSRF token fetch timeout', () => {
  it('rejects a stalled token fetch and retries on the next mutation', async () => {
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const fetchMock = vi.fn();
    fetchMock
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      )
      .mockResolvedValueOnce(fakeResponse(200, { csrfToken: 'second-try' }))
      .mockResolvedValueOnce(fakeResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const { getCsrfToken, fetchWithCsrfRetry } = await import('@/lib/csrf');
    const stalled = getCsrfToken();
    expect(timeoutSpy).toHaveBeenCalledWith(SMALL_FETCH_TIMEOUT_MS);

    deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(stalled).rejects.toMatchObject({ name: 'TimeoutError' });
    timeoutSpy.mockRestore();

    // The rejected promise was dropped from the cache, so this mints afresh
    // rather than replaying the failure until a full reload.
    await fetchWithCsrfRetry('/trpc/user.update', { method: 'POST' });
    expect(csrfHeaderOn(fetchMock, 2)).toBe('second-try');
  });
});
