import type { IAuditRowView } from '../../Audit.types';
import type { IAuditLogFiltersProps } from '../AuditLogFilters';

/** Which slice of the trail is on screen. The chip became the tab row. */
export type AuditLogTab = 'all' | 'failedLogins';

/**
 * The footer's degraded pager: position and prev/next, no page numbers.
 *
 * `audit.list` carries no total, deliberately and permanently: an append-only
 * trail grows without bound and counting it on every page view is a cost the
 * screen does not earn. So there is nothing to draw page buttons from, and a
 * footer that invented some would be lying. Null before the first page lands.
 */
export interface IAuditPaginationView {
  /** "Showing 26-50", already formatted. No "of N": there is no N. */
  readonly summary: string;
  readonly label: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** True while the next page is in flight, so every control is inert. */
  readonly isBusy: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

export interface IAuditLogPageView {
  /** The filter panel's whole prop set, spread into it by the shell. */
  readonly filters: IAuditLogFiltersProps;
  readonly rows: readonly IAuditRowView[];
  /** What the list card shows. Anything but `ready` replaces the table. */
  readonly state: 'ready' | 'loading' | 'empty' | 'error';
  /**
   * A filter or page change is in flight over rows still on screen. Distinct
   * from `state === 'loading'`, which is the first load and has nothing to show.
   */
  readonly isRefreshing: boolean;
  readonly tab: AuditLogTab;
  readonly tabs: readonly { readonly value: AuditLogTab; readonly label: string }[];
  readonly onTabChange: (tab: string) => void;
  readonly pagination: IAuditPaginationView | null;
  readonly onRetry: () => void;
  readonly labels: {
    readonly loadError: string;
    readonly retry: string;
    /** Already chosen between the filtered and unfiltered empty states. */
    readonly emptyTitle: string;
    readonly emptyHint: string;
  };
}
