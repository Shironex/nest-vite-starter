import type { StatusTone } from '@repo/ui/status-pill';

/** One already-formatted feed row. The shell renders strings, never a clock. */
export interface IActivityFeedRow {
  readonly id: string;
  /** The headline the server wrote, e.g. "New workspace: Acme Inc.". */
  readonly title: string;
  /** The sentence under it. Empty when the event carried no detail. */
  readonly message: string;
  readonly timeLabel: string;
  /** Severity, as the tinted marker beside the row. */
  readonly tone: StatusTone;
  /** Unread rows are marked, so a returning user sees what is new. */
  readonly isUnread: boolean;
}

/** Translated copy, resolved in the hook so the shell carries no `t()` calls. */
export interface IActivityFeedLabels {
  readonly title: string;
  readonly subtitle: string;
  readonly empty: string;
  readonly emptyHint: string;
  readonly loadError: string;
  readonly retry: string;
  readonly testNotification: string;
}

export interface IActivityFeedView {
  readonly rows: readonly IActivityFeedRow[];
  readonly isLoading: boolean;
  readonly hasError: boolean;
  /** Refetch after a failed load. The only recovery used to be a page reload. */
  readonly onRetry: () => void;
  /** True only once the read has resolved with nothing in it. */
  readonly isEmpty: boolean;
  /** The test-notification control is a development affordance only. */
  readonly showTestControl: boolean;
  readonly labels: IActivityFeedLabels;
  readonly onSendTestNotification: () => void;
}
