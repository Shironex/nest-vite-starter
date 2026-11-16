/**
 * Wire, storage and error constants for the OAuth/OIDC sign-in surface
 * (see apps/docs/src/content/docs/backend/google-sign-in.md).
 *
 * Everything the flow needs to name a route, a Redis record or a failure lives
 * here so the controller, the flow service and their specs cannot drift from
 * each other or from the redirect_uri registered in the provider's console.
 */

/**
 * Controller prefix. Nest registers controller paths WITHOUT a leading slash,
 * so the slashed form is derived rather than written twice.
 *
 * The `api/` prefix is load bearing: the SPA reaches the api same-origin through
 * a platform router that only forwards `/trpc`, `/api` and `/socket.io`
 * (apps/web/nginx.conf header, apps/web/vite.config.ts apiProxy). A controller
 * mounted outside those three prefixes is answered by the SPA's index.html in
 * every browser deployment, so every browser-reached controller lives here.
 */
export const OAUTH_CONTROLLER_PATH = 'api/auth/oauth';
export const OAUTH_BASE_PATH = `/${OAUTH_CONTROLLER_PATH}`;

/**
 * Route segments under {@link OAUTH_CONTROLLER_PATH}. The callback segment is
 * shared with {@link buildOAuthRedirectUri} so the mounted route and the
 * exact-match `redirect_uri` cannot drift apart.
 */
const CALLBACK_SEGMENT = 'callback';
export const OAUTH_PROVIDERS_ROUTE = 'providers';
export const OAUTH_START_ROUTE = ':provider/start';
export const OAUTH_CALLBACK_ROUTE = `:provider/${CALLBACK_SEGMENT}`;

/**
 * The `redirect_uri` sent to the IdP and matched exactly by its console entry.
 *
 * `apiPublicUrl` MUST come from the `API_PUBLIC_URL` config key and never from
 * the request's Host header: a Host-derived value lets a
 * request with a forged Host steer the authorization code to another origin.
 * Only the origin of `apiPublicUrl` is used, so a path suffix on that key is
 * ignored rather than silently doubling up.
 */
export function buildOAuthRedirectUri(apiPublicUrl: string, providerKey: string): string {
  return new URL(`${OAUTH_BASE_PATH}/${providerKey}/${CALLBACK_SEGMENT}`, apiPublicUrl).toString();
}

/**
 * Redis prefix for the pending-flow record (nonce, PKCE verifier, returnTo,
 * intent, browser-bind hash). Keyed by sha256(state), never the raw state, so a
 * Redis dump cannot be replayed as a state parameter. Not routed through
 * `RedisKeys`: that helper is the tenant-prefix retrofit surface for
 * request-scoped data, while this record is pre-auth and pre-tenant, like the
 * throttler's own keys.
 */
export const OAUTH_STATE_KEY_PREFIX = 'oauth:state';

export function oauthStateKey(stateHash: string): string {
  return `${OAUTH_STATE_KEY_PREFIX}:${stateHash}`;
}

/**
 * Lifetime of the pending-flow record and of the browser-binding cookie that
 * pairs with it. Ten minutes is long enough for a consent screen plus an
 * account chooser, short enough that an abandoned flow cannot be resumed from a
 * shared machine later.
 */
export const OAUTH_STATE_TTL_SECONDS = 600;

/** Where a login lands when `returnTo` is absent or fails path validation. */
export const OAUTH_DEFAULT_RETURN_TO = '/dashboard';

/**
 * Where a link-intent flow lands. Fixed rather than caller-supplied: the flow
 * is started from the settings panel and must return there, so accepting a
 * returnTo would only widen the redirect surface for no feature.
 */
export const OAUTH_LINK_RETURN_TO = '/settings';

/**
 * Query param appended to {@link OAUTH_LINK_RETURN_TO} on a successful link,
 * carrying the provider key. Part of the web contract like the error codes
 * below (the settings panel shows its success toast from it).
 */
export const OAUTH_LINKED_PARAM = 'oauth_linked';

/**
 * Browser-binding cookie for a pending flow: `/start` sets a
 * random value whose hash rides the state blob, and the callback requires the
 * cookie to match, so an attacker cannot make a victim's browser complete a
 * flow the attacker started (forced login / session fixation). `__Host-` in
 * production only, mirroring getSessionCookieName: the prefix requires Secure
 * and local http cannot satisfy it.
 */
const OAUTH_FLOW_COOKIE_BASE_NAME = 'oauth_flow';

export function getOAuthFlowCookieName(isProduction: boolean): string {
  return isProduction ? `__Host-${OAUTH_FLOW_COOKIE_BASE_NAME}` : OAUTH_FLOW_COOKIE_BASE_NAME;
}

/**
 * Per-IP fixed-window limits, enforced via the shared Redis
 * limiter under these named scopes. `/start` matches the login envelope
 * (moderate: a NAT'd organization office legitimately starts several flows a minute);
 * `/callback` is stricter because a legitimate browser hits it exactly once
 * per started flow, so a burst there is state guessing, not people.
 */
export const OAUTH_START_RATE_SCOPE = 'oauth-start';
export const OAUTH_START_RATE_LIMIT = 10;
export const OAUTH_CALLBACK_RATE_SCOPE = 'oauth-callback';
export const OAUTH_CALLBACK_RATE_LIMIT = 5;
export const OAUTH_RATE_WINDOW_SECONDS = 60;

/**
 * Human-facing provider name for email copy (the tripwire notification names
 * the provider that was linked). The web owns its own branding copy from the
 * discovery key; this map only feeds mail templates rendered API-side.
 */
const OAUTH_PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
};

export function oauthProviderLabel(providerKey: string): string {
  return (
    OAUTH_PROVIDER_LABELS[providerKey] ??
    `${providerKey.charAt(0).toUpperCase()}${providerKey.slice(1)}`
  );
}

/**
 * Failure codes for the OAuth surface.
 *
 * These are deliberately NOT members of the shared `AppErrorCode` enum. That
 * enum is the tRPC error contract, and the web mirrors it in an exhaustive
 * `Record<AppErrorCode, string>` catalog; these codes never travel in a tRPC
 * error payload. Every OAuth failure is a 302 back to the SPA carrying
 * `?error=<code>` (SPEC section 5), so the value is a URL query param the
 * `/auth` route maps to copy, and the redirect contract is what the two sides
 * share.
 */
export const OAUTH_ERROR_CODES = {
  /** Anything the user must not be told apart: bad code, bad signature, unverified email, provider outage. */
  FAILED: 'oauth_failed',
  /** The pending-flow record was gone at callback time (expired, replayed, or wrong browser). */
  STATE_EXPIRED: 'oauth_state_expired',
  /** The email belongs to an existing account that this flow may not auto-link to. */
  ACCOUNT_EXISTS: 'oauth_account_exists',
  /** Auto-link refused because the target account has active second factors. */
  LINK_BLOCKED: 'oauth_link_blocked',
  /** No account matched and `OAUTH_ALLOW_SIGNUP` is off. */
  SIGNUP_DISABLED: 'oauth_signup_disabled',
} as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[keyof typeof OAUTH_ERROR_CODES];

/**
 * Where a failed flow lands: the SPA auth screen with `?error=<code>`, which
 * maps the code to copy (SPEC section 9 item 3). Always a 302, never JSON:
 * the browser is mid-navigation, so a JSON body would just be a dead end.
 */
export function buildAuthErrorRedirect(appUrl: string, code: OAuthErrorCode): string {
  return `${appUrl}/auth?error=${code}`;
}

/**
 * The SPA route a challenge outcome lands on (2FA T13 owns the route; the
 * seam has already set the pending `__Host-2fa` cookie by the time the
 * browser follows this redirect). Matches apps/web/src/routes/auth/two-factor.
 */
export const OAUTH_TWO_FACTOR_CHALLENGE_PATH = '/auth/two-factor';
