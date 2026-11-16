import { z } from 'zod';
import type { NotificationPayload } from '../events/index.js';

/**
 * Notifications wire contract. The database (Notification table) is the source
 * of truth for the web bell; Socket.io NOTIFICATION events are delivery-time
 * signals only. The bell hydrates from `notifications.list` and live events
 * merge into that cached page on the client.
 */

/**
 * Severity union for a notification. Kept in lockstep with the socket wire
 * shape (`NotificationPayload['type']` in @repo/shared/events) via the
 * `satisfies` check below, so the two contracts cannot drift apart silently.
 * The DB column stays TEXT; this union is enforced at the app boundaries
 * (dispatch job payload in, tRPC output out).
 */
export const notificationTypeSchema = z.enum([
  'info',
  'success',
  'warning',
  'error',
]) satisfies z.ZodType<NotificationPayload['type']>;

export type NotificationType = z.infer<typeof notificationTypeSchema>;

/*
 * Moved to `@repo/shared/constants` (no zod there), so the web pays for a
 * number instead of for the whole schemas chunk. Re-exported because the api
 * reads these from the module that enforces them.
 */
export {
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  NOTIFICATION_LIST_MAX_LIMIT,
} from '../constants/index.js';
import {
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  NOTIFICATION_LIST_MAX_LIMIT,
} from '../constants/index.js';

/**
 * One notification as the web bell renders it. `read` is derived server-side
 * from `readAt != null`; `createdAt` travels as an ISO-8601 string so the
 * cached list is plain JSON-friendly data.
 */
export const notificationItemOutput = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  message: z.string(),
  read: z.boolean(),
  createdAt: z.string(),
});

export type NotificationItemOutput = z.infer<typeof notificationItemOutput>;

/**
 * `notifications.list` input. prefault (not default): the fallback {} is
 * parsed through the object schema, so the inner limit default applies and
 * the handler always receives a concrete limit.
 */
export const notificationListInput = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(NOTIFICATION_LIST_MAX_LIMIT)
      .default(NOTIFICATION_LIST_DEFAULT_LIMIT),
  })
  .prefault({});

export type NotificationListInput = z.infer<typeof notificationListInput>;

/**
 * `notifications.list` output: newest-first page plus the total unread count
 * (the badge shows unread across the whole table, not just the visible page).
 */
export const notificationListOutput = z.object({
  items: z.array(notificationItemOutput),
  unreadCount: z.number().int().nonnegative(),
});

export type NotificationListOutput = z.infer<typeof notificationListOutput>;

/** `notifications.markRead` input: the id of the caller-owned notification. */
export const notificationMarkReadInput = z.object({
  id: z.string(),
});

export type NotificationMarkReadInput = z.infer<typeof notificationMarkReadInput>;

/**
 * `notifications.markRead` output. `updated: false` means the row was already
 * read (or not the caller's), which the idempotent updateMany treats as a
 * no-op rather than an error.
 */
export const notificationMarkReadOutput = z.object({
  updated: z.boolean(),
});

export type NotificationMarkReadOutput = z.infer<typeof notificationMarkReadOutput>;

/** `notifications.markAllRead` output: how many rows flipped to read. */
export const notificationMarkAllReadOutput = z.object({
  updated: z.number().int().nonnegative(),
});

export type NotificationMarkAllReadOutput = z.infer<typeof notificationMarkAllReadOutput>;

// --- per-user notification preferences -------------------------------

/**
 * What a notification is ABOUT, as the preference matrix keys it. Distinct
 * from `notificationTypeSchema` (severity of one row): a category groups a
 * class of events a user can mute or route. Deliberately conservative: the
 * digest is valuable because it is quiet, so every category needs its own
 * justification.
 */
export const NOTIFICATION_CATEGORIES = {
  WORKSPACE_CREATED: 'WORKSPACE_CREATED',
  ADMIN_ACTIONS: 'ADMIN_ACTIONS',
} as const;

export const notificationCategorySchema = z.enum([
  NOTIFICATION_CATEGORIES.WORKSPACE_CREATED,
  NOTIFICATION_CATEGORIES.ADMIN_ACTIONS,
]);

export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

/** Iteration order for resolve seams and the settings UI rows. */
export const ALL_NOTIFICATION_CATEGORIES = notificationCategorySchema.options;

/**
 * The delivery channels a category can be routed to. Every category stores
 * both flags (forward-compatible: a later digest for events needs no
 * migration), but the event categories deliver in-app only, and the UI renders
 * only the wired toggles.
 */
export const notificationChannelsSchema = z.object({
  inApp: z.boolean(),
  digest: z.boolean(),
});

export type NotificationChannels = z.infer<typeof notificationChannelsSchema>;

/**
 * Exhaustive map (zod v4 record over an enum key requires every key): the
 * settings panel always round-trips the whole matrix, so a partial write
 * cannot silently reset a category it did not mean to touch.
 */
export const notificationChannelMatrixSchema = z.record(
  notificationCategorySchema,
  notificationChannelsSchema,
);

export type NotificationChannelMatrix = z.infer<typeof notificationChannelMatrixSchema>;

/**
 * New events are opt-in: a user who never opens the settings panel is not
 * notified about anything they did not ask for.
 */
export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannelMatrix = {
  WORKSPACE_CREATED: { inApp: false, digest: false },
  ADMIN_ACTIONS: { inApp: false, digest: false },
};

/** `notifications.preferencesGet` output. */
export const notificationPreferencesOutput = z.object({
  channels: notificationChannelMatrixSchema,
  /** True while the caller has never saved preferences and defaults apply. */
  isDefault: z.boolean(),
  updatedAt: z.date().nullable(),
});

export type NotificationPreferencesOutput = z.infer<typeof notificationPreferencesOutput>;

/** `notifications.preferencesUpdate` input: always the whole matrix. */
export const notificationPreferencesUpdateInput = z.object({
  channels: notificationChannelMatrixSchema,
});

export type NotificationPreferencesUpdateInput = z.infer<typeof notificationPreferencesUpdateInput>;
