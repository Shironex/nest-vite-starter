import type { Meta, StoryObj } from '@storybook/react-vite';
import ChangeMemberRoleDialog from './ChangeMemberRoleDialog';

const meta: Meta<typeof ChangeMemberRoleDialog> = {
  title: 'admin/ChangeMemberRoleDialog',
  component: ChangeMemberRoleDialog,
};

export default meta;

type Story = StoryObj<typeof ChangeMemberRoleDialog>;

export const PromoteToAdmin: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    memberId: 'u-1',
    email: 'member@example.com',
    memberRole: 'USER',
  },
};

export const DemoteToUser: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    memberId: 'u-1',
    email: 'admin@example.com',
    memberRole: 'ADMIN',
  },
};
