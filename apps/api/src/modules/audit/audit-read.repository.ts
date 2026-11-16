import { Injectable } from '@nestjs/common';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import type { AuditLogItem } from '@repo/shared/schemas';
import { BaseRepository } from '../../common/database/base.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { idCursorArgs, pageByIdCursor } from '../../common/utils/cursor-page';

export interface IAuditLogListParams {
  readonly actorId?: string | undefined;
  readonly actions?: readonly string[] | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface IAuditLogListPage {
  items: AuditLogItem[];
  nextCursor: string | null;
}

/**
 * The wire projection. `before`/`after`/`metadata` ride along verbatim (they
 * are what the screen exists to show); the credential-ish columns the row does
 * NOT carry (there are none) make an allowlist cheap insurance against future
 * additions.
 */
const LIST_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  before: true,
  after: true,
  metadata: true,
  reason: true,
  ipAddress: true,
  userAgent: true,
  correlationId: true,
  success: true,
  createdAt: true,
  user: { select: { id: true, email: true, displayName: true } },
} as const;

@Injectable()
export class AuditReadRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * List one keyset page of the tenant's audit trail, newest first.
   *
   * Tenant containment is EXPLICIT here: `AuditLog` is deliberately absent
   * from TENANT_SCOPED_MODELS (tenant-scope.extension.ts), because audit rows
   * are written pre-auth and from system context where the fail-closed
   * extension would throw. That makes this `where` the isolation boundary for
   * the read surface, exactly as UserRepository.listUsers is for users.
   * `tenantId` is non-optional on purpose: an `undefined` would be dropped
   * from the Prisma where-clause and leak every organization's history. The caller
   * (service) must resolve and assert a concrete tenant from the ALS.
   *
   * A row is visible to the tenant when either:
   *   1. it carries the tenant's own `tenantId` (in-context writes), or
   *   2. its `tenantId` is null AND its actor belongs to the tenant.
   *
   * Arm 1 is deliberately first in meaning as well as in order: a row that
   * carries a tenant is attributed to THAT tenant and never to the actor's
   * current one, so an account moved between organizations (the staff-invite collision
   * path) leaves its history behind. Arm 2 is the fallback, and the auth flows
   * now shrink it: login success/failure, lockout, 2FA challenges and the
   * password-reset rows run before AuthMiddleware seeds the ALS, so they used
   * to be written `tenantId: null` even though the user row was in hand, and
   * arm 2 then carried a whole organization's worth of login history across a move.
   * Those writes stamp `tenantId` explicitly now (login.service.ts,
   * two-factor-challenge.service.ts, password-reset.service.ts), leaving arm 2
   * for legacy rows and for writes that genuinely have no user in hand.
   *
   * Rows with NEITHER (unknown-email login failures, system crons outside any
   * tenant) belong to no organization and are visible to none; they remain
   * operator-only, which is the correct fail-closed reading.
   *
   * Pagination: keyset on the unique `id` (Prisma `cursor` + `skip: 1`),
   * ordered `createdAt desc, id desc`. The id tiebreaker keeps the cursor
   * exact when two rows share a createdAt. Fetches `limit + 1` rows so the
   * presence of a next page is known without a COUNT.
   */
  async listPage(tenantId: string, params: IAuditLogListParams): Promise<IAuditLogListPage> {
    const { actorId, actions, from, to, cursor, limit } = params;

    // Every filter is ANDed alongside the visibility clause (spelled at the
    // findMany below), so none can collide with (or widen) that visibility OR.
    const clauses: Prisma.AuditLogWhereInput[] = [];
    if (actorId !== undefined) {
      clauses.push({ userId: actorId });
    }
    if (actions !== undefined) {
      clauses.push({ action: { in: [...actions] } });
    }
    if (from !== undefined || to !== undefined) {
      clauses.push({
        createdAt: {
          ...(from !== undefined && { gte: from }),
          ...(to !== undefined && { lte: to }),
        },
      });
    }

    const rows = await this.client.auditLog.findMany({
      // The visibility clause is spelled HERE rather than lifted into a const:
      // AuditLog is not scoped by the Prisma extension on any client, so this
      // where is its only boundary, and noctcore-prisma/tenant-scoped-tables-require-where
      // reads the call site syntactically. A named const would hide the scope
      // from the one guard that checks it.
      where: {
        AND: [{ OR: [{ tenantId }, { tenantId: null, user: { tenantId } }] }, ...clauses],
      },
      select: LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...idCursorArgs(cursor),
    });

    const { rows: page, nextCursor } = pageByIdCursor(rows, limit);
    const items = page.map(({ user, ...row }) => ({ ...row, actor: user }));
    return { items, nextCursor };
  }
}
