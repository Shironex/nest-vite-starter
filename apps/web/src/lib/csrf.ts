import { CSRF_HEADER, CSRF_TOKEN_PATH } from '@repo/shared/constants';
import { API_CREDENTIALS, apiUrl } from './env';
import { SMALL_FETCH_TIMEOUT_MS } from './fetch-timeouts';

// Cache the in-flight promise (not the resolved string) so parallel first
// callers share a single CSRF_TOKEN_PATH request instead of firing duplicates.
let csrfTokenPromise: Promise<string> | null = null;

/**
 * The methods the api passes through without validating a token
 * (`CsrfService.protect`, apps/api/src/common/security/csrf.service.ts).
 *
 * Mirroring that list here is what makes the token fetch lazy: a request the
 * server never validates never needs a token, so a read-only boot spends none
 * of GET /api/csrf-token's 30-per-60s-per-IP budget. Previously every boot
 * spent one because the tRPC links asked for a token before any request,
 * mutation or not, which throttled real users who reload quickly.
 *
 * The two lists being identical is the whole safety argument. Widen this set
 * only if `protect` widens with it, never on its own.
 */
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True when the api will CSRF-validate this request, so it must carry a token. */
function requiresCsrfToken(init?: RequestInit): boolean {
  // fetch() treats a missing method as GET.
  return !CSRF_SAFE_METHODS.has((init?.method ?? 'GET').toUpperCase());
}

/**
 * Mint (or reuse) the double-submit token for a mutating request.
 *
 * Only reached from the mutating branch of `fetchWithCsrfRetry` and from its
 * 403 self-heal, so nothing calls it on a render-only journey.
 */
export function getCsrfToken(): Promise<string> {
  if (csrfTokenPromise) return csrfTokenPromise;

  const pending = fetch(apiUrl(CSRF_TOKEN_PATH), {
    credentials: API_CREDENTIALS,
    // The promise is cached: without a bound, a hung token fetch would block
    // every mutation until reload. A timeout rejects, which clears the cache
    // below, so the next mutation retries.
    signal: AbortSignal.timeout(SMALL_FETCH_TIMEOUT_MS),
  })
    .then(async (response) => {
      // Throwing routes wrong-shape successes through the catch below, which
      // clears the cache; without this a JSON-bodied 5xx (proxy error page)
      // would cache `undefined` forever and every mutation would 403 with the
      // literal header value "undefined" until a full reload.
      if (!response.ok) {
        throw new Error(`CSRF token request failed with ${response.status}`);
      }
      const data = (await response.json()) as { csrfToken?: unknown };
      if (typeof data.csrfToken !== 'string') {
        throw new Error('Malformed CSRF token response');
      }
      return data.csrfToken;
    })
    .catch((error: unknown) => {
      // Drop the failed promise so the next call retries instead of caching the rejection.
      if (csrfTokenPromise === pending) {
        csrfTokenPromise = null;
      }
      throw error;
    });

  csrfTokenPromise = pending;
  return pending;
}

/** Reset cached CSRF token. Call after login/logout/register to get a fresh token tied to the new session. */
export function resetCsrfToken(): void {
  csrfTokenPromise = null;
}

/**
 * Custom fetch wrapper that owns both halves of the client's CSRF contract.
 *
 * 1. It attaches the token to exactly the requests the api validates, and
 *    fetches one only then. Read traffic (tRPC queries travel as GET) leaves
 *    without a token and without a round trip to CSRF_TOKEN_PATH, so a boot
 *    that only renders costs nothing against that endpoint's throttle.
 * 2. If a request comes back 403 with a CSRF-related error, it resets the
 *    cached token, fetches a new one, and retries the request once.
 *
 * Attaching here rather than in each link's `headers()` keeps the rule in one
 * place next to the safe-method list it mirrors, and means a mutation cannot
 * reach the network without a token by construction.
 *
 * On laziness and the `csrf-sid` race: the api mints the pre-session sid cookie
 * on the first non-exempt request of ANY method, not only on CSRF_TOKEN_PATH
 * (`CsrfService.ensureSessionIdentifier`), and the token is hashed against
 * whichever sid the browser holds. Deferring the token fetch therefore cannot
 * create a second sid - by the time a mutation runs, boot read traffic has
 * already established one and the token is minted against it. The only window
 * left is a mutation fired before any response has landed, where two sid-less
 * requests each mint one and last-write-wins; that surfaces as a 403 and is
 * exactly what the retry below repairs, and the retry cannot re-race because a
 * sid cookie provably exists by then.
 *
 * Exported for unit coverage: the cold-start login e2e never trips a CSRF 403
 * (login succeeds cleanly once the sid race is fixed), so this retry path is
 * proven only here.
 */
export async function fetchWithCsrfRetry(
  url: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (requiresCsrfToken(init)) {
    headers.set(CSRF_HEADER, await getCsrfToken());
  }

  const opts: RequestInit = {
    ...init,
    headers,
    credentials: API_CREDENTIALS,
  };

  const response = await fetch(url, opts);

  if (response.status === 403) {
    // Clone the response so we can read the body without consuming it
    const cloned = response.clone();
    try {
      // The API wraps errors in `{ error: { message, code } }` (AllExceptionsFilter)
      // and the CSRF middleware now responds in that same envelope. Read the
      // nested message, falling back to a flat `message` for resilience.
      const body = (await cloned.json()) as { message?: string; error?: { message?: string } };
      const rawMessage = body.error?.message ?? body.message;
      const msg = typeof rawMessage === 'string' ? rawMessage.toLowerCase() : '';
      if (msg.includes('csrf')) {
        // Reset token and get a fresh one
        resetCsrfToken();
        const newToken = await getCsrfToken();

        // Retry with the new CSRF token in headers
        const retryHeaders = new Headers(headers);
        retryHeaders.set(CSRF_HEADER, newToken);

        return fetch(url, {
          ...init,
          headers: retryHeaders,
          credentials: API_CREDENTIALS,
        });
      }
    } catch {
      // Body wasn't JSON or some other issue: return the original response
    }
  }

  return response;
}
