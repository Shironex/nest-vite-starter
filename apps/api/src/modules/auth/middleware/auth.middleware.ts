import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TRPCMiddleware, MiddlewareOptions, MiddlewareResponse } from 'nestjs-trpc';
import { AppErrorCode } from '@repo/shared/errors';
import { SessionService } from '../services/session.service';
import { TwoFactorEnrollmentReader } from '../services/two-factor-enrollment.reader';
import type { IAppContextType } from '../../../trpc/trpc.context';
import { requestContext } from '../../../common/context/request-context';
import { ForbiddenError, UnauthorizedError } from '../../../common/errors';
import { getSessionCookieName } from '../auth.constants';
import { createAppLogger } from '../../logger/logger.service';
import { InvariantError } from '../../../common/errors/invariant-error';

const logger = createAppLogger('AuthMiddleware');

/**
 * Procedures a 2FA-enforced (enroll-only) session may still reach: enrolling,
 * checking status, and logging out. Everything else returns
 * TWO_FACTOR_ENROLLMENT_REQUIRED so the SPA routes to the enroll-only screen.
 * Central here (not per-procedure) so a forgotten check can never be a bypass.
 */
const TWO_FACTOR_ENROLL_ALLOWLIST = new Set<string>([
  'twoFactor.beginEnrollment',
  'twoFactor.activate',
  'twoFactor.status',
  'auth.logout',
  'auth.logoutAll',
]);

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
  /** Resolved once: '__Host-session_id' in production, 'session_id' otherwise. */
  private readonly sessionCookieName: string;

  constructor(
    private readonly sessionService: SessionService,
    private readonly enrollmentReader: TwoFactorEnrollmentReader,
    configService: ConfigService,
  ) {
    this.sessionCookieName = getSessionCookieName(
      configService.get<string>('NODE_ENV') === 'production',
    );
  }

  async use(opts: MiddlewareOptions): Promise<Awaited<MiddlewareResponse>> {
    const { ctx, next } = opts;
    const req = (ctx as IAppContextType).req;

    const sessionToken = req.cookies?.[this.sessionCookieName] as string | undefined;
    if (!sessionToken) {
      throw new UnauthorizedError(AppErrorCode.UNAUTHORIZED, 'Not authenticated');
    }

    const session = await this.sessionService.validateSession(sessionToken);
    if (!session) {
      throw new UnauthorizedError(AppErrorCode.UNAUTHORIZED, 'Invalid or expired session');
    }

    // Enforcement gate (single chokepoint): a member of a 2FA-required Organization who
    // is past grace and not yet enrolled may only reach the enroll/logout
    // allowlist; everything else is refused until they enroll. The stored flag
    // is re-verified against live state so a stale flag cannot brick the session.
    if (
      session.twoFactorEnrollmentRequired &&
      !TWO_FACTOR_ENROLL_ALLOWLIST.has(opts.path) &&
      (await this.enrollmentReader.isEnrollmentStillRequired(session.userId, session.tenantId))
    ) {
      throw new ForbiddenError(
        AppErrorCode.TWO_FACTOR_ENROLLMENT_REQUIRED,
        'Two-factor authentication setup is required',
      );
    }

    // Populate userId + tenantId in ALS so AuditService, the Prisma tenant-scope
    // extension, and the structured logger see the caller without having to drill
    // them through tRPC ctx everywhere. workspaceId is not resolved yet.
    //
    // A missing store is a WIRING defect, not a runtime condition, so it throws
    // rather than skipping. Skipping is unsafe precisely because it is quiet:
    // the write vanishes, and the only downstream signal is every tenant-scoped
    // query failing closed one layer further down, with a message that points at
    // the Prisma extension rather than at the scope that was never opened.
    const store = requestContext.getStore();
    if (!store) {
      // The diagnostic stays server-side: a plain Error's message is copied onto
      // the wire verbatim by tRPC's error shaper, and naming the middleware, the
      // registration array and the file would hand a caller the app's internals.
      logger.error('AuthMiddleware ran outside the ALS scope', {
        procedure: opts.path,
        remedy:
          'TrpcRequestContextMiddleware must be registered first in globalMiddlewares (app.module.ts).',
      });
      throw new InvariantError('Request context unavailable.');
    }
    store.userId = session.userId;
    store.tenantId = session.tenantId ?? undefined;

    return next({
      ctx: {
        ...ctx,
        user: {
          id: session.userId,
          email: session.email,
          role: session.role,
          emailVerified: session.emailVerified,
        },
        session: { id: session.sessionId, token: sessionToken },
        tenantId: session.tenantId ?? undefined,
      },
    });
  }
}
