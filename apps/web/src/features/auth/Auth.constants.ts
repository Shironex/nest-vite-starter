/**
 * Shared SaaS Starter presentation classes for the auth screens.
 *
 * These exist because the pieces they style live in `@repo/ui` and are shaped
 * for the generic shadcn defaults (a 36px button, a 6px radius). The auth
 * screens need the treatment from the design (40/42px controls on a 10px
 * radius), and keeping the override in one constant beats repeating the same
 * class string across five forms. If `@repo/ui` ever grows a SaaS Starter-native
 * button/input size, these collapse into that instead.
 */

/** Full-width primary submit, matching the 42px CTA in the design's form column. */
export const AUTH_SUBMIT_CLASS =
  'type-body-medium! h-10.5 w-full rounded-lg bg-brand text-brand-fg shadow-none hover:bg-brand-hover';

/** Brand-coloured inline link, used in headers and under the submit button. */
export const AUTH_LINK_CLASS =
  'rounded-sm font-medium text-brand-ink transition-colors hover:text-brand-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** The quieter link treatment for "back to sign in" style navigation. */
export const AUTH_MUTED_LINK_CLASS =
  'type-body-small rounded-sm text-text-muted transition-colors hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/* -------------------------------------------------------------------------- */
/* OAuth (Google sign-in)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The providers this build knows how to draw. Discovery answers with keys only
 * (`{ providers: [{ key: 'google' }] }`) because the WEB owns all branding and
 * copy, so an unknown key is one this build cannot render and is dropped rather
 * than shown as a bare string. Widening this tuple is what makes the compiler
 * demand a glyph, a label and a button treatment for the new provider.
 */
export const OAUTH_PROVIDER_KEYS = ['google'] as const;

export type OAuthProviderKey = (typeof OAUTH_PROVIDER_KEYS)[number];

export function isOAuthProviderKey(value: unknown): value is OAuthProviderKey {
  return typeof value === 'string' && (OAUTH_PROVIDER_KEYS as readonly string[]).includes(value);
}

/**
 * Provider display names, shared by the sign-in buttons and the Connected
 * Accounts panel. Google's branding guidelines forbid translating the word
 * "Google", so the proper noun is interpolated into localized copy rather than
 * being part of it.
 */
export const OAUTH_PROVIDER_NAMES: Record<OAuthProviderKey, string> = {
  google: 'Google',
};

/**
 * A display name for ANY provider key, including one this build has no entry
 * for. The list panel must render every linked row the api returns (the user
 * needs to be able to unlink it), so an unknown key degrades to a capitalized
 * label instead of being dropped the way the sign-in buttons drop it.
 */
export function oauthProviderDisplayName(providerKey: string): string {
  return isOAuthProviderKey(providerKey)
    ? OAUTH_PROVIDER_NAMES[providerKey]
    : `${providerKey.charAt(0).toUpperCase()}${providerKey.slice(1)}`;
}

/**
 * Where the OAuth controller is mounted. Mirrors OAUTH_BASE_PATH in
 * apps/api/src/modules/auth/oauth/oauth.constants.ts, which is runtime code the
 * web cannot import. The `/api` prefix is load bearing: the platform router in
 * front of the SPA only forwards /trpc and /api to the api, so a
 * path outside those two is answered by index.html.
 */
const OAUTH_BASE_PATH = '/api/auth/oauth';

/**
 * Where the browser is sent to attach a provider to the signed-in account
 * (SPEC section 8). A full-page navigation like {@link oauthStartPath}, and it
 * requires a live session PLUS a live sudo grant, so the caller must run the
 * confirm-password dialog first. No returnTo: the api pins link-intent flows
 * back to /settings (OAUTH_LINK_RETURN_TO on its side) and accepting one here
 * would only widen the redirect surface.
 */
export function oauthLinkStartPath(provider: OAuthProviderKey): string {
  return `${OAUTH_BASE_PATH}/${provider}/start?intent=link`;
}

/**
 * Query param the callback appends to /settings on a successful link, carrying
 * the provider key. Mirrors OAUTH_LINKED_PARAM in
 * apps/api/src/modules/auth/oauth/oauth.constants.ts, which is runtime code the
 * web cannot import (only the generated router TYPES cross that boundary).
 */
export const OAUTH_LINKED_PARAM = 'oauth_linked';

/** Discovery. Plain HTTP, not tRPC, so it is fetched directly (SPEC section 9). */
export const OAUTH_PROVIDERS_PATH = `${OAUTH_BASE_PATH}/providers`;

/**
 * Where the browser is sent to begin a flow. A full-page navigation, never a
 * fetch: the api answers with a 302 to Google's consent screen, and only a
 * top-level document navigation can follow that into an origin the SPA is not
 * allowed to read.
 */
export function oauthStartPath(provider: OAuthProviderKey, returnTo: string): string {
  return `${OAUTH_BASE_PATH}/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * The `?error=` values the OAuth callback can hand back on `/auth`
 * (SPEC section 9 item 3).
 *
 * These are URL query values, NOT `AppErrorCode`s: they never ride on a tRPC
 * error, so they deliberately live outside `lib/i18n/error-catalog.ts` and its
 * exhaustive `Record<AppErrorCode, string>`. Their copy lives under the
 * `common:auth.oauthErrors` namespace for the same reason.
 *
 * Unknown values are dropped rather than rendered generically: a code the web
 * has no sentence for is a contract the api changed without shipping the copy,
 * and the same discipline that governs the error catalog applies here.
 */
export const OAUTH_ERROR_CODES = [
  'oauth_failed',
  'oauth_state_expired',
  'oauth_account_exists',
  'oauth_link_blocked',
  'oauth_signup_disabled',
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export function isOAuthErrorCode(value: unknown): value is OAuthErrorCode {
  return typeof value === 'string' && (OAUTH_ERROR_CODES as readonly string[]).includes(value);
}
