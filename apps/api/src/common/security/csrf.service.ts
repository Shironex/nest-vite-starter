import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { doubleCsrf, type DoubleCsrfUtilities } from 'csrf-csrf';
import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { CSRF_HEADER } from '@repo/shared/constants';
import { redactCredentialPath } from '@repo/shared/logger';

/**
 * Encapsulates csrf-csrf double-submit configuration so the rest of the app
 * can call `protect`, `generate`, and `rotate` without knowing the library.
 *
 * Pre-session identity comes from a `__Host-csrf-sid` (or `csrf-sid` in dev)
 * cookie that is set on the first request before any session_id exists. This
 * is the value csrf-csrf hashes into the token, so without it every
 * unauthenticated user would share the same identifier and tokens would be
 * interchangeable across browsers.
 */
@Injectable()
export class CsrfService {
  private readonly logger = new Logger(CsrfService.name);
  private readonly utilities: DoubleCsrfUtilities;
  private readonly isProduction: boolean;
  private readonly sidCookieName: string;

  // Initialized in the constructor (ConfigService is available at construction),
  // so the fields are never undefined even if the service is instantiated
  // directly in a unit test without the Nest lifecycle running.
  constructor(private readonly configService: ConfigService) {
    this.isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    this.sidCookieName = this.isProduction ? '__Host-csrf-sid' : 'csrf-sid';

    const tokenCookieName = this.isProduction ? '__Host-csrf-token' : 'csrf-token';

    this.utilities = doubleCsrf({
      getSecret: () => this.configService.getOrThrow<string>('CSRF_SECRET'),
      getSessionIdentifier: (req) =>
        (req.cookies?.[this.sidCookieName] as string | undefined) ?? '',
      cookieName: tokenCookieName,
      cookieOptions: {
        // Lax like the session cookie: the web SPA is same-site with the api.
        sameSite: 'lax',
        secure: this.isProduction,
        httpOnly: true,
        path: '/',
      },
      getCsrfTokenFromRequest: (req) => {
        // A repeated header arrives as string[]; take the first value rather
        // than handing csrf-csrf an array (which silently fails validation).
        const token = req.headers[CSRF_HEADER];
        return Array.isArray(token) ? (token[0] ?? '') : (token ?? '');
      },
    });
  }

  /**
   * Middleware that ensures the pre-session sid cookie is present. Must run
   * before any csrf-csrf protection or token generation.
   */
  ensureSessionIdentifier = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.cookies?.[this.sidCookieName]) {
      const sid = randomBytes(32).toString('hex');
      // Set on req for the current request so doubleCsrf sees it on this hop.
      req.cookies = { ...req.cookies, [this.sidCookieName]: sid };
      res.cookie(this.sidCookieName, sid, {
        httpOnly: true,
        secure: this.isProduction,
        // strict prevents the sid from leaking on cross-site GETs; the actual
        // CSRF token cookie is the one that needs to ride along on POST flows.
        sameSite: 'strict',
        path: '/',
        // No maxAge → session cookie. Browser drops it on close, which forces
        // a fresh sid per browser session.
      });
    }
    next();
  };

  /**
   * Express middleware that validates the CSRF token on state-changing methods.
   * GET/HEAD/OPTIONS are passed through.
   */
  protect = (req: Request, res: Response, next: NextFunction): void => {
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
      return next();
    }
    // csrf-csrf signals an invalid token by calling next(err) with an
    // http-errors object. As a pre-router Express middleware error it does NOT
    // pass through Nest's AllExceptionsFilter (which only maps HttpException) -
    // it falls to Express's default handler and surfaces as a 500. The web
    // client's CSRF self-heal (lib/trpc.ts) only retries on a 403 whose body
    // mentions "csrf", so a 500 is unrecoverable. Translate the rejection to an
    // explicit 403 with the app's standard error envelope so the retry fires.
    // The status is pinned to 403 (not read off the error) so a future csrf-csrf
    // config change cannot drift it off the value the client keys on. The outer
    // `next` is called exactly once on success and never after the 403 response,
    // so the response is never double-sent.
    this.utilities.doubleCsrfProtection(req, res, (err?: unknown) => {
      if (err) {
        // Log method + path only, never the token or cookie value. The path goes
        // through the shared redactor: a POST route that authenticates by path
        // segment would otherwise have its still-live ticket written into the log.
        this.logger.warn('CSRF validation failed', {
          method: req.method,
          path: redactCredentialPath(req.path),
        });
        res.status(403).json({ error: { message: 'Invalid CSRF token', code: 403 } });
        return;
      }
      next();
    });
  };

  /**
   * Generate (or refresh) the CSRF token cookie + return the token value.
   * Used by GET /api/csrf-token.
   */
  generate(req: Request, res: Response): string {
    return this.utilities.generateCsrfToken(req, res);
  }

  /**
   * Force a fresh CSRF token after sensitive auth state changes (login,
   * logout, changePassword). Without this, a token issued before the auth
   * mutation remains valid afterwards, defeating the rotation we get from
   * sliding session id.
   */
  rotate(req: Request, res: Response): string {
    return this.utilities.generateCsrfToken(req, res, { overwrite: true });
  }
}
