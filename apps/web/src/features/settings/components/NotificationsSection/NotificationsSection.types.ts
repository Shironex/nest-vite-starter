import type { NotificationCategory, NotificationChannels } from '@repo/shared/schemas';

/** One delivery channel key of the per-category matrix. */
export type NotificationChannelKey = keyof NotificationChannels;

export interface INotificationChannelToggleView {
  readonly channel: NotificationChannelKey;
  /** DOM id pairing the switch with its visible label. */
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
}

export interface INotificationCategoryRowView {
  readonly category: NotificationCategory;
  readonly label: string;
  readonly description: string;
  /** Only the channels actually WIRED for this category in v1. */
  readonly toggles: readonly INotificationChannelToggleView[];
}

export interface INotificationsSectionView {
  readonly rows: readonly INotificationCategoryRowView[];
  readonly isLoading: boolean;
  readonly hasLoadError: boolean;
  readonly isSaving: boolean;
  readonly labels: {
    readonly title: string;
    readonly description: string;
    readonly loadError: string;
  };
  readonly onToggle: (
    category: NotificationCategory,
    channel: NotificationChannelKey,
    checked: boolean,
  ) => void;
}
