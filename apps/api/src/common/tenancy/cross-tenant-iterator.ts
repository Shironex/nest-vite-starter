import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * The one sanctioned cross-tenant read: the tenant LIST a scheduled sweep
 * needs before it can re-enter a tenant scope.
 *
 * Sweeps run from a queue or a cron, outside any request, so nothing has
 * seeded the tenant ALS, and the tenant-scope extension fails closed without
 * it. Rather than hand-writing `tenantId` into every `unscoped` where clause
 * (what two-factor-enforcement.processor.ts does, and the reason
 * `twoFactorPolicy` carries a documented `tenant-scoped-tables-require-where`
 * gap), a sweep asks this reader for the tenant LIST and then re-enters
 * `requestContext.run({ tenantId })` per tenant. Everything after that point
 * goes through the scoped client, so the extension (not reviewer discipline)
 * stays the isolation boundary.
 *
 * That is why this file is the allowlisted one and the processor is not: the
 * escape hatch is a single id projection over a table that is not tenant-scoped
 * to begin with.
 *
 * It lives in `common/` rather than beside any one sweep because the sweeps
 * that need it belong to different domains. A helper owned by one of those would make every other domain import
 * that domain just to run a cron.
 */
@Injectable()
export class CrossTenantIterator {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Every tenant id, oldest first.
   *
   * Deliberately unfiltered and unpaged: `Tenant` has no soft-delete column,
   * and the row count is the number of organizations on the deployment:
   * tens, not millions. Ordering by id keeps a sweep's tenant order stable
   * across runs, so a sweep that dies partway retries the same sequence rather
   * than reshuffling which tenants got served.
   */
  listTenantIds(): Promise<Array<{ id: string }>> {
    return this.prismaService.unscoped.tenant.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
  }
}
