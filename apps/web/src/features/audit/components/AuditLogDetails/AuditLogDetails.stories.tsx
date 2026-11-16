import type { Meta, StoryObj } from '@storybook/react-vite';
import AuditLogDetails from './AuditLogDetails';
import type { IAuditRowView } from '../../Audit.types';

const baseRow: IAuditRowView = {
  id: 'a-1',
  actorName: 'Anna Keller',
  actorInitials: 'AK',
  isSystem: false,
  actionLabel: 'Workspace details edited',
  actionTone: 'neutral',
  changes: [],
  changedFields: [],
  metaEntries: [],
  targetLabel: 'Workspace (f-1)',
  reason: null,
  ipAddress: '10.0.0.1',
  userAgent: 'Mozilla/5.0',
  correlationId: 'req-123',
  success: true,
  whenLabel: '07/14/2026 09:12 AM',
};

const meta: Meta<typeof AuditLogDetails> = {
  title: 'audit/AuditLogDetails',
  component: AuditLogDetails,
  args: { row: baseRow },
};

export default meta;

type Story = StoryObj<typeof AuditLogDetails>;

/** A row with real snapshots renders the red-to-green field diff. */
export const WithFieldDiff: Story = {
  args: {
    row: {
      ...baseRow,
      changes: [
        { field: 'taxRate', before: '8%', after: '23%' },
        { field: 'paymentTerm', before: '14 days', after: '21 days' },
      ],
    },
  },
};

/** Writers that keep values out record field names only, so the row shows chips. */
export const WithChangedFieldNames: Story = {
  args: {
    row: {
      ...baseRow,
      changedFields: ['city', 'phone', 'bankAccount'],
      metaEntries: [{ key: 'hasTaxId', value: 'true' }],
    },
  },
};

/** A failed login carries context, not a diff. */
export const FailedLogin: Story = {
  args: {
    row: {
      ...baseRow,
      actionLabel: 'Failed sign-in',
      actionTone: 'danger',
      success: false,
      targetLabel: 'User (u-1)',
      metaEntries: [{ key: 'reason', value: 'bad_password' }],
    },
  },
};
