import {
  OAUTH_BASE_PATH,
  OAUTH_CONTROLLER_PATH,
  OAUTH_ERROR_CODES,
  OAUTH_STATE_TTL_SECONDS,
  buildOAuthRedirectUri,
  oauthStateKey,
} from './oauth.constants';

describe('oauth constants', () => {
  it('derives the slashed base path from the Nest controller prefix', () => {
    expect(OAUTH_CONTROLLER_PATH.startsWith('/')).toBe(false);
    expect(OAUTH_BASE_PATH).toBe('/api/auth/oauth');
  });

  it('stays under the api/ prefix the platform router forwards', () => {
    // The SPA reaches the api same-origin and the router in front of it only
    // forwards /trpc, /api and /socket.io (apps/web/nginx.conf header,
    // apps/web/vite.config.ts apiProxy). A controller mounted outside those
    // three is answered by the SPA's index.html, so discovery parses HTML as
    // JSON and the Google button never renders.
    expect(OAUTH_CONTROLLER_PATH.startsWith('api/')).toBe(true);
  });

  describe('buildOAuthRedirectUri', () => {
    it('builds the exact-match value registered in the provider console', () => {
      expect(buildOAuthRedirectUri('https://api.example.com', 'google')).toBe(
        'https://api.example.com/api/auth/oauth/google/callback',
      );
    });

    it('is insensitive to a trailing slash or path on API_PUBLIC_URL', () => {
      // Redirect URIs are exact-match at the IdP, so a stray trailing slash in
      // the env value must not produce a second, unregistered value.
      expect(buildOAuthRedirectUri('https://api.example.com/', 'google')).toBe(
        'https://api.example.com/api/auth/oauth/google/callback',
      );
      expect(buildOAuthRedirectUri('https://api.example.com/ignored', 'google')).toBe(
        'https://api.example.com/api/auth/oauth/google/callback',
      );
    });
  });

  it('namespaces the pending-flow record under its own Redis prefix', () => {
    expect(oauthStateKey('abc123')).toBe('oauth:state:abc123');
  });

  it('expires a pending flow in ten minutes', () => {
    expect(OAUTH_STATE_TTL_SECONDS).toBe(600);
  });

  it('keeps the failure codes url-safe, since they travel as ?error= query params', () => {
    for (const code of Object.values(OAUTH_ERROR_CODES)) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(encodeURIComponent(code)).toBe(code);
    }
  });
});
