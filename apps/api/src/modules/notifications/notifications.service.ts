import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { notificationTypeSchema } from '@repo/shared/schemas';
import type {
  NotificationListOutput,
  NotificationMarkAllReadOutput,
  NotificationMarkReadOutput,
  NotificationType,
} from '@repo/shared/schemas';
import { withJobContext } from '../../common/queue';
import {
  NOTIFICATION_DISPATCH_JOB_NAMES,
  NOTIFICATION_DISPATCH_QUEUE_NAME,
} from './notification-dispatch/notification-dispatch.constants';
import type {
  INotificationDispatchJobData,
  INotificationInput,
} from './notification-dispatch/notification-dispatch.types';
import { NotificationsRepository } from './notifications.repository';

/**
 * Notifications facade. `notify()` is the ONE producer onto the
 * notification-dispatch queue: the worker persists the row (Postgres is the
 * source of truth for the bell) and emits the socket event after, so callers
 * only await the enqueue and never sit on a DB write or a socket round trip.
 * The read side (list/markRead/markAllRead) backs the tRPC router and is
 * strictly caller-scoped via the repository's userId-guarded queries.
 *
 *   - markRead and markAllRead write no audit row, deliberately. What one would
 *     record, that this user read this notification at this time, is already a
 *     persisted column: Notification.readAt, indexed on (userId, readAt) and
 *     queryable directly. An audit row would be a second copy of a fact the
 *     table already keeps, on the busiest self-serve action in the app, diluting
 *     the trail it shares with role changes and account deletions. Contrast
 *     user.avatar.changed, which IS audited precisely because the column it
 *     overwrites keeps no history. Same reasoning as tour-progress.service.ts.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectQueue(NOTIFICATION_DISPATCH_QUEUE_NAME)
    private readonly queue: Queue<INotificationDispatchJobData>,
    private readonly notificationsRepository: NotificationsRepository,
  ) {}

  /**
   * Enqueue a notification for a user. Durable-first: the job persists the
   * row before any delivery, so a socket outage degrades to "appears in the
   * bell on next hydrate" instead of losing the notification. The jobId is a
   * producer-minted UUID (not BullMQ's auto-increment): the worker's persist
   * is idempotent under RETRY via the row's unique jobId column, and the
   * auto-increment counter lives only in Redis while rows are retained for
   * 90 days: after a Redis reset a reused counter value would match an old
   * row and the new notification would be silently dropped as a "retry".
   */
  async notify(userId: string, notification: INotificationInput): Promise<void> {
    await this.queue.add(
      NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH,
      withJobContext({ userId, notification }),
      { jobId: randomUUID() },
    );
    this.logger.debug('Notification enqueued', { userId });
  }

  /**
   * Dev-mode helper behind the gateway's TEST_NOTIFICATION handler. Rides the
   * full production pipeline (enqueue -> persist -> emit) on purpose, so a
   * dev smoke test exercises exactly what real notifications will do.
   */
  async sendTestNotification(user: { id: string; email: string }): Promise<void> {
    await this.notify(user.id, {
      type: 'info',
      title: 'Test Notification',
      message: `Hello ${user.email}, this is a test notification!`,
    });
  }

  /** Hydrate the bell: newest-first page plus the caller's total unread count. */
  async listForUser(userId: string, limit: number): Promise<NotificationListOutput> {
    const [rows, unreadCount] = await Promise.all([
      this.notificationsRepository.listForUser(userId, limit),
      this.notificationsRepository.countUnread(userId),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        // The DB column is TEXT, so this is a parse rather than a cast. The
        // only writer today validates against the shared union at the queue
        // boundary, but nothing in the schema stops a backfill, a manual insert
        // or a newer deploy storing a fifth value, and the router's output
        // schema re-validates on the wire: one off-enum row would fail the
        // WHOLE list with a 500 and empty somebody's bell.
        type: this.readType(row.type),
        title: row.title,
        message: row.message,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount,
    };
  }

  /**
   * The stored `type` as the wire contract demands it.
   *
   * `info` is the fallback because it is the neutral one: a row of unknown
   * severity shown as informational is a wrong icon, while dropping the row
   * loses a notification the user was sent and mapping it to `error` would
   * invent an alarm. Logged so an unknown value is visible rather than quietly
   * normalized forever.
   */
  private readType(stored: string): NotificationType {
    const parsed = notificationTypeSchema.safeParse(stored);
    if (parsed.success) {
      return parsed.data;
    }
    this.logger.warn('Notification row carries an unknown type; showing it as info.', {
      storedType: stored,
    });
    return 'info';
  }

  /** Mark one caller-owned notification read (idempotent, ownership-scoped). */
  async markRead(userId: string, id: string): Promise<NotificationMarkReadOutput> {
    const count = await this.notificationsRepository.markRead(userId, id);
    return { updated: count > 0 };
  }

  /** Mark every unread notification for the caller read. */
  async markAllRead(userId: string): Promise<NotificationMarkAllReadOutput> {
    const updated = await this.notificationsRepository.markAllRead(userId);
    return { updated };
  }

  /**
   * The same enqueue for a whole audience, in ONE round trip.
   *
   * Every fan-out in the app used to be a `for..of` awaiting `notify` per
   * recipient, so a 40-person organization paid 40 sequential BullMQ adds (several
   * Redis commands each) inside the mutation that triggered them, and the
   * nightly rung sweep paid one per (item, rung, staff user). `addBulk` is the
   * same producer with one command.
   *
   * PER-JOB SEMANTICS ARE UNCHANGED, and that is the whole contract: each job
   * still carries its own producer-minted UUID jobId (see `notify` for why it
   * is not BullMQ's auto-increment counter), and each still carries its own
   * `withJobContext` envelope, captured here, once, from the same ALS request
   * context every individual `notify` would have read. One notification per
   * recipient, exactly as before; only the number of round trips changed.
   *
   * Fails as ONE unit rather than per recipient, which is the real difference
   * for callers: a rejected `addBulk` means "assume none of them landed". Every
   * caller that holds a per-recipient dedupe claim must therefore release the
   * claims of the whole batch, not of one recipient.
   */
  async notifyMany(userIds: readonly string[], notification: INotificationInput): Promise<void> {
    if (userIds.length === 0) return;
    await this.queue.addBulk(
      userIds.map((userId) => ({
        name: NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH,
        data: withJobContext({ userId, notification }),
        opts: { jobId: randomUUID() },
      })),
    );
    this.logger.debug('Notification enqueued for several users', { userCount: userIds.length });
  }
}
