import type { ReactNode } from 'react';
import type { IAuditRowView } from '../../Audit.types';
import type { IAuditPaginationView } from '../AuditLogPage';

export interface IAuditLogTableProps {
  readonly rows: readonly IAuditRowView[];
  /** What the card shows. Anything but `ready` replaces the table entirely. */
  readonly state: 'ready' | 'loading' | 'empty' | 'error';
  /**
   * A filter or page change is in flight over rows still on screen: the table
   * dims and reports itself busy rather than being replaced.
   */
  readonly isRefreshing: boolean;
  /** The degraded pager, or null when there is no position to state. */
  readonly pagination: IAuditPaginationView | null;
  /** Rendered in place of the table when `state` is `empty`. */
  readonly empty: ReactNode;
  /** Rendered in place of the table when `state` is `error`. */
  readonly error: ReactNode;
}

export interface IAuditLogTableView {
  readonly isExpanded: (id: string) => boolean;
  readonly onToggle: (id: string) => void;
  readonly labels: {
    readonly actor: string;
    readonly action: string;
    readonly details: string;
    readonly when: string;
    readonly expand: string;
    readonly collapse: string;
    readonly previous: string;
    readonly next: string;
  };
}
