import { Router, Query, Ctx, UseMiddlewares } from 'nestjs-trpc';
import { userDataExportOutput } from '@repo/shared/schemas';
import { AuthMiddleware } from '../auth/middleware/auth.middleware';
import type { IAuthenticatedContextType } from '../../trpc/trpc.context';
import { DataExportService } from './data-export.service';

/**
 * Data-export router. PATTERN SKELETON for the GDPR data-portability surface.
 *
 * Class-level `@UseMiddlewares(AuthMiddleware)` so the one procedure is
 * auth-gated, and it operates strictly on `ctx.user.id` (guaranteed non-null by
 * the middleware via IAuthenticatedContextType). No id is read from request
 * input, so there is no IDOR surface, a user can only export their own data.
 *
 * The response is output-schema-stripped (`output: userDataExportOutput`). The
 * access event is audited (metadata only, never the payload) in the service. A
 * product fork extends the service and the output schema with its own domain
 * sections; the auth-gated, owner-scoped, stripped shape stays the same.
 */
@Router({ alias: 'dataExport' })
@UseMiddlewares(AuthMiddleware)
export class DataExportRouter {
  constructor(private readonly dataExportService: DataExportService) {}

  /**
   * `dataExport.download`, assemble and return the caller's own data export.
   * A query (pure read); the SPA fetches it on demand and turns the JSON into a
   * downloaded file. Rate limited per user inside the service via the shared
   * fixed-window primitive (common/redis/rate-limit.ts): the global
   * ThrottlerGuard does not cover tRPC procedures, and the primitive needs
   * only the global REDIS_CLIENT, so the cycle-breaker pattern (no AuthModule
   * import) is preserved.
   */
  @Query({ output: userDataExportOutput })
  async download(@Ctx() ctx: IAuthenticatedContextType) {
    return this.dataExportService.exportForUser(ctx.user.id);
  }
}
