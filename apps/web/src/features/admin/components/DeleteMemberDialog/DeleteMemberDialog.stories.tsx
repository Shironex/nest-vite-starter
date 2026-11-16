import type { Meta, StoryObj } from '@storybook/react-vite';
import DeleteMemberDialog from './DeleteMemberDialog';

const meta: Meta<typeof DeleteMemberDialog> = {
  title: 'admin/DeleteMemberDialog',
  component: DeleteMemberDialog,
};

export default meta;

type Story = StoryObj<typeof DeleteMemberDialog>;

export const Open: Story = {
  args: { open: true, onOpenChange: () => {}, memberId: 'u-1', email: 'member@example.com' },
};
