import { Controller, Get, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { getClientIp, getUserAgent } from '../../../common/utils/request';
import { createAppLogger } from '../../logger/logger.service';
import { recordAuthOutcome } from '../../metrics/auth-outcome.recorder';
import { getSessionCookieName } from '../auth.constants';
import { AuthSharedService } from '../services/auth-shared.service';
import { SessionService, type IValidatedSession } from '../services/session.service';
import { SudoService } from '../services/sudo.service';
import { TwoFactorChallengeService } from '../services/two-factor-challenge.service';
import {
  OAUTH_CALLBACK_RATE_LIMIT,
  OAUTH_CALLBACK_RATE_SCOPE,
  OAUTH_CALLBACK_ROUTE,
  OAUTH_CONTROLLER_PATH,
  OAUTH_ERROR_CODES,
  OAUTH_PROVIDERS_ROUTE,
  OAUTH_RATE_WINDOW_SECONDS,
  OAUTH_START_RATE_LIMIT,
  OAUTH_LINKED_PARAM,
  OAUTH_START_RATE_SCOPE,
  OAUTH_START_ROUTE,
  OAUTH_TWO_FACTOR_CHALLENGE_PATH,
  buildAuthErrorRedirect,
  buildOAuthRedirectUri,
  type OAuthErrorCode,
} from './oauth.constants';
import { OAuthAccountService, type IOAuthRequestContext } from './oauth-account.service';
import { OAuthFlowService, sanitizeReturnTo, type OAuthIntent } from './oauth-flow.service';
import type { IOAuthIdentity, IOAuthProvider } from './providers/oauth-provider.interface';
import { ProviderRegistryService } from './providers/provider-registry.service';

const logger = createAppLogger('OAuth');

/**
 * Where in the flow a failure happened. Low cardinality on purpose: these are
 * Sentry tags and Loki labels.
 */
type OAuthFailureStage = 'authorize' | 'exchange' | 'session_mint';

/** One entry of the discovery payload. */
export interface IOAuthProviderSummary {
  key: string;
}

/**
 * Response of `GET /auth/oauth/providers`.
 *
 * `providers` is always present and is `[]` when none are enabled, so the SPA
 * renders from one shape and never has to distinguish "no OAuth configured"
 * from "endpoint not deployed". The key is the whole contract: label, icon and
 * every word of branding are owned by the web, which keeps enablement a runtime
 * question and copy a build-time one.
 */
export interface IOAuthProvidersResponse {
  providers: IOAuthProviderSummary[];
}

/**
 * The plain HTTP surface for OAuth. Redirect flows cannot be expressed as tRPC
 * procedures, so this follows the in-repo controller precedent
 * (common/security/csrf.controller.ts) rather than the router convention.
 *
 * Error contract: past the provider 404, EVERY failure on /start and /callback
 * is a 302 to the SPA auth screen carrying `?error=<code>`; the browser is
 * mid-navigation, so JSON would be a dead end (SPEC section 5). Failures also
 * write an `oauth.failure` audit row with the precise gate that rejected them.
 * Lockout counters are never touched here and there is no Turnstile: neither
 * endpoint is a password guess.
 *
 * Declared in AuthModule (not OAuthModule): the start/callback flow needs the
 * post-credential seam (TwoFactorChallengeService) and its collaborators,
 * which live in AuthModule's injector. OAuthModule remains the openid-client
 * confinement boundary and exports the registry this controller reads.
 */
@Controller(OAUTH_CONTROLLER_PATH)
export class OAuthController {
  private readonly apiPublicUrl: string;
  private readonly sessionCookieName: string;

  constructor(
    configService: ConfigService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly flowService: OAuthFlowService,
    private readonly accountService: OAuthAccountService,
    private readonly twoFactorChallenge: TwoFactorChallengeService,
    private readonly sessionService: SessionService,
    private readonly sudoService: SudoService,
    private readonly shared: AuthSharedService,
  ) {
    this.apiPublicUrl = configService.getOrThrow<string>('API_PUBLIC_URL');
    this.sessionCookieName = getSessionCookieName(
      configService.get<string>('NODE_ENV') === 'production',
    );
  }

  /**
   * Public and unauthenticated: the sign-in page needs it before any session
   * exists. It exposes only which providers a deployment has credentials for,
   * which the redirect endpoints reveal anyway, and does no per-request work
   * beyond reading an in-memory list, so the global 100/60s ThrottlerGuard is
   * the appropriate ceiling.
   */
  @Get(OAUTH_PROVIDERS_ROUTE)
  listProviders(): IOAuthProvidersResponse {
    return { providers: this.providerRegistry.getEnabled().map(({ key }) => ({ key })) };
  }

  /**
   * `GET /auth/oauth/:provider/start?returnTo=<path>&intent=login|link`
   * (SPEC section 5): mint the pending flow and 302 to the provider's consent
   * screen. `redirect_uri` derives from `API_PUBLIC_URL`, never the Host
   * header.
   */
  @Get(OAUTH_START_ROUTE)
  async start(
    @Param('provider') providerKey: string,
    @Query('returnTo') returnTo: string | undefined,
    @Query('intent') intentRaw: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.requireProvider(providerKey);
    const ctx = this.requestContext(req);
    const intent: OAuthIntent = intentRaw === 'link' ? 'link' : 'login';

    if (
      !(await this.enforceRedirectRateLimit(
        `${OAUTH_START_RATE_SCOPE}:${ctx.ip}`,
        OAUTH_START_RATE_LIMIT,
        provider.key,
        ctx,
        res,
      ))
    ) {
      return;
    }

    // Link intent (SPEC section 8): only a live session that recently
    // re-proved its password (the sudo flag) may START a link flow, and the
    // flow record is pinned to that user so the callback can refuse anyone
    // else. 403-shaped failures still ride the redirect contract.
    let linkUserId: string | undefined;
    if (intent === 'link') {
      const session = await this.readSession(req);
      if (session === null || !(await this.sudoService.isActive(session.sessionId))) {
        await this.accountService.auditFailure(
          { provider: provider.key },
          'link_unauthorized',
          ctx,
        );
        this.redirectError(res, OAUTH_ERROR_CODES.FAILED);
        return;
      }
      linkUserId = session.userId;
    }

    try {
      const issued = await this.flowService.issue(req, res, {
        intent,
        returnTo,
        ...(linkUserId === undefined ? {} : { userId: linkUserId }),
      });
      const url = await provider.buildAuthorizationUrl({
        redirectUri: buildOAuthRedirectUri(this.apiPublicUrl, provider.key),
        state: issued.state,
        nonce: issued.nonce,
        codeChallenge: issued.codeChallenge,
      });
      res.redirect(302, url.toString());
    } catch (error: unknown) {
      // Discovery/Redis outage. The error object is still not logged: openid-
      // client errors can embed the full authorization URL (state included).
      // reportFailure emits only the shape of the failure, so an outage is
      // visible in Loki and Sentry instead of being an audit row nobody reads.
      this.reportFailure('authorize', provider.key, error);
      await this.accountService.auditFailure({ provider: provider.key }, 'exception', ctx);
      this.redirectError(res, OAUTH_ERROR_CODES.FAILED);
    }
  }

  /**
   * `GET /auth/oauth/:provider/callback?code&state` (SPEC sections 5-7): burn
   * the state, verify the browser bind, exchange the code (openid-client
   * verifies issuer/audience/expiry/signature/nonce), resolve the account, and
   * hand the user to the 2FA seam. The callback NEVER establishes a session
   * itself: `beginOrEstablish` is the only door.
   */
  @Get(OAUTH_CALLBACK_ROUTE)
  async callback(
    @Param('provider') providerKey: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.requireProvider(providerKey);
    const ctx = this.requestContext(req);

    if (
      !(await this.enforceRedirectRateLimit(
        `${OAUTH_CALLBACK_RATE_SCOPE}:${ctx.ip}`,
        OAUTH_CALLBACK_RATE_LIMIT,
        provider.key,
        ctx,
        res,
      ))
    ) {
      return;
    }

    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (state === undefined) {
      this.flowService.clearFlowCookie(res);
      await this.accountService.auditFailure({ provider: provider.key }, 'state_missing', ctx);
      this.recordCallbackOutcome('state_missing', 'refusal');
      this.redirectError(res, OAUTH_ERROR_CODES.STATE_EXPIRED);
      return;
    }

    // One-time consume FIRST, even when the provider sent an error param: the
    // state is burned on first touch whatever else the callback carries.
    const consumed = await this.flowService.consume(state, req);
    this.flowService.clearFlowCookie(res);
    if (consumed.outcome !== 'ok') {
      await this.accountService.auditFailure({ provider: provider.key }, consumed.outcome, ctx);
      this.recordCallbackOutcome(consumed.outcome, 'refusal');
      this.redirectError(res, OAUTH_ERROR_CODES.STATE_EXPIRED);
      return;
    }
    const flow = consumed.flow;

    // The user said no at the consent screen (or the provider errored). The
    // error param value is provider diagnostics, not a secret, but the wire
    // code stays generic.
    if (typeof req.query.error === 'string') {
      await this.accountService.auditFailure({ provider: provider.key }, 'provider_denied', ctx);
      this.recordCallbackOutcome('provider_denied', 'refusal');
      this.redirectError(res, OAUTH_ERROR_CODES.FAILED);
      return;
    }

    let identity: IOAuthIdentity;
    try {
      identity = await provider.handleCallback({
        // Rebuilt from API_PUBLIC_URL, never from the Host header: openid-client
        // derives the token request's redirect_uri from this URL.
        currentUrl: new URL(req.originalUrl, this.apiPublicUrl),
        redirectUri: buildOAuthRedirectUri(this.apiPublicUrl, provider.key),
        expectedState: state,
        expectedNonce: flow.nonce,
        codeVerifier: flow.codeVerifier,
      });
    } catch (error: unknown) {
      // Bad code, bad signature, wrong nonce, provider outage: one bucket on
      // the wire (indistinguishable to the caller), one audit reason.
      // The error object is still not logged: token-endpoint failures can embed
      // the request that carried the code. Only its shape is reported.
      this.reportFailure('exchange', provider.key, error);
      await this.accountService.auditFailure({ provider: provider.key }, 'exchange_failed', ctx);
      this.recordCallbackOutcome('exchange_failed', 'refusal');
      this.redirectError(res, OAUTH_ERROR_CODES.FAILED);
      return;
    }

    if (flow.intent === 'link') {
      // Link completion (SPEC section 8): the CURRENT session must exist and
      // match the user the flow was pinned to at /start; the identity checks
      // live in completeLink. NO session is minted on this path: the session
      // that started the flow is the one that finishes it, so the seam is not
      // involved and rememberMe never comes into play.
      const session = await this.readSession(req);
      if (session === null) {
        await this.accountService.auditFailure(identity, 'link_no_session', ctx);
        this.recordCallbackOutcome('link_no_session', 'refusal');
        this.redirectError(res, OAUTH_ERROR_CODES.FAILED);
        return;
      }
      const linked = await this.accountService.completeLink(
        identity,
        flow.userId,
        session.userId,
        ctx,
      );
      if (linked.outcome === 'rejected') {
        this.recordCallbackOutcome(`link_${linked.errorCode}`, 'refusal', session.userId);
        this.redirectError(res, linked.errorCode);
        return;
      }
      this.recordCallbackOutcome('link_ok', 'success', session.userId);
      res.redirect(
        302,
        `${this.shared.appUrl}${sanitizeReturnTo(flow.returnTo)}?${OAUTH_LINKED_PARAM}=${provider.key}`,
      );
      return;
    }

    const resolution = await this.accountService.resolveLogin(identity, ctx);
    if (resolution.outcome === 'rejected') {
      this.recordCallbackOutcome(resolution.errorCode, 'refusal');
      this.redirectError(res, resolution.errorCode);
      return;
    }

    try {
      const outcome = await this.twoFactorChallenge.beginOrEstablish(req, res, resolution.user, {
        // OAuth logins never extend to the remember-me TTL (2FA T09 point 3,
        // security checklist item 17).
        rememberMe: false,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        // Captured by the resolution at its credential read (the link row /
        // the email-matched user row), so the fence covers the whole
        // resolution, not just the Redis mint.
        epoch: resolution.epoch,
      });
      if (outcome.kind === 'challenge') {
        this.recordCallbackOutcome('twofa_required', 'success', resolution.user.id);
        res.redirect(302, `${this.shared.appUrl}${OAUTH_TWO_FACTOR_CHALLENGE_PATH}`);
        return;
      }
      this.recordCallbackOutcome('login_ok', 'success', resolution.user.id);
      res.redirect(302, `${this.shared.appUrl}${sanitizeReturnTo(flow.returnTo)}`);
    } catch (error: unknown) {
      // createSession refused the mint: a revocation for this user landed
      // between the resolution's epoch capture and the write (the fence
      // working as designed), or Redis failed. No session cookie was set.
      // Those two are indistinguishable in the audit row, which is exactly why
      // the failure shape has to reach Loki and Sentry.
      this.reportFailure('session_mint', provider.key, error);
      await this.accountService.auditFailure(identity, 'session_mint_failed', ctx);
      this.recordCallbackOutcome('session_mint_failed', 'refusal', resolution.user.id);
      this.redirectError(res, OAUTH_ERROR_CODES.FAILED);
    }
  }

  /**
   * The only thing this controller may say about an OAuth error object.
   *
   * openid-client embeds the request it was making (authorization URL with the
   * state, or the token request carrying the code) in its error messages, and
   * an http error's `cause` can carry request headers, so neither the message
   * nor the error itself may be logged or captured. The constructor name plus a
   * string `code` is enough to tell a provider outage from a bad secret from a
   * Redis failure, and neither can hold a credential.
   *
   * `captureMessage`, not `captureException`, for the same reason: an exception
   * would ship the whole error with its message and stack.
   */
  private reportFailure(stage: OAuthFailureStage, providerKey: string, error: unknown): void {
    const name = error instanceof Error ? error.constructor.name : typeof error;
    const rawCode = (error as { code?: unknown } | null | undefined)?.code;
    const details = {
      op: `oauth.${stage}`,
      provider: providerKey,
      error: name,
      ...(typeof rawCode === 'string' ? { code: rawCode } : {}),
    };

    logger.warn('OAuth flow failed', details);
    Sentry.captureMessage('OAuth flow failed', {
      level: 'warning',
      tags: { op: details.op, provider: providerKey, error: name },
      extra: details,
    });
  }

  /**
   * The OAuth flow's counterpart to login's outcome counter. `provider` is
   * deliberately NOT a label: the flow label already says these are OAuth, and
   * the provider is on the failure log line and in the audit row.
   */
  private recordCallbackOutcome(
    outcome: string,
    kind: 'success' | 'refusal',
    userId?: string,
  ): void {
    recordAuthOutcome({ flow: 'oauth_callback', outcome, kind, userId });
  }

  /** Unknown or env-disabled provider keys 404 before any redirect is built. */
  private requireProvider(providerKey: string): IOAuthProvider {
    const provider = this.providerRegistry.get(providerKey);
    if (!provider) {
      throw new NotFoundException();
    }
    return provider;
  }

  private requestContext(req: Request): IOAuthRequestContext {
    return { ip: getClientIp(req), userAgent: getUserAgent(req) };
  }

  /** The current session, validated exactly as AuthMiddleware would (epoch fence included). */
  private async readSession(req: Request): Promise<IValidatedSession | null> {
    const token = req.cookies?.[this.sessionCookieName] as string | undefined;
    if (!token) {
      return null;
    }
    return this.sessionService.validateSession(token);
  }

  /**
   * Named per-IP fixed window. Returns false (after auditing
   * and redirecting) when the request is over budget or the limiter itself is
   * unreachable: this surface fails closed into the redirect contract, never
   * into a JSON 429/500 mid-navigation.
   */
  private async enforceRedirectRateLimit(
    scope: string,
    limit: number,
    providerKey: string,
    ctx: IOAuthRequestContext,
    res: Response,
  ): Promise<boolean> {
    try {
      await this.shared.enforceRateLimit(scope, limit, OAUTH_RATE_WINDOW_SECONDS);
      return true;
    } catch {
      await this.accountService.auditFailure({ provider: providerKey }, 'rate_limited', ctx);
      this.recordCallbackOutcome('rate_limited', 'refusal');
      this.redirectError(res, OAUTH_ERROR_CODES.FAILED);
      return false;
    }
  }

  private redirectError(res: Response, code: OAuthErrorCode): void {
    res.redirect(302, buildAuthErrorRedirect(this.shared.appUrl, code));
  }
}
