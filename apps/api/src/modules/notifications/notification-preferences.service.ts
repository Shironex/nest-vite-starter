import { Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import {
  ALL_NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_CHANNELS,
  notificationChannelsSchema,
} from '@repo/shared/schemas';
import type {
  NotificationCategory,
  NotificationChannelMatrix,
  NotificationChannels,
  NotificationPreferencesOutput,
} from '@repo/shared/schemas';
import type { NotificationPreference } from '@repo/database' with { 'resolution-mode': 'import' };
import { PrismaService } from '../../common/database/prisma.service';
import { PRISMA_ERROR, isPrismaErrorCode } from '../../common/database/prisma-error';
import { ConflictError } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { NotificationsRepository } from './notifications.repository';
import { AppErrorCode } from '@repo/shared/errors';

/** One delivery channel key of the per-category matrix. */
export type NotificationChannelKey = keyof NotificationChannels;

/**
 * Per-user notification preferences: which channels a user wants per category.
 *
 * A zod-validated Json configuration: one row per user, created lazily on
 * first save, defaults when absent, and every read resolved through one static
 * seam. Event categories default to muted, so a user who never opens the panel
 * is not notified about anything they did not ask for.
 *
 * Two consumer groups:
 *   - the settings surface (getForUser/updateForUser behind the tRPC router);
 *   - the delivery paths (event emissions), which filter recipient sets through filterByChannel.
 *     Preferences filter INTO the existing machinery; they
 *     never deliver anything themselves.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly repository: NotificationsRepository,
    private readonly auditService: AuditService,
  ) {}

  async getForUser(userId: string): Promise<NotificationPreferencesOutput> {
    const row = await this.repository.findPreference(userId);
    if (!row) {
      return {
        channels: NotificationPreferencesService.resolveChannels(null),
        isDefault: true,
        updatedAt: null,
      };
    }
    return NotificationPreferencesService.toOutput(row);
  }

  async updateForUser(
    userId: string,
    channels: NotificationChannelMatrix,
  ): Promise<NotificationPreferencesOutput> {
    // Canonicalize through the resolve seam: the wire schema already rejects
    // unknown keys and partial matrices, so this only normalizes key order,
    // keeping stored Json diffable in the audit trail.
    const resolved = NotificationPreferencesService.resolveChannels(channels);

    let saved: NotificationPreference;
    try {
      saved = await this.prismaService.client.$transaction(async (tx) => {
        const existing = await this.repository.findPreference(userId, tx);
        if (existing) {
          return this.repository.updatePreference(existing.id, resolved, tx);
        }
        return this.repository.createPreference(userId, resolved, tx);
      });
    } catch (error) {
      // Two tabs saving the user's FIRST preferences concurrently: both see no
      // row, both create, the `userId @unique` rejects the loser with P2002.
      if (isPrismaErrorCode(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        throw new ConflictError(
          AppErrorCode.CONFLICT,
          'Notification preferences were changed concurrently; reload and retry.',
        );
      }
      throw error;
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_UPDATED,
      targetType: 'NotificationPreference',
      targetId: saved.id,
      metadata: { channels: resolved },
    });

    return NotificationPreferencesService.toOutput(saved);
  }

  /**
   * Of `userIds`, the ones whose effective preference for (category, channel)
   * is ON, in the caller's order. Users without a row resolve to the defaults,
   * which is what keeps delivery identical for everyone who never touched the
   * panel.
   */
  async filterByChannel(
    userIds: readonly string[],
    category: NotificationCategory,
    channel: NotificationChannelKey,
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.repository.findPreferencesByUserIds(userIds);
    const storedByUser = new Map(rows.map((row) => [row.userId, row.channels]));
    return userIds.filter(
      (userId) =>
        NotificationPreferencesService.resolveChannels(storedByUser.get(userId) ?? null)[category][
          channel
        ],
    );
  }

  /**
   * The effective channel matrix for a (possibly absent, possibly stale)
   * stored Json blob. PUBLIC and static on purpose: every delivery path resolves
   * through this same seam. A category added to the enum after the row was
   * saved falls back to its default instead of silently muting (or crashing
   * wire reads); an unknown or malformed entry is dropped.
   */
  static resolveChannels(stored: unknown): NotificationChannelMatrix {
    const source = (stored ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      ALL_NOTIFICATION_CATEGORIES.map((category) => {
        const saved = notificationChannelsSchema.safeParse(source[category]);
        return [
          category,
          saved.success ? saved.data : { ...DEFAULT_NOTIFICATION_CHANNELS[category] },
        ];
      }),
    ) as NotificationChannelMatrix;
  }

  private static toOutput(row: NotificationPreference): NotificationPreferencesOutput {
    return {
      channels: NotificationPreferencesService.resolveChannels(row.channels),
      isDefault: false,
      updatedAt: row.updatedAt,
    };
  }
}
