import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The transport half of the idempotency contract.
 *
 * The api dedupes a mutation only when it arrives with an `Idempotency-Key`
 * HEADER, and `httpBatchLink` sends one header set for a whole batch, so an
 * operation carrying a key has to leave the batch. These assertions pin the
 * splitLink that does it; without them the layer silently degrades to "wired
 * but inert", which is exactly the state this step was meant to fix.
 */

/** The pieces of each link's config the chain calls back into. */
interface ILinkOptions {
  headers: (opts: { op: { context: Record<string, unknown> } }) => Record<string, string>;
  fetch: (url: unknown, options: unknown) => unknown;
}

// Typed with an explicit parameter so `mock.calls[0][0]` is a real element
// rather than an index into an empty tuple.
const { httpLinkSpy, httpBatchLinkSpy, splitLinkSpy, createTRPCClientSpy, fetchWithCsrfRetrySpy } =
  vi.hoisted(() => ({
    httpLinkSpy: vi.fn((_options: unknown) => 'http-link'),
    httpBatchLinkSpy: vi.fn((_options: unknown) => 'http-batch-link'),
    splitLinkSpy: vi.fn((opts: unknown) => ({ kind: 'split', opts })),
    createTRPCClientSpy: vi.fn((_options: unknown) => ({})),
    fetchWithCsrfRetrySpy: vi.fn(),
  }));

vi.mock('@trpc/client', () => ({
  createTRPCClient: createTRPCClientSpy,
  httpLink: httpLinkSpy,
  httpBatchLink: httpBatchLinkSpy,
  splitLink: splitLinkSpy,
  TRPCClientError: class TRPCClientError extends Error {},
}));

vi.mock('@trpc/tanstack-react-query', () => ({
  // Only `user.me.queryFilter` is ever reached off this proxy outside a
  // component, and it is what the 401 reaction uses to drop the cached identity.
  createTRPCOptionsProxy: vi.fn(() => ({
    user: { me: { queryFilter: () => ({ queryKey: [['user', 'me']] }) } },
  })),
}));

vi.mock('./csrf', () => ({
  getCsrfToken: vi.fn().mockResolvedValue('csrf-token'),
  fetchWithCsrfRetry: fetchWithCsrfRetrySpy,
  resetCsrfToken: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

/** Build the client and hand back the splitLink options it was configured with. */
async function buildLinks() {
  vi.resetModules();
  const { getTrpc } = await import('./trpc');
  getTrpc();
  const options = splitLinkSpy.mock.calls[0]?.[0] as {
    condition: (op: { context: Record<string, unknown> }) => boolean;
  };
  return options;
}

describe('trpc link chain', () => {
  it('routes an operation carrying an idempotency key out of the batch', async () => {
    const { condition } = await buildLinks();
    expect(condition({ context: { idempotencyKey: 'abc' } })).toBe(true);
  });

  it('leaves everything else on the batching link', async () => {
    const { condition } = await buildLinks();
    expect(condition({ context: {} })).toBe(false);
  });

  it('wires both a batching and a non-batching transport', async () => {
    await buildLinks();
    expect(httpLinkSpy).toHaveBeenCalledTimes(1);
    expect(httpBatchLinkSpy).toHaveBeenCalledTimes(1);
  });

  it('puts the key on the header the api middleware actually reads', async () => {
    await buildLinks();
    const linkOptions = httpLinkSpy.mock.calls[0]?.[0] as ILinkOptions;

    const headers = linkOptions.headers({ op: { context: { idempotencyKey: 'abc-123' } } });

    expect(headers['idempotency-key']).toBe('abc-123');
  });

  it('omits the header entirely when no key is present, rather than sending an empty one', async () => {
    await buildLinks();
    const linkOptions = httpLinkSpy.mock.calls[0]?.[0] as ILinkOptions;

    const headers = linkOptions.headers({ op: { context: {} } });

    expect(headers).not.toHaveProperty('idempotency-key');
  });

  /**
   * CSRF is attached by the shared fetch, not by either link's `headers()`:
   * only the fetch layer sees the HTTP method, and the method decides whether a
   * token is needed at all. Asking for one in `headers()` made every read-only
   * boot spend a slot of the token endpoint's 30/60s throttle. These two pin
   * that both transports go through that wrapper, so neither can quietly grow
   * its own unprotected fetch.
   */
  it.each([
    ['single', () => httpLinkSpy.mock.calls[0]?.[0] as ILinkOptions],
    ['batched', () => httpBatchLinkSpy.mock.calls[0]?.[0] as ILinkOptions],
  ])('routes the %s transport through the CSRF-aware fetch', async (_name, getOptions) => {
    await buildLinks();

    getOptions().fetch('/trpc/auth.login', { method: 'POST' });

    expect(fetchWithCsrfRetrySpy).toHaveBeenCalledWith('/trpc/auth.login', { method: 'POST' });
  });

  it('does not ask either transport for a CSRF token up front', async () => {
    const { getCsrfToken } = await import('./csrf');
    await buildLinks();
    const single = httpLinkSpy.mock.calls[0]?.[0] as ILinkOptions;
    const batched = httpBatchLinkSpy.mock.calls[0]?.[0] as Partial<ILinkOptions>;

    single.headers({ op: { context: {} } });

    // The batching link has no header factory left at all, and the single link's
    // remaining one is idempotency-only.
    expect(batched.headers).toBeUndefined();
    expect(getCsrfToken).not.toHaveBeenCalled();
  });
});

/**
 * The one 401 reaction shared by queries and mutations.
 *
 * WITHOUT IT a session that dies mid-visit is invisible for up to five minutes:
 * 401 is deliberately never toasted, the only guard that reacted to one runs on
 * navigation and reads `user.me` through a 5-minute staleTime, so every widget
 * silently fails while every new page passes the guard on a cached identity.
 * Both caches are asserted separately because a mutation-only fix (the shape
 * this codebase lacked entirely) leaves reads broken and vice versa.
 */
describe('401 session-expiry reaction', () => {
  interface ICacheConfig {
    onError?: (error: unknown, subject: unknown) => void;
  }

  /** A query stub shaped like the two fields the query handler reads. */
  const backgroundRefetch = { queryKey: [['workspaces', 'list']], state: { data: [] } };
  const initialLoad = { queryKey: [['workspaces', 'list']], state: { data: undefined } };

  async function loadTrpc() {
    vi.resetModules();
    const { TRPCClientError } = await import('@trpc/client');
    const trpcModule = await import('./trpc');
    const queryOnError = (
      trpcModule.queryClient.getQueryCache() as unknown as { config: ICacheConfig }
    ).config.onError;
    const mutationOnError = (
      trpcModule.queryClient.getMutationCache() as unknown as { config: ICacheConfig }
    ).config.onError;
    return { ...trpcModule, TRPCClientError, queryOnError, mutationOnError };
  }

  /** What the transport hands back for a refused session. */
  function unauthorized(TRPCClientError: new (message: string) => Error) {
    return Object.assign(new TRPCClientError('Unauthorized'), {
      data: { code: 'UNAUTHORIZED', httpStatus: 401 },
    });
  }

  /**
   * Put a profile in the cache, which is what makes a 401 a session that DIED
   * rather than a credential that was refused. `login` answers a wrong password
   * with the same UNAUTHORIZED code and a deliberately generic message, so this
   * is the only thing that separates the two.
   */
  function withSession(queryClient: QueryClient) {
    queryClient.setQueryData([['user', 'me']], { id: 'u-1', email: 'a@b.c' });
  }

  it.each([
    ['query', 'queryOnError' as const, backgroundRefetch],
    ['mutation', 'mutationOnError' as const, undefined],
  ])('announces the bounce when a %s comes back 401', async (_name, handlerKey, subject) => {
    const mod = await loadTrpc();
    withSession(mod.queryClient);
    const listener = vi.fn();
    window.addEventListener(mod.UNAUTHORIZED_EVENT, listener);

    mod[handlerKey]?.(unauthorized(mod.TRPCClientError), subject);

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(mod.UNAUTHORIZED_EVENT, listener);
  });

  /*
   * The sign-in form itself. A wrong password is a 401 with the same code, and
   * bouncing on it replaced the field error with "sign in to do that" and
   * remounted the form; the same reaction threw an invitee off
   * `/auth/invite/$token` in a clean browser. Both were caught by e2e.
   */
  it.each([
    ['query', 'queryOnError' as const, backgroundRefetch],
    ['mutation', 'mutationOnError' as const, undefined],
  ])('stays quiet when a %s 401s with no session to lose', async (_name, handlerKey, subject) => {
    const mod = await loadTrpc();
    const listener = vi.fn();
    window.addEventListener(mod.UNAUTHORIZED_EVENT, listener);

    mod[handlerKey]?.(unauthorized(mod.TRPCClientError), subject);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(mod.UNAUTHORIZED_EVENT, listener);
  });

  it('drops the cached identity before announcing, so useAuth stops lying', async () => {
    const mod = await loadTrpc();
    withSession(mod.queryClient);
    const removeQueries = vi.spyOn(mod.queryClient, 'removeQueries');

    mod.queryOnError?.(unauthorized(mod.TRPCClientError), backgroundRefetch);

    expect(removeQueries).toHaveBeenCalledWith({ queryKey: [['user', 'me']] });
  });

  // The screen is about to be replaced by a sign-in form, so a toast about the
  // failed refetch would be noise the user cannot act on.
  it('still suppresses the toast for a 401 background refetch', async () => {
    const mod = await loadTrpc();
    const { toast } = await import('@repo/ui/sonner');
    const errorToast = vi.spyOn(toast, 'error');

    mod.queryOnError?.(unauthorized(mod.TRPCClientError), backgroundRefetch);

    expect(errorToast).not.toHaveBeenCalled();
  });

  it('leaves every other failure alone', async () => {
    const mod = await loadTrpc();
    const listener = vi.fn();
    window.addEventListener(mod.UNAUTHORIZED_EVENT, listener);
    const serverError = Object.assign(new mod.TRPCClientError('Internal server error'), {
      data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
    });

    mod.queryOnError?.(serverError, initialLoad);
    mod.mutationOnError?.(serverError, undefined);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(mod.UNAUTHORIZED_EVENT, listener);
  });
});
