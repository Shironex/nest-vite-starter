import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import superjson from 'superjson';
import { toast } from '@repo/ui/sonner';
import type { AppRouter } from '@api/@generated/server';
import { fetchWithCsrfRetry } from './csrf';
import { translateAppError } from './trpc-errors';
import { captureException } from './error-reporting';
import { i18n } from './i18n';

/** True when the error is a tRPC UNAUTHORIZED (HTTP 401) rejection. */
export function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  const data = (error as TRPCClientError<AppRouter>).data;
  return data?.code === 'UNAUTHORIZED' || data?.httpStatus === 401;
}

/**
 * Fired at `window` when any tRPC call comes back UNAUTHORIZED.
 *
 * An event rather than a direct navigation because the router is created in
 * main.tsx and this module is one of its dependencies, so importing it here
 * would be a cycle. main.tsx subscribes once; see `loginPathForExpiredSession`
 * in ./shell-routes for where a listener is allowed to send somebody.
 */
export const UNAUTHORIZED_EVENT = 'app:unauthorized';

/**
 * React to a 401 once, for queries and mutations alike.
 *
 * WITHOUT THIS a session that dies mid-visit is invisible. `beforeLoad` is the
 * only thing that ever reacted to a 401, it runs on navigation only, and it
 * reads `user.me` through a 5-minute `staleTime`, so for five minutes every
 * widget refetch fails silently (401 is deliberately not toasted), every save
 * fails with "sign in to do that" while nothing navigates, and each new page
 * passes the guard on the cached identity and paints more broken screens. The
 * cached `user.me` is dropped first so `useAuth().isAuthenticated` stops
 * reporting a session that is gone, and only then is the bounce announced.
 *
 * Returns whether the error WAS a 401, so the query path can keep skipping its
 * toast for it.
 */
function reactToUnauthorized(error: unknown): boolean {
  if (!isUnauthorizedError(error)) return false;

  /*
   * ONLY WHEN THERE WAS A SESSION TO LOSE, and this guard is not an
   * optimization: without it the reaction fires on the sign-in form itself.
   *
   * `login` answers a wrong password with tRPC UNAUTHORIZED and the message
   * "Invalid email or password", deliberately generic so a caller cannot
   * enumerate accounts, which means the appCode CANNOT tell a refused
   * credential from a dead session. The observable difference is whether we
   * held a profile a moment ago. A visitor typing the wrong password never did;
   * a session that died mid-visit did.
   *
   * The e2e symptom of getting this wrong was real: a wrong password
   * replaced the field error with "Sign in to perform this action." and
   * remounted the form.
   *
   * The failure direction is right too: a 401 arriving after the profile has
   * already been dropped (a second request from the same dead session) does not
   * re-announce a bounce that is already under way.
   */
  const profile = getTrpc().user.me.queryFilter();
  const held = queryClient.getQueriesData(profile).some(([, data]) => data !== undefined);
  if (!held) return false;

  queryClient.removeQueries(profile);
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  return true;
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    // Every mutation already has its own onError for user-facing copy; both
    // run, and this one adds only the session-expiry reaction.
    onError: (error) => {
      reactToUnauthorized(error);
    },
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      /*
       * A 401 is never a toast. When we held a session it bounces to sign-in
       * and the screen is about to be replaced anyway; when we did not, the
       * route's own guard or its error state is the honest place for it, and a
       * toast on top of a sign-in form is noise.
       */
      reactToUnauthorized(error);
      if (isUnauthorizedError(error)) return;
      console.error('[query] query failed', query.queryKey, error);
      captureException(error, { extra: { queryKey: query.queryKey } });
      // Toast only background refetch failures (data already on screen).
      // Initial-load errors are rendered by route/component error states.
      if (query.state.data !== undefined) {
        toast.error(i18n.t('common:errors.refreshFailed'), {
          description: translateAppError(error) ?? i18n.t('common:errors.unexpected'),
        });
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

// Re-export so existing consumers keep importing the CSRF reset from here.
export { resetCsrfToken } from './csrf';

/** Same-origin: the dev server and the platform router forward `/trpc` to the api. */
const TRPC_URL = '/trpc';

/**
 * The batching link's options.
 *
 * The CSRF token rides on this `fetch` rather than on the link's `headers()`
 * because only the fetch layer knows the HTTP method, and the method is what
 * decides whether the api validates a token at all. Asking for one in
 * `headers()` meant every query paid for a token it never used, which spent one
 * of GET /api/csrf-token's 30-per-60s-per-IP slots on every SPA boot. See
 * lib/csrf.ts.
 */
const linkOptions = () => ({
  url: TRPC_URL,
  // Must match TRPCModule.forRoot transformer (apps/api/src/app.module.ts)
  transformer: superjson,
  fetch(url: unknown, options: unknown) {
    return fetchWithCsrfRetry(url as RequestInfo | URL, options as RequestInit);
  },
});

// Lazy-init: the tRPC client is created on first access.
let _trpcClient: ReturnType<typeof createTRPCClient<AppRouter>> | null = null;

function getTrpcClient() {
  if (!_trpcClient) {
    _trpcClient = createTRPCClient<AppRouter>({
      links: [httpBatchLink(linkOptions())],
    });
  }
  return _trpcClient;
}

let _trpc: ReturnType<typeof createTRPCOptionsProxy<AppRouter>> | null = null;

export function getTrpc() {
  if (!_trpc) {
    _trpc = createTRPCOptionsProxy<AppRouter>({
      client: getTrpcClient(),
      queryClient,
    });
  }
  return _trpc;
}

// Re-export as `trpc` via getter for existing consumers.
export const trpc = new Proxy({} as ReturnType<typeof createTRPCOptionsProxy<AppRouter>>, {
  get(_target, prop, receiver) {
    return Reflect.get(getTrpc(), prop, receiver);
  },
});
