import type { Meta, StoryObj } from '@storybook/react-vite';
import AuditLogFilters from './AuditLogFilters';

const meta: Meta<typeof AuditLogFilters> = {
  title: 'audit/AuditLogFilters',
  component: AuditLogFilters,
  args: {
    actorId: '',
    action: '',
    fromValue: '',
    toValue: '',
    activeFilters: 0,
    onActorChange: () => undefined,
    onActionChange: () => undefined,
    onFromChange: () => undefined,
    onToChange: () => undefined,
    onClear: () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof AuditLogFilters>;

export const Default: Story = {};

export const Narrowed: Story = {
  args: { actorId: 'u-1', fromValue: '2026-07-01', activeFilters: 2 },
};
