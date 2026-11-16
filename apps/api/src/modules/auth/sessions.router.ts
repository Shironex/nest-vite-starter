import { Router, Query, Mutation, Input, Ctx, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { activeSessionsOutput, authAckOutput, revokeSessionSchema } from '@repo/shared/schemas';
import { getClientIp, getUserAgent } from '../../common/utils/request';
import type { IAuthenticatedContextType } from '../../trpc/trpc.context';
import { AuthMiddleware } from './middleware/auth.middleware';
import { SessionManagementService } from './services/session-management.service';

/**
 * The self-service active-sessions tRPC surface: where am I signed in, sign
 * that device out, sign everything else out. Every procedure is scoped to the
 * caller's own session: there is no way to name another user, and admin-side
 * session management deliberately does not live here.
 *
 * A separate router (rather than more of AuthRouter) because these three
 * procedures share one service and one concern; AuthRouter keeps the
 * credential flows.
 */
@Router({ alias: 'sessions' })
export class SessionsRouter {
  constructor(private readonly sessionManagement: SessionManagementService) {}

  /**
   * The caller's active sessions, current first. Rows carry an opaque handle
   * for `revoke`, never the server-side session id.
   */
  @Query({ output: activeSessionsOutput })
  @UseMiddlewares(AuthMiddleware)
  async list(@Ctx() ctx: IAuthenticatedContextType) {
    return this.sessionManagement.listSessions(ctx.user.id, ctx.session.id);
  }

  /**
   * Sign out ONE of the caller's sessions by its `list` handle. Idempotent
   * ack: a handle that no longer resolves is already signed out. Revoking the
   * session this request rides on is allowed (the UI offers logout instead,
   * but the outcome (this device is signed out) is exactly what was asked).
   */
  @Mutation({ input: revokeSessionSchema, output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async revoke(
    @Input() input: z.infer<typeof revokeSessionSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    await this.sessionManagement.revokeSession(ctx.user.id, input.sessionId, {
      ip: getClientIp(ctx.req),
      userAgent: getUserAgent(ctx.req),
    });
    return { success: true as const };
  }

  /**
   * Sign out every OTHER session and keep this one: the one epoch-bumping
   * revocation path plus an immediate re-issue for the caller (the password-
   * change pattern).
   */
  @Mutation({ output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async revokeOthers(@Ctx() ctx: IAuthenticatedContextType) {
    await this.sessionManagement.revokeOtherSessions(
      ctx.session.token,
      getClientIp(ctx.req),
      getUserAgent(ctx.req),
      ctx.req,
      ctx.res,
    );
    return { success: true as const };
  }
}
