import { Injectable } from '@nestjs/common';
import type { AuditLogItem } from '@repo/shared/schemas';
import { BaseRepository } from '../../common/database/base.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { idCursorArgs, pageByIdCursor } from '../../common/utils/cursor-page';

export interface IAuditLogListParams {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface IAuditLogListPage {
  items: AuditLogItem[];
  nextCursor: string | null;
}

/**
 * The wire projection, an allowlist: only what the list renders. Snapshots,
 * metadata, IP address and user agent stay in the table, so a column added to
 * AuditLog later never reaches the wire by default.
 */
const LIST_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
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
   * List one keyset page of the audit trail, newest first, unfiltered. The
   * caller is an admin (the router is admin-gated), and an admin reads the
   * whole trail.
   *
   * Pagination: keyset on the unique `id` (Prisma `cursor` + `skip: 1`),
   * ordered `createdAt desc, id desc`. The id tiebreaker keeps the cursor
   * exact when two rows share a createdAt. Fetches `limit + 1` rows so the
   * presence of a next page is known without a COUNT.
   */
  async listPage(params: IAuditLogListParams): Promise<IAuditLogListPage> {
    const { cursor, limit } = params;

    const rows = await this.client.auditLog.findMany({
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
