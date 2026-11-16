import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuditLogTable from './AuditLogTable';
import type { IAuditRowView } from '../../Audit.types';

const baseRow: IAuditRowView = {
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

describe('AuditLogTable', () => {
  it('renders one feed row with actor, action and timestamp', () => {
    render(
      <AuditLogTable
        isRefreshing={false}
        rows={[baseRow]}
        state="ready"
        pagination={null}
        empty={null}
        error={null}
      />,
    );
    expect(screen.getByText('Anna Keller')).toBeInTheDocument();
    expect(screen.getByText('Contract edited')).toBeInTheDocument();
    expect(screen.getByText('07/14/2026 09:12 AM')).toBeInTheDocument();
  });

  it('shows the first field change as a before/after pair without expanding', () => {
    const row: IAuditRowView = {
      ...baseRow,
      changes: [
        { field: 'stawkaVat', before: '8%', after: '23%' },
        { field: 'term', before: '14', after: '21' },
      ],
    };
    render(
      <AuditLogTable
        isRefreshing={false}
        rows={[row]}
        state="ready"
        pagination={null}
        empty={null}
        error={null}
      />,
    );
    expect(screen.getByText('stawkaVat')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();
    expect(screen.getByText('23%')).toBeInTheDocument();
    // The second change stays behind the "+1" marker until expanded.
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('term')).not.toBeInTheDocument();
  });

  it('expands a row in place and collapses it again', () => {
    const row: IAuditRowView = {
      ...baseRow,
      ipAddress: '10.0.0.1',
      metaEntries: [{ key: 'reason', value: 'bad_password' }],
    };
    render(
      <AuditLogTable
        isRefreshing={false}
        rows={[row]}
        state="ready"
        pagination={null}
        empty={null}
        error={null}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Show event details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(screen.getByText('bad_password')).toBeInTheDocument();

    const collapse = screen.getByRole('button', { name: 'Hide event details' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapse);
    expect(screen.queryByText('bad_password')).not.toBeInTheDocument();
  });

  it('renders skeleton rows while the first page loads', () => {
    const { container } = render(
      <AuditLogTable
        isRefreshing={false}
        rows={[]}
        state="loading"
        pagination={null}
        empty={null}
        error={null}
      />,
    );
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('replaces the table with the placeholder the page supplied', () => {
    // The card owns the swap, which is what keeps a bare header row from
    // floating over a full-width message cell inside the table.
    render(
      <AuditLogTable
        isRefreshing={false}
        rows={[]}
        state="empty"
        pagination={null}
        empty={<p>The audit log is still empty</p>}
        error={null}
      />,
    );

    expect(screen.getByText('The audit log is still empty')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('draws prev/next with a position and never a page number', () => {
    // audit.list carries no total by design, so there is nothing to number.
    render(
      <AuditLogTable
        isRefreshing={false}
        rows={[baseRow]}
        state="ready"
        pagination={{
          summary: 'Showing 26-50',
          label: 'Audit log pagination',
          hasPrevious: true,
          hasNext: false,
          isBusy: false,
          onPrevious: vi.fn(),
          onNext: vi.fn(),
        }}
        empty={null}
        error={null}
      />,
    );

    expect(screen.getByText('Showing 26-50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Page 1' })).not.toBeInTheDocument();
  });

  it('hides the footer while the card is not showing rows', () => {
    render(
      <AuditLogTable
        isRefreshing={false}
        rows={[]}
        state="loading"
        pagination={{
          summary: 'Showing 1-25',
          label: 'Audit log pagination',
          hasPrevious: false,
          hasNext: true,
          isBusy: false,
          onPrevious: vi.fn(),
          onNext: vi.fn(),
        }}
        empty={null}
        error={null}
      />,
    );

    // A pager over a skeleton is a control that cannot be honored yet.
    expect(screen.queryByText('Showing 1-25')).not.toBeInTheDocument();
  });
});
