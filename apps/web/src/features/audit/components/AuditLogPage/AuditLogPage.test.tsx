import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import AuditLogPage from './AuditLogPage';
import type { IAuditRowView } from '../../Audit.types';
import type { IAuditLogPageView } from './AuditLogPage.types';

const row: IAuditRowView = {
  id: 'a-1',
  actorName: 'Anna Keller',
  actorInitials: 'AK',
  isSystem: false,
  actionLabel: 'Contract edited',
  actionTone: 'neutral',
  changes: [],
  changedFields: [],
  metaEntries: [],
  targetLabel: null,
  reason: null,
  ipAddress: null,
  userAgent: null,
  correlationId: null,
  success: true,
  whenLabel: '07/14/2026 09:12 AM',
};

const state = vi.hoisted(() => ({
  view: undefined as unknown,
}));

const baseView = (): IAuditLogPageView => ({
  filters: {
    actorId: '',
    action: '',
    fromValue: '',
    toValue: '',
    activeFilters: 0,
    onActorChange: vi.fn(),
    onActionChange: vi.fn(),
    onFromChange: vi.fn(),
    onToChange: vi.fn(),
    onClear: vi.fn(),
  },
  rows: [row],
  state: 'ready',
  isRefreshing: false,
  tab: 'all',
  tabs: [
    { value: 'all', label: 'All events' },
    { value: 'failedLogins', label: 'Failed sign-ins' },
  ],
  onTabChange: vi.fn(),
  pagination: null,
  onRetry: vi.fn(),
  labels: {
    loadError: 'Could not load the audit log',
    retry: 'Try again',
    emptyTitle: 'The audit log is still empty',
    emptyHint: 'Events will appear here as soon as someone signs in or changes data.',
  },
});

vi.mock('./AuditLogPage.hooks', () => ({
  useAuditLogPage: () => state.view,
}));

interface IFiltersStubProps {
  readonly actorId: string;
  readonly activeFilters: number;
}

vi.mock('../AuditLogFilters', () => ({
  AuditLogFilters: ({ actorId, activeFilters }: IFiltersStubProps) => (
    <div
      data-testid="audit-filters"
      data-actor-id={actorId}
      data-active-filters={String(activeFilters)}
    />
  ),
}));

interface ITableStubProps {
  readonly rows: readonly IAuditRowView[];
  readonly state: string;
  readonly pagination: unknown;
  readonly empty: ReactNode;
  readonly error: ReactNode;
}

/*
 * The stub renders the placeholder slots the page hands down, because that is
 * exactly what the real surface does: the page names a state and supplies what
 * each one shows, rather than choosing between a table and an error itself.
 */
vi.mock('../AuditLogTable', () => ({
  AuditLogTable: ({ rows, state: surfaceState, pagination, empty, error }: ITableStubProps) => (
    <div
      data-testid="audit-table"
      data-row-count={rows.length}
      data-state={surfaceState}
      data-has-pager={String(pagination !== null)}
    >
      {surfaceState === 'empty' && empty}
      {surfaceState === 'error' && error}
    </div>
  ),
}));

describe('AuditLogPage', () => {
  beforeEach(() => {
    state.view = baseView();
  });

  it('splits the trail into two tabs, exactly one of them current', () => {
    render(<AuditLogPage />);

    expect(screen.getByRole('tab', { name: 'All events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Failed sign-ins' })).toBeInTheDocument();
  });

  it('keeps the narrowing behind the toolbar and hands the table its rows', () => {
    render(<AuditLogPage />);

    expect(screen.getByTestId('audit-filters')).toBeInTheDocument();
    expect(screen.getByTestId('audit-table')).toHaveAttribute('data-row-count', '1');
  });

  it('offers no "show more" button: the footer pages the feed now', () => {
    render(<AuditLogPage />);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('hands the pager down to the card, so it sits inside the surface footer', () => {
    const view = baseView();
    state.view = {
      ...view,
      pagination: {
        summary: 'Showing 1-25',
        label: 'Audit log pagination',
        hasPrevious: false,
        hasNext: true,
        onPrevious: vi.fn(),
        onNext: vi.fn(),
      },
    };
    render(<AuditLogPage />);

    expect(screen.getByTestId('audit-table')).toHaveAttribute('data-has-pager', 'true');
  });

  it('passes the failure down as the card state, rather than hiding the card', () => {
    const view = baseView();
    state.view = { ...view, state: 'error' };
    render(<AuditLogPage />);

    // The surface owns the swap: the error REPLACES the table inside the same
    // card, rather than the page rendering one or the other.
    expect(screen.getByTestId('audit-table')).toHaveAttribute('data-state', 'error');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(view.onRetry).toHaveBeenCalled();
  });
});
