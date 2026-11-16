import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TRPCMiddleware, MiddlewareOptions, MiddlewareResponse } from 'nestjs-trpc';
import { AppErrorCode } from '@repo/shared/errors';
import { SessionService } from '../services/session.service';
import type { IAppContextType } from '../../../trpc/trpc.context';
import { requestContext } from '../../../common/context/request-context';
import { UnauthorizedError } from '../../../common/errors';
import { getSessionCookieName } from '../auth.constants';
import { createAppLogger } from '../../logger/logger.service';
import { InvariantError } from '../../../common/errors/invariant-error';

const logger = createAppLogger('AuthMiddleware');

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
  /** Resolved once: '__Host-session_id' in production, 'session_id' otherwise. */
  private readonly sessionCookieName: string;

  constructor(
    private readonly sessionService: SessionService,
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

    // Populate userId in ALS so AuditService and the structured logger see the
    // caller without having to drill it through tRPC ctx everywhere.
    //
    // A missing store is a WIRING defect, not a runtime condition, so it throws
    // rather than skipping. Skipping is unsafe precisely because it is quiet:
    // the write vanishes, and the only downstream signal is audit rows with no
    // actor, far from the scope that was never opened.
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
      },
    });
  }
}
