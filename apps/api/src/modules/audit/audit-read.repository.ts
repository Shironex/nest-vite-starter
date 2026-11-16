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
   * List one keyset page of the audit trail, newest first. The caller is an
   * admin (the router is admin-gated), and in a single-user-account app an
   * admin reads the whole trail.
   *
   * Pagination: keyset on the unique `id` (Prisma `cursor` + `skip: 1`),
   * ordered `createdAt desc, id desc`. The id tiebreaker keeps the cursor
   * exact when two rows share a createdAt. Fetches `limit + 1` rows so the
   * presence of a next page is known without a COUNT.
   */
  async listPage(params: IAuditLogListParams): Promise<IAuditLogListPage> {
    const { actorId, actions, from, to, cursor, limit } = params;

    // Every filter is ANDed, so none can widen another.
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
      where: { AND: clauses },
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
