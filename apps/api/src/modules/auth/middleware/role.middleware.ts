import { Injectable } from '@nestjs/common';
import { TRPCMiddleware, MiddlewareOptions, MiddlewareResponse } from 'nestjs-trpc';
import { ROLES } from '@repo/shared/permissions';
import type { IAppContextType } from '../../../trpc/trpc.context';
import { ForbiddenError } from '../../../common/errors';
import { AppErrorCode } from '@repo/shared/errors';

/**
 * Middleware that requires ADMIN role.
 * Must be used after AuthMiddleware (expects ctx.user to be populated).
 */
@Injectable()
export class AdminMiddleware implements TRPCMiddleware {
  async use(opts: MiddlewareOptions): Promise<Awaited<MiddlewareResponse>> {
    const { ctx, next } = opts;
    const user = (ctx as IAppContextType).user;

    if (!user || user.role !== ROLES.ADMIN) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'Admin access required');
    }

    return next();
  }
}
