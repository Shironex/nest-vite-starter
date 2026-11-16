import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleProvider } from './google.provider';
import { OPENID_CLIENT } from './oauth-provider.interface';

/**
 * The whole point of the OPENID_CLIENT token: these specs assert
 * the exact arguments handed to openid-client with no network, no Google
 * project and no discovery document, so a missing OAuth client never blocks
 * the suite.
 */
const buildOpenIdClientFake = () => ({
  discovery: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  authorizationCodeGrant: jest.fn(),
});

type OpenIdClientFake = ReturnType<typeof buildOpenIdClientFake>;

const CLIENT_ID = 'google-client-id';
const CLIENT_SECRET = 'google-client-secret';
const REDIRECT_URI = 'https://api.example.com/api/auth/oauth/google/callback';

const buildProvider = async (
  env: Record<string, string | undefined> = {
    OAUTH_GOOGLE_CLIENT_ID: CLIENT_ID,
    OAUTH_GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  },
): Promise<{ provider: GoogleProvider; openIdClient: OpenIdClientFake }> => {
  const openIdClient = buildOpenIdClientFake();
  const moduleRef = await Test.createTestingModule({
    providers: [
      GoogleProvider,
      { provide: OPENID_CLIENT, useValue: openIdClient },
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
    ],
  }).compile();
  return { provider: moduleRef.get(GoogleProvider), openIdClient };
};

/** Minimal stand-in for the discovered Configuration handle; never inspected. */
const discoveredConfig = { issuer: 'https://accounts.google.com' };

const grantResult = (claims: Record<string, unknown> | undefined) => ({
  claims: () => claims,
});

describe('GoogleProvider', () => {
  describe('enablement', () => {
    it('is enabled when both credentials are configured', async () => {
      const { provider } = await buildProvider();
      expect(provider.key).toBe('google');
      expect(provider.isEnabled).toBe(true);
    });

    it('is disabled when the credentials are absent', async () => {
      const { provider } = await buildProvider({});
      expect(provider.isEnabled).toBe(false);
    });

    it('treats the empty-string form of an unset key as absent', async () => {
      // .env.example carries `OAUTH_GOOGLE_CLIENT_ID=` (env-cascade-drift wants
      // every Joi key present on disk), and ConfigService falls back to that raw
      // process.env entry, so '' is the shape an unconfigured deployment has.
      const { provider } = await buildProvider({
        OAUTH_GOOGLE_CLIENT_ID: '   ',
        OAUTH_GOOGLE_CLIENT_SECRET: '',
      });
      expect(provider.isEnabled).toBe(false);
    });

    it('refuses to build an authorization url while disabled', async () => {
      const { provider, openIdClient } = await buildProvider({});
      await expect(
        provider.buildAuthorizationUrl({
          redirectUri: REDIRECT_URI,
          state: 'state',
          nonce: 'nonce',
          codeChallenge: 'challenge',
        }),
      ).rejects.toThrow(/not configured/);
      expect(openIdClient.discovery).not.toHaveBeenCalled();
    });
  });

  describe('buildAuthorizationUrl', () => {
    it('discovers against the issuer and requests an S256 PKCE code flow', async () => {
      const { provider, openIdClient } = await buildProvider();
      const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth?client_id=x');
      openIdClient.discovery.mockResolvedValue(discoveredConfig);
      openIdClient.buildAuthorizationUrl.mockReturnValue(authorizationUrl);

      const result = await provider.buildAuthorizationUrl({
        redirectUri: REDIRECT_URI,
        state: 'the-state',
        nonce: 'the-nonce',
        codeChallenge: 'the-challenge',
      });

      // The issuer identifier, NOT the discovery document URL: passing the
      // document directly would disable openid-client's issuer validation.
      expect(openIdClient.discovery).toHaveBeenCalledWith(
        new URL('https://accounts.google.com'),
        CLIENT_ID,
        CLIENT_SECRET,
      );
      expect(openIdClient.buildAuthorizationUrl).toHaveBeenCalledWith(discoveredConfig, {
        redirect_uri: REDIRECT_URI,
        scope: 'openid email profile',
        state: 'the-state',
        nonce: 'the-nonce',
        code_challenge: 'the-challenge',
        code_challenge_method: 'S256',
      });
      expect(result).toBe(authorizationUrl);
    });

    it('discovers once per process and reuses the cached configuration', async () => {
      const { provider, openIdClient } = await buildProvider();
      openIdClient.discovery.mockResolvedValue(discoveredConfig);
      openIdClient.buildAuthorizationUrl.mockReturnValue(new URL('https://accounts.google.com/o'));

      const params = {
        redirectUri: REDIRECT_URI,
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
      };
      await provider.buildAuthorizationUrl(params);
      await provider.buildAuthorizationUrl(params);

      expect(openIdClient.discovery).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed discovery', async () => {
      // A rejected promise left in the cache would turn one Google outage during
      // boot into a permanently dead sign-in button.
      const { provider, openIdClient } = await buildProvider();
      openIdClient.discovery
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(discoveredConfig);
      openIdClient.buildAuthorizationUrl.mockReturnValue(new URL('https://accounts.google.com/o'));

      const params = {
        redirectUri: REDIRECT_URI,
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
      };
      await expect(provider.buildAuthorizationUrl(params)).rejects.toThrow('network down');
      await expect(provider.buildAuthorizationUrl(params)).resolves.toBeInstanceOf(URL);
      expect(openIdClient.discovery).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleCallback', () => {
    const callbackParams = {
      currentUrl: new URL(`${REDIRECT_URI}?code=the-code&state=the-state`),
      redirectUri: REDIRECT_URI,
      expectedState: 'the-state',
      expectedNonce: 'the-nonce',
      codeVerifier: 'the-verifier',
    };

    const fullClaims = {
      sub: 'google-subject-123',
      email: 'person@example.com',
      email_verified: true,
      name: 'A Person',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    };

    it('forwards the CSRF checks and normalizes the claims', async () => {
      const { provider, openIdClient } = await buildProvider();
      openIdClient.discovery.mockResolvedValue(discoveredConfig);
      openIdClient.authorizationCodeGrant.mockResolvedValue(grantResult(fullClaims));

      const identity = await provider.handleCallback(callbackParams);

      expect(openIdClient.authorizationCodeGrant).toHaveBeenCalledWith(
        discoveredConfig,
        callbackParams.currentUrl,
        {
          expectedState: 'the-state',
          expectedNonce: 'the-nonce',
          pkceCodeVerifier: 'the-verifier',
          idTokenExpected: true,
        },
      );
      expect(identity).toStrictEqual({
        provider: 'google',
        subject: 'google-subject-123',
        email: 'person@example.com',
        emailVerified: true,
        displayName: 'A Person',
        avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
      });
    });

    it('omits the optional profile fields rather than setting them undefined', async () => {
      const { provider, openIdClient } = await buildProvider();
      openIdClient.discovery.mockResolvedValue(discoveredConfig);
      openIdClient.authorizationCodeGrant.mockResolvedValue(
        grantResult({ sub: 'sub-1', email: 'person@example.com', email_verified: true }),
      );

      await expect(provider.handleCallback(callbackParams)).resolves.toStrictEqual({
        provider: 'google',
        subject: 'sub-1',
        email: 'person@example.com',
        emailVerified: true,
      });
    });

    it.each([
      ['the boolean false', false, false],
      ['the string "false"', 'false', false],
      ['the string "true"', 'true', true],
      ['an absent claim', undefined, false],
    ])('reads email_verified from %s', async (_label, claimValue, expected) => {
      // A string "false" coerced by truthiness would silently promote an
      // unverified address to a trusted one.
      const { provider, openIdClient } = await buildProvider();
      openIdClient.discovery.mockResolvedValue(discoveredConfig);
      openIdClient.authorizationCodeGrant.mockResolvedValue(
        grantResult({
          sub: 'sub-1',
          email: 'person@example.com',
          ...(claimValue === undefined ? {} : { email_verified: claimValue }),
        }),
      );

      const identity = await provider.handleCallback(callbackParams);
      expect(identity.emailVerified).toBe(expected);
    });

    it('rejects a callback url whose origin and path do not match the redirect_uri', async () => {
      // openid-client derives the token request's redirect_uri by stripping the
      // query off currentUrl, so a Host-derived callback URL would defeat
      // the fixed-redirect_uri rule silently. Fail closed before the code is exchanged.
      const { provider, openIdClient } = await buildProvider();
      openIdClient.discovery.mockResolvedValue(discoveredConfig);

      await expect(
        provider.handleCallback({
          ...callbackParams,
          currentUrl: new URL('https://evil.example.net/api/auth/oauth/google/callback?code=x'),
        }),
      ).rejects.toThrow(/does not match the configured redirect_uri/);
      expect(openIdClient.authorizationCodeGrant).not.toHaveBeenCalled();
    });

    it.each([
      ['no id token was returned', undefined],
      ['the subject is missing', { email: 'person@example.com' }],
      ['the email is missing', { sub: 'sub-1' }],
      ['the email is not an address', { sub: 'sub-1', email: 'not-an-email' }],
    ])('rejects when %s', async (_label, claims) => {
      const { provider, openIdClient } = await buildProvider();
      openIdClient.discovery.mockResolvedValue(discoveredConfig);
      openIdClient.authorizationCodeGrant.mockResolvedValue(grantResult(claims));

      await expect(provider.handleCallback(callbackParams)).rejects.toThrow();
    });
  });
});
