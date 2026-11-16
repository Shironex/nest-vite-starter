import type { Meta, StoryObj } from '@storybook/react-vite';
import ResetMemberDialog from './ResetMemberDialog';

const meta: Meta<typeof ResetMemberDialog> = {
  title: 'admin/ResetMemberDialog',
  component: ResetMemberDialog,
};

export default meta;

type Story = StoryObj<typeof ResetMemberDialog>;

export const Open: Story = {
  args: { open: true, onOpenChange: () => {}, memberId: 'u-1', email: 'member@example.com' },
};
