import type { StatusTone } from '@repo/ui/status-pill';

/** Everything one row renders, precomputed off the wire item. */
export interface IAuditLogRowView {
  readonly id: string;
  readonly whenLabel: string;
  readonly actorName: string;
  readonly actionLabel: string;
  readonly actionTone: StatusTone;
  /** "User (id)" style label, or null for an event with no target. */
  readonly targetLabel: string | null;
}

/** The footer pager: a position and prev/next. There is no total by design. */
export interface IAuditLogPaginationView {
  readonly summary: string;
  readonly label: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly isBusy: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

export interface IAuditLogSectionView {
  readonly rows: readonly IAuditLogRowView[];
  /** What the card shows. Anything but `ready` replaces the table. */
  readonly state: 'ready' | 'loading' | 'empty' | 'error';
  /** A page change is in flight over rows that are still on screen. */
  readonly isRefreshing: boolean;
  readonly pagination: IAuditLogPaginationView | null;
  readonly onRetry: () => void;
}
