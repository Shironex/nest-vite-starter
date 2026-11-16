/**
 * The normalized provider contract.
 *
 * Everything outside `providers/` (controller, flow service, account service,
 * specs) sees only these types, so a second IdP is one provider class plus one
 * registry entry: no controller, flow or schema change. Provider-specific
 * weirdness (Apple's ES256 client-secret JWT, Microsoft's multi-tenant issuer
 * validation) stays inside its own provider file.
 */

/** A provider's claims, normalized to the fields the account resolution needs. */
export interface IOAuthIdentity {
  /** Matches the owning provider's `key`, and the `provider` column on OAuthAccount. */
  provider: string;
  /**
   * The OIDC `sub` claim. Together with `provider` this is the ONLY account
   * identity; `email` is a mutable snapshot and must never be a lookup key.
   */
  subject: string;
  email: string;
  /** The provider's own verification claim. An unverified email is never trusted for linking or signup. */
  emailVerified: boolean;
  displayName?: string;
  avatarUrl?: string;
}

export interface IOAuthProvider {
  /** Used in routes, in the OAuthAccount `provider` column, and for env lookup. */
  readonly key: string;
  /**
   * False when the provider's credentials are absent from config, which is a
   * legal deployment: the registry then hides it from discovery and its
   * routes 404, rather than the app refusing to boot without a Google project.
   */
  readonly isEnabled: boolean;
  buildAuthorizationUrl(params: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<URL>;
  handleCallback(params: {
    /** The full callback URL including its query, rebuilt from `API_PUBLIC_URL`. */
    currentUrl: URL;
    redirectUri: string;
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
  }): Promise<IOAuthIdentity>;
}

/** DI token for the multi-provider array every `IOAuthProvider` registers into. */
export const OAUTH_PROVIDERS = 'OAUTH_PROVIDERS';

/**
 * DI token for the openid-client function surface.
 *
 * Binding the library behind a token is what lets provider specs inject a fake
 * and assert the exact arguments handed to the library, with no network and no
 * Google project. `OAuthModule` binds it to the real ESM module.
 */
export const OPENID_CLIENT = 'OPENID_CLIENT';

/**
 * The slice of openid-client the providers use. Written as a `Pick` of the real
 * module type so a breaking change in the library fails type-check here rather
 * than at runtime, and so the module can bind its namespace object directly.
 */
export type IOpenIdClient = Pick<
  typeof import('openid-client'),
  'discovery' | 'buildAuthorizationUrl' | 'authorizationCodeGrant'
>;

/**
 * The discovered server configuration handle (it caches the IdP's JWKS
 * internally). Derived from the token type so no file outside this one has to
 * name `openid-client` at all.
 */
export type IOpenIdConfiguration = Awaited<ReturnType<IOpenIdClient['discovery']>>;
