import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { sha256Hex } from '../../../common/utils/crypto';
import { AuthSharedService } from '../services/auth-shared.service';
import {
  OAUTH_DEFAULT_RETURN_TO,
  OAUTH_LINK_RETURN_TO,
  OAUTH_STATE_TTL_SECONDS,
  getOAuthFlowCookieName,
  oauthStateKey,
} from './oauth.constants';

/** Which flavor of flow the callback should complete (SPEC sections 7 vs 8). */
export type OAuthIntent = 'login' | 'link';

/**
 * The pending-flow record stored under `oauth:state:<sha256(state)>`. Nothing
 * in it is a bearer secret on its own: the PKCE verifier is useless without
 * the matching authorization code, and the browser-bind HASH cannot be turned
 * back into the cookie value it verifies.
 */
export interface IOAuthFlowState {
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  intent: OAuthIntent;
  browserBindHash: string;
  /** Link intent only: the session user that started the flow, pinned at start. */
  userId?: string | undefined;
}

/**
 * Zod-validated on read like every other Redis blob in the auth stack: a
 * corrupt record reads as "no pending flow" and the callback fails closed.
 */
const flowStateSchema = z.object({
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
  returnTo: z.string().min(1),
  intent: z.enum(['login', 'link']),
  browserBindHash: z.string().min(1),
  userId: z.string().optional(),
});

/** What `/start` needs to build the authorization redirect. */
export interface IIssuedFlow {
  state: string;
  nonce: string;
  codeChallenge: string;
}

/** Consume outcome, discriminated so the caller can audit the precise reason. */
export type OAuthFlowConsumeResult =
  | { outcome: 'ok'; flow: IOAuthFlowState }
  | { outcome: 'missing' }
  | { outcome: 'browser_mismatch' };

/**
 * Validate a caller-supplied post-login path. Accepted only
 * when it is a same-origin relative path: starts with exactly one `/` (a
 * `//host` form is scheme-relative and escapes the origin), and carries no
 * backslash (browsers normalize `\` to `/`, reopening the `//` hole) or
 * control/whitespace characters. Anything else falls back to the dashboard.
 *
 * The callback only ever redirects to `APP_URL + returnTo`, so this is the
 * whole open-redirect surface. It runs twice: when the flow is issued, and
 * again at each redirect in OAuthController, so the redirect site does not
 * depend on the Redis record having been written through `issue()`. It is
 * idempotent on a valid path.
 */
export function sanitizeReturnTo(raw: string | undefined): string {
  if (
    typeof raw === 'string' &&
    raw.startsWith('/') &&
    !raw.startsWith('//') &&
    !raw.includes('\\') &&
    // No whitespace or control characters: a real SPA path percent-encodes
    // them, and raw ones are header-splitting / parser-confusion fodder.
    ![...raw].some((ch) => ch.charCodeAt(0) <= 0x20 || ch.charCodeAt(0) === 0x7f)
  ) {
    return raw;
  }
  return OAUTH_DEFAULT_RETURN_TO;
}

/**
 * Issues and consumes the server-side pending-flow record:
 * state, nonce, PKCE verifier/challenge, and the browser-binding cookie. The
 * record is keyed by sha256(state), lives {@link OAUTH_STATE_TTL_SECONDS}, and
 * is consumed with GETDEL so it is strictly one-time: a replayed callback
 * finds nothing.
 *
 * PKCE is computed with node:crypto (43-char base64url verifier, S256
 * challenge per RFC 7636) rather than through openid-client: the design confines
 * that library to the provider classes, and S256 is just a sha256.
 */
@Injectable()
export class OAuthFlowService {
  private readonly flowCookieName: string;

  constructor(
    configService: ConfigService,
    private readonly shared: AuthSharedService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.flowCookieName = getOAuthFlowCookieName(
      configService.get<string>('NODE_ENV') === 'production',
    );
  }

  /**
   * Mint a pending flow: 32-byte state, fresh nonce, PKCE pair, and the
   * browser-bind cookie. The Redis record is written under the HASH of the
   * state so a Redis dump cannot be replayed as a state parameter, and the
   * cookie value is stored only as a hash for the same reason.
   *
   * For `intent: 'link'` the caller passes the session user id, which pins the
   * flow to that account: the callback refuses to link if a different session
   * completes it.
   */
  async issue(
    req: Request,
    res: Response,
    params: { intent: OAuthIntent; returnTo: string | undefined; userId?: string },
  ): Promise<IIssuedFlow> {
    const state = randomBytes(32).toString('hex');
    const nonce = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const browserBind = randomBytes(32).toString('hex');

    const flow: IOAuthFlowState = {
      nonce,
      codeVerifier,
      // A link flow always returns to settings; only a login flow carries a
      // caller-chosen (validated) path.
      returnTo: params.intent === 'link' ? OAUTH_LINK_RETURN_TO : sanitizeReturnTo(params.returnTo),
      intent: params.intent,
      browserBindHash: sha256Hex(browserBind),
    };
    if (params.userId !== undefined) {
      flow.userId = params.userId;
    }

    await this.redis.setex(
      oauthStateKey(sha256Hex(state)),
      OAUTH_STATE_TTL_SECONDS,
      JSON.stringify(flow),
    );
    // Same hardened cookie path as the session/2FA cookies (httpOnly, Secure
    // in prod, per-origin SameSite resolving to Lax for the browser SPA).
    this.shared.setAuthCookie(
      req,
      res,
      this.flowCookieName,
      browserBind,
      OAUTH_STATE_TTL_SECONDS * 1000,
    );

    return { state, nonce, codeChallenge };
  }

  /**
   * One-time consume (GETDEL) plus the browser-bind check against this
   * service's own cookie. The record is destroyed on FIRST touch regardless of
   * the cookie outcome: a callback that fails the bind check must also burn
   * the state, or the record would stay alive for an attacker retrying the
   * same state with different cookies.
   */
  async consume(state: string, req: Request): Promise<OAuthFlowConsumeResult> {
    const raw = await this.redis.getdel(oauthStateKey(sha256Hex(state)));
    if (!raw) {
      return { outcome: 'missing' };
    }
    const flow = this.parse(raw);
    if (!flow) {
      return { outcome: 'missing' };
    }
    const bindCookieValue = req.cookies?.[this.flowCookieName] as string | undefined;
    if (bindCookieValue === undefined || sha256Hex(bindCookieValue) !== flow.browserBindHash) {
      return { outcome: 'browser_mismatch' };
    }
    return { outcome: 'ok', flow };
  }

  /** Clear the browser-bind cookie; the callback calls this on every path. */
  clearFlowCookie(res: Response): void {
    this.shared.clearAuthCookie(res, this.flowCookieName);
  }

  private parse(raw: string): IOAuthFlowState | null {
    try {
      return flowStateSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}
