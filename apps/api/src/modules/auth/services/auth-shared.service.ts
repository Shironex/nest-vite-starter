import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { DESKTOP_APP_ORIGIN } from '@repo/shared/constants';
import { AppErrorCode } from '@repo/shared/errors';
import { ForbiddenError } from '../../../common/errors';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { enforceFixedWindowLimit } from '../../../common/redis/rate-limit';
import { CsrfService } from '../../../common/security/csrf.service';
import { nowMs } from '../../../common/clock';
import { getSessionCookieName } from '../auth.constants';
import { EventsService } from '../../events/events.service';
import { SessionService } from './session.service';
import { TurnstileService } from './turnstile.service';

/** Per-IP fixed-window limits for unauthenticated auth endpoints. */
const AUTH_RATE_LIMIT = 10;
const AUTH_RATE_WINDOW_SECONDS = 60;

/** User fields establishSession needs to mint a session. */
export interface IEstablishSessionParams {
  userId: string;
  email: string;
  role: string;
  emailVerified: boolean;
  ip: string;
  userAgent: string;
  rememberMe: boolean;
  /**
   * User.tenantId is nullable on the schema (pre-tenancy/platform users have
   * none); establishSession coerces null to undefined so the optional session
   * field stays absent.
   */
  tenantId?: string | null | undefined;
  /**
   * Session-epoch fence value, captured by the flow that authenticated this
   * user BEFORE it read the state that authenticates them (see
   * `SessionService.readEpoch`). Passing it is what makes a revocation that
   * lands mid-login win the race: without it the fence only covers the Redis
   * write, and a login that verified an already-changed password could still
   * mint a session that survives.
   *
   * Every flow that verifies a stored credential MUST capture and pass it.
   * Omit it only where there is no earlier read to fence: registration (the
   * account did not exist yet) and password change (which revokes first and
   * then re-issues, so the current counter is the correct one).
   */
  epoch?: number | undefined;
}

/**
 * Shared helpers used across the per-flow auth services
 * (RegisterService, LoginService, EmailVerificationService, PasswordResetService,
 * PasswordChangeService). Centralizes session-cookie shape, session
 * establishment, Turnstile validation, the public app URL, and per-IP rate
 * limiting so each flow service stays focused on its domain logic.
 */
@Injectable()
export class AuthSharedService {
  readonly appUrl: string;
  private readonly isProduction: boolean;
  private readonly sessionCookieName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly turnstileService: TurnstileService,
    private readonly sessionService: SessionService,
    private readonly csrfService: CsrfService,
    private readonly eventsService: EventsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.appUrl = this.configService.getOrThrow<string>('APP_URL');
    this.isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    this.sessionCookieName = getSessionCookieName(this.isProduction);
  }

  /**
   * Create a session, set the session cookie, and rotate the CSRF token in one
   * step. This is the single session-establishment path for login, register,
   * and password change; the CSRF rotation is mandatory because a token issued
   * before the auth state change (tied to the pre-session sid) remaining valid
   * afterwards is a session-fixation hole.
   *
   * Throws SESSION_EXPIRED (from `createSession`) when a revocation for this
   * user landed between the caller's epoch capture and the mint; the cookie and
   * CSRF rotation below are then never reached, so a revoked login leaves no
   * trace of a session on the client.
   *
   * Also the place a max-sessions eviction's sockets are closed. The mint
   * reports which sessions it evicted but cannot drop their sockets itself
   * (SessionService -> EventsService would be a module cycle; see
   * `enforceMaxSessions`), and an evicted session whose socket stays open keeps
   * receiving tenant notifications until it happens to reconnect. AuthModule
   * already imports EventsModule, so this is the nearest caller that can.
   */
  async establishSession(
    req: Request,
    res: Response,
    params: IEstablishSessionParams,
  ): Promise<{ token: string; expiresAt: Date }> {
    const { tenantId, ...rest } = params;
    const session = await this.sessionService.createSession({
      ...rest,
      tenantId: tenantId ?? undefined,
    });

    for (const evictedSessionId of session.evictedSessionIds) {
      this.eventsService.disconnectSession(evictedSessionId);
    }

    const maxAge = session.expiresAt.getTime() - nowMs();
    this.setSessionCookie(req, res, session.token, maxAge);
    this.csrfService.rotate(req, res);

    return { token: session.token, expiresAt: session.expiresAt };
  }

  /**
   * Production SameSite depends on which client is asking. The packaged
   * Electron renderer calls from the cross-site app:// origin, so its session
   * cookie must be SameSite=None to ride along at all. The web SPA is
   * same-origin behind the platform router and gets the stricter 'lax', which
   * removes the cookie from cross-site POSTs entirely (CSRF defense in depth
   * on top of the double-submit token). Dev is always 'lax': both clients talk
   * to plain-http localhost, where 'none' would require `secure`.
   */
  private resolveSameSite(req: Request): 'none' | 'lax' {
    if (!this.isProduction) {
      return 'lax';
    }
    return req.headers.origin === DESKTOP_APP_ORIGIN ? 'none' : 'lax';
  }

  // The production cookie options below satisfy every `__Host-` requirement:
  // secure: true, path: '/', and no `domain` attribute. clearSessionCookie
  // mirrors the name + path so the clear targets the same cookie the set wrote.
  setSessionCookie(req: Request, res: Response, token: string, maxAge: number): void {
    res.cookie(this.sessionCookieName, token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: this.resolveSameSite(req),
      path: '/',
      maxAge,
    });
  }

  clearSessionCookie(res: Response): void {
    // Cookie deletion matches on name + path only, so the clear does not need
    // to mirror the per-origin SameSite the set used; it stays deterministic
    // (env-based, request-independent). Production keeps 'none' because a
    // Lax/Strict Set-Cookie is dropped in cross-site responses, which would
    // leave the desktop (app:// origin) unable to clear its cookie on logout.
    res.cookie(this.sessionCookieName, '', {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: this.isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: 0,
    });
  }

  /**
   * Set an arbitrary httpOnly auth cookie with the SAME hardened options as the
   * session cookie (Secure in prod, per-origin SameSite via resolveSameSite,
   * Path=/). Used for the 2FA pending (`__Host-2fa`) and trusted-device
   * (`__Host-2fa-trust`) cookies so their name is passed in but every security
   * attribute stays in this one place. `name` is a caller-controlled constant
   * (never user input).
   */
  setAuthCookie(req: Request, res: Response, name: string, value: string, maxAge: number): void {
    res.cookie(name, value, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: this.resolveSameSite(req),
      path: '/',
      maxAge,
    });
  }

  /** Clear an auth cookie set by setAuthCookie (mirrors clearSessionCookie). */
  clearAuthCookie(res: Response, name: string): void {
    res.cookie(name, '', {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: this.isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: 0,
    });
  }

  async validateTurnstile(token: string, ip?: string): Promise<void> {
    const valid = await this.turnstileService.validate(token, ip);
    if (!valid) {
      throw new ForbiddenError(AppErrorCode.TURNSTILE_FAILED);
    }
  }

  /**
   * Fixed-window per-IP rate limit for unauthenticated auth endpoints
   * (login / register / forgot-password). Account lockout is per-account, so
   * this is the layer that blunts credential stuffing and reset-email bombing
   * from a single source rotating addresses. Shared across replicas via Redis.
   */
  async enforceAuthRateLimit(action: string, ip: string): Promise<void> {
    await this.enforceRateLimit(`${action}:${ip}`, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS);
  }

  /**
   * Generic Redis fixed-window limiter: at most `limit` hits per
   * `windowSeconds` for the given scope. The implementation lives in
   * common/redis/rate-limit.ts so modules outside the auth graph (e.g.
   * data-export) can enforce limits without importing AuthModule.
   */
  async enforceRateLimit(scope: string, limit: number, windowSeconds: number): Promise<void> {
    await enforceFixedWindowLimit(this.redis, scope, limit, windowSeconds);
  }
}
