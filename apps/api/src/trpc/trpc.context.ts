import { Injectable } from '@nestjs/common';
import { TRPCContext, ContextOptions } from 'nestjs-trpc';
import type { Request, Response } from 'express';

export interface IAppContextType {
  [key: string]: unknown;
  req: Request;
  res: Response;
  user: {
    id: string;
    email: string;
    role: string;
    emailVerified: boolean;
  } | null;
  session: { id: string; token: string } | null;
  /**
   * Active Tenant (organization) id, mirrored from the ALS request context. Populated
   * by AuthMiddleware/login (owned by a sibling step); the Prisma tenant-scope
   * extension reads tenantId from the ALS, not from here.
   */
  tenantId?: string;
}

/**
 * Context as seen by procedures guarded with `@UseMiddlewares(AuthMiddleware)`:
 * `user` and `session` are guaranteed populated by the middleware. Annotate
 * protected procedures with this type instead of reaching for `ctx.user!`:
 * the non-null assertion silently hides the hole if a dev forgets the guard.
 */
export interface IAuthenticatedContextType extends IAppContextType {
  user: NonNullable<IAppContextType['user']>;
  session: NonNullable<IAppContextType['session']>;
}

@Injectable()
export class AppContext implements TRPCContext {
  async create(opts: ContextOptions): Promise<IAppContextType> {
    const { req, res } = opts as { req: Request; res: Response };
    return { req, res, user: null, session: null };
  }
}
