import type { Meta, StoryObj } from '@storybook/react-vite';
import AuditLogPage from './AuditLogPage';

const meta: Meta<typeof AuditLogPage> = {
  title: 'audit/AuditLogPage',
  component: AuditLogPage,
};

export default meta;

type Story = StoryObj<typeof AuditLogPage>;

/** The whole screen; data arrives through the mocked tRPC layer in preview. */
export const Default: Story = {};
