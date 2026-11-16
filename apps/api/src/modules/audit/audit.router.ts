import { Router, Query, Input, UseMiddlewares } from 'nestjs-trpc';
import type { z } from 'zod';
import { auditLogListInput, auditLogListOutput } from '@repo/shared/schemas';
import { AuthMiddleware } from '../auth/middleware/auth.middleware';
import { AdminMiddleware } from '../auth/middleware/role.middleware';
import { AuditReadService } from './audit-read.service';

/**
 * Read-only surface over the append-only audit trail. ADMIN-only as the safe
 * default: the feed exposes other users' actions, failed logins and IP
 * addresses, which is inspection material, not everyday data. Widening it
 * later is removing AdminMiddleware here plus the role gate on the nav entry
 * and route; there is deliberately no write or delete procedure to widen.
 */
@Router({ alias: 'audit' })
@UseMiddlewares(AuthMiddleware)
export class AuditRouter {
  constructor(private readonly auditReadService: AuditReadService) {}

  /**
   * One keyset page of the audit history, newest first (admin only). No
   * filters, no search and no export: the admin list is a plain feed.
   */
  @Query({ input: auditLogListInput, output: auditLogListOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async list(@Input() input: z.infer<typeof auditLogListInput>) {
    return this.auditReadService.list(input);
  }
}
