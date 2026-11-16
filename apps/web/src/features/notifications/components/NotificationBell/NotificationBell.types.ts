import type { NotificationItemOutput } from '@repo/shared/schemas';

export interface INotificationBellView {
  readonly notifications: readonly NotificationItemOutput[];
  readonly badgeLabel: string;
  readonly ariaLabel: string;
  /** True only after the first fetch settled with zero items (never during load). */
  readonly isEmpty: boolean;
  readonly isLoading: boolean;
  readonly hasUnread: boolean;
  readonly onMarkAllAsRead: () => void;
}
