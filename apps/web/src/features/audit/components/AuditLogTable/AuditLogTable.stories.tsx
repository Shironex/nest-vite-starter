import type { Meta, StoryObj } from '@storybook/react-vite';
import AuditLogTable from './AuditLogTable';
import type { IAuditRowView } from '../../Audit.types';

const rows: IAuditRowView[] = [
  {
    id: 'a-1',
    actorName: 'Anna Keller',
    actorInitials: 'AK',
    isSystem: false,
    actionLabel: 'Contract edited',
    actionTone: 'neutral',
    changes: [{ field: 'stawkaVat', before: '8%', after: '23%' }],
    changedFields: [],
    metaEntries: [],
    targetLabel: 'Contract (con-1)',
    reason: null,
    ipAddress: '10.0.0.1',
    userAgent: 'Mozilla/5.0',
    correlationId: 'req-1',
    success: true,
    whenLabel: '07/14/2026 09:12 AM',
  },
  {
    id: 'a-2',
    actorName: 'System',
    actorInitials: 'SY',
    isSystem: true,
    actionLabel: 'Organization invitation withdrawn',
    actionTone: 'neutral',
    changes: [],
    changedFields: [],
    metaEntries: [{ key: 'closedCount', value: '3' }],
    targetLabel: null,
    reason: null,
    ipAddress: null,
    userAgent: null,
    correlationId: null,
    success: true,
    whenLabel: '07/13/2026 05:02 PM',
  },
  {
    id: 'a-3',
    actorName: 'Peter North',
    actorInitials: 'PN',
    isSystem: false,
    actionLabel: 'Failed sign-in',
    actionTone: 'danger',
    changes: [],
    changedFields: [],
    metaEntries: [{ key: 'reason', value: 'bad_password' }],
    targetLabel: 'User (u-2)',
    reason: null,
    ipAddress: '10.0.0.2',
    userAgent: 'Mozilla/5.0',
    correlationId: 'req-2',
    success: false,
    whenLabel: '07/13/2026 11:20 AM',
  },
];

const meta: Meta<typeof AuditLogTable> = {
  title: 'audit/AuditLogTable',
  component: AuditLogTable,
  args: {
    rows,
    state: 'ready',
    pagination: {
      summary: 'Showing 1-25',
      label: 'Audit log pagination',
      hasPrevious: false,
      hasNext: true,
      isBusy: false,
      onPrevious: () => undefined,
      onNext: () => undefined,
    },
    empty: <p className="type-body-strong text-text">The audit log is still empty</p>,
    error: <p className="type-body-regular text-danger">Could not load the audit log</p>,
  },
};

export default meta;

type Story = StoryObj<typeof AuditLogTable>;

export const Feed: Story = {};

export const Loading: Story = {
  args: { rows: [], state: 'loading' },
};

export const Empty: Story = {
  args: { rows: [], state: 'empty' },
};

export const LoadFailed: Story = {
  args: { rows: [], state: 'error' },
};

/** No total on this contract, so the footer degrades to prev/next honestly. */
export const LastPage: Story = {
  args: {
    pagination: {
      summary: 'Showing 26-38',
      label: 'Audit log pagination',
      hasPrevious: true,
      hasNext: false,
      isBusy: false,
      onPrevious: () => undefined,
      onNext: () => undefined,
    },
  },
};
