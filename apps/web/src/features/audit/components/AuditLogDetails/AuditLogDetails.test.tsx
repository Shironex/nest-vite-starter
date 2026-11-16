import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuditLogDetails from './AuditLogDetails';
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

describe('AuditLogDetails', () => {
  it('renders every field change as a before/after pair', () => {
    render(
      <AuditLogDetails
        row={{
          ...baseRow,
          changes: [
            { field: 'stawkaVat', before: '8%', after: '23%' },
            { field: 'kontrahent', before: null, after: 'Northwind Ltd' },
          ],
        }}
      />,
    );

    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getByText('stawkaVat')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();
    expect(screen.getByText('23%')).toBeInTheDocument();
    // A side with no value renders the empty marker, mirroring the design.
    expect(screen.getByText('kontrahent')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('Northwind Ltd')).toBeInTheDocument();
  });

  it('falls back to changed-field chips when the writer recorded names only', () => {
    render(<AuditLogDetails row={{ ...baseRow, changedFields: ['city', 'phone'] }} />);
    expect(screen.getByText('Changed fields')).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
    expect(screen.getByText('phone')).toBeInTheDocument();
  });

  it('shows target, metadata and network context when present', () => {
    render(
      <AuditLogDetails
        row={{
          ...baseRow,
          targetLabel: 'Workspace (f-1)',
          metaEntries: [{ key: 'field', value: 'city' }],
          ipAddress: '10.0.0.1',
          userAgent: 'Mozilla/5.0',
          correlationId: 'req-9',
        }}
      />,
    );

    expect(screen.getByText('Workspace (f-1)')).toBeInTheDocument();
    expect(screen.getByText('field')).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.1/)).toBeInTheDocument();
    expect(screen.getByText(/req-9/)).toBeInTheDocument();
    expect(screen.getByText(/Mozilla\/5\.0/)).toBeInTheDocument();
  });

  it('says so plainly when a row has nothing beyond its action', () => {
    render(<AuditLogDetails row={baseRow} />);
    expect(screen.getByText('This event has no additional details.')).toBeInTheDocument();
  });
});
