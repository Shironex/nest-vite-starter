import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  OPENID_CLIENT,
  type IOAuthIdentity,
  type IOAuthProvider,
  type IOpenIdClient,
  type IOpenIdConfiguration,
} from './oauth-provider.interface';
import { InvariantError } from '../../../../common/errors/invariant-error';

export const GOOGLE_PROVIDER_KEY = 'google';

/**
 * Google's issuer identifier, not its discovery document URL. Passing the
 * issuer keeps openid-client's issuer validation on; passing the document URL
 * directly would disable it.
 */
const GOOGLE_ISSUER = 'https://accounts.google.com';

/**
 * `openid` for the ID token, `email` + `profile` for the claims the account
 * resolution and provisioning need. No offline access: v1 stores no tokens, so
 * asking for a refresh token would only widen the blast radius.
 */
const GOOGLE_SCOPES = 'openid email profile';

/**
 * The ID-token claims this provider consumes, validated rather than trusted:
 * `claims()` is typed as an open JWT claim set, so every field is `unknown`
 * shaped until it clears this schema.
 *
 * `email_verified` accepts the string forms too. The claim is a boolean in
 * Google's current ID tokens, but the OIDC spec has historically been read both
 * ways by IdPs and a string `"false"` coerced by truthiness would silently turn
 * an unverified address into a trusted one.
 */
const googleClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  name: z.string().min(1).optional(),
  picture: z.url().optional(),
});

/**
 * Google as an OIDC provider.
 *
 * Nothing here reaches the network until a flow actually runs: discovery is
 * lazy and memoized on the instance, so the API boots (and every spec compiles
 * the DI graph) with no egress. The library itself is injected via
 * {@link OPENID_CLIENT}, which is what lets the spec assert the exact arguments
 * handed to it.
 */
@Injectable()
export class GoogleProvider implements IOAuthProvider {
  readonly key = GOOGLE_PROVIDER_KEY;
  readonly isEnabled: boolean;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private discovery: Promise<IOpenIdConfiguration> | undefined;

  constructor(
    configService: ConfigService,
    @Inject(OPENID_CLIENT) private readonly openIdClient: IOpenIdClient,
  ) {
    // ConfigService falls back to the raw process.env entry, so an unset key
    // arrives as the empty string from a `KEY=` line rather than as undefined.
    // Both spellings mean "not configured"; the Joi schema has already
    // rejected a half-configured pair by this point.
    this.clientId = (configService.get<string>('OAUTH_GOOGLE_CLIENT_ID') ?? '').trim();
    this.clientSecret = (configService.get<string>('OAUTH_GOOGLE_CLIENT_SECRET') ?? '').trim();
    this.isEnabled = this.clientId !== '' && this.clientSecret !== '';
  }

  async buildAuthorizationUrl(params: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<URL> {
    const config = await this.discover();
    return this.openIdClient.buildAuthorizationUrl(config, {
      redirect_uri: params.redirectUri,
      scope: GOOGLE_SCOPES,
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    });
  }

  async handleCallback(params: {
    currentUrl: URL;
    redirectUri: string;
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
  }): Promise<IOAuthIdentity> {
    // openid-client derives the token request's `redirect_uri` by stripping the
    // query off `currentUrl`, so a caller that rebuilt the callback URL from the
    // request Host would silently send a Host-derived redirect_uri and defeat
    // the fixed-redirect_uri rule. Assert the two agree instead of trusting the caller.
    const derivedRedirectUri = `${params.currentUrl.origin}${params.currentUrl.pathname}`;
    if (derivedRedirectUri !== params.redirectUri) {
      throw new InvariantError('OAuth callback URL does not match the configured redirect_uri');
    }

    const tokens = await this.openIdClient.authorizationCodeGrant(
      await this.discover(),
      params.currentUrl,
      {
        expectedState: params.expectedState,
        expectedNonce: params.expectedNonce,
        pkceCodeVerifier: params.codeVerifier,
        idTokenExpected: true,
      },
    );

    const claims = googleClaimsSchema.parse(tokens.claims());
    return {
      provider: this.key,
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      ...(claims.name === undefined ? {} : { displayName: claims.name }),
      ...(claims.picture === undefined ? {} : { avatarUrl: claims.picture }),
    };
  }

  /**
   * Discovery runs once per process and its result caches the IdP's JWKS. A
   * failed attempt is NOT retained: leaving a rejected promise in the field
   * would turn one Google outage during boot into a permanently broken button.
   */
  private discover(): Promise<IOpenIdConfiguration> {
    if (!this.isEnabled) {
      throw new InvariantError('Google OAuth is not configured');
    }
    this.discovery ??= this.openIdClient
      .discovery(new URL(GOOGLE_ISSUER), this.clientId, this.clientSecret)
      .catch((error: unknown) => {
        this.discovery = undefined;
        throw error;
      });
    return this.discovery;
  }
}
