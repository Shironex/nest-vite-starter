import { Injectable } from '@nestjs/common';
import type { NotificationPreference, Prisma } from '@repo/database' with {
  'resolution-mode': 'import',
};
import { BaseRepository } from '../../common/database/base.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { now } from '../../common/clock';

/** Row shape the dispatch worker persists. */
export interface ICreateNotificationData {
  readonly userId: string;
  readonly tenantId: string | null;
  readonly type: string;
  readonly title: string;
  readonly message: string;
  readonly jobId: string | null;
}

/**
 * Projection for everything the worker emit and the bell wire shape need.
 * Deliberately omits tenantId/jobId (worker internals, never on the wire);
 * a `select` allowlist so a future internal column stays off by default.
 */
const WIRE_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  readAt: true,
  createdAt: true,
} as const;

/**
 * Notification persistence. Uses `this.client` (the tenant-scope-extended
 * client): Notification is not a tenant-scoped model, so the extension passes
 * it through untouched, and every read/write here is EXPLICITLY scoped by
 * userId instead: the bell is a per-user surface, not a per-tenant one.
 */
@Injectable()
export class NotificationsRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create(data: ICreateNotificationData) {
    return this.client.notification.create({ data, select: WIRE_SELECT });
  }

  /**
   * Retry-idempotency lookup for the dispatch worker: a retried job finds the
   * row its first attempt persisted (unique jobId) instead of duplicating it.
   */
  async findByJobId(jobId: string) {
    return this.client.notification.findUnique({
      where: { jobId },
      select: WIRE_SELECT,
    });
  }

  /** Newest-first page for the bell. id desc is the deterministic tiebreak. */
  async listForUser(userId: string, limit: number) {
    return this.client.notification.findMany({
      where: { userId },
      select: WIRE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async countUnread(userId: string): Promise<number> {
    return this.client.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * Ownership-scoped read flip. The userId in the where-clause (not just the
   * id) is what closes the IDOR: a caller can only mark their own rows.
   * `readAt: null` keeps it idempotent: an already-read row is a no-op, so
   * the affected count doubles as the "did anything change" signal.
   */
  async markRead(userId: string, id: string): Promise<number> {
    const result = await this.client.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: now() },
    });
    return result.count;
  }

  /** Flip every unread row for the caller; returns how many flipped. */
  async markAllRead(userId: string): Promise<number> {
    const result = await this.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now() },
    });
    return result.count;
  }

  /**
   * Active (non-deleted) users of one tenant, for the event fan-outs. User is
   * platform-global (not tenant-scoped), so the tenant filter is explicit, with
   * `role` included so admin-audience events can narrow without a second read.
   */
  listActiveUsersByTenant(tenantId: string): Promise<Array<{ id: string; role: string }>> {
    return this.client.user.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, role: true },
      orderBy: { id: 'asc' },
    });
  }

  // --- NotificationPreference ----------------------------------------------
  // NotificationPreference is user-scoped config (not tenant-scoped), so like
  // the notification rows above every query here is keyed by userId.

  /** The caller's preference row, if one was ever saved. */
  findPreference(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<NotificationPreference | null> {
    return (tx ?? this.client).notificationPreference.findUnique({ where: { userId } });
  }

  /**
   * Preference rows for a recipient set, for the delivery-side filters. Users
   * with no row are absent on purpose: absence means the defaults, and the
   * resolve seam is what turns absence into a matrix.
   */
  findPreferencesByUserIds(
    userIds: readonly string[],
  ): Promise<Array<{ userId: string; channels: unknown }>> {
    return this.client.notificationPreference.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, channels: true },
    });
  }

  createPreference(
    userId: string,
    channels: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<NotificationPreference> {
    return (tx ?? this.client).notificationPreference.create({ data: { userId, channels } });
  }

  updatePreference(
    preferenceId: string,
    channels: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<NotificationPreference> {
    return (tx ?? this.client).notificationPreference.update({
      where: { id: preferenceId },
      data: { channels },
    });
  }
}
