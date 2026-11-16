import type { Meta, StoryObj } from '@storybook/react-vite';
import UnlockMemberDialog from './UnlockMemberDialog';

const meta: Meta<typeof UnlockMemberDialog> = {
  title: 'admin/UnlockMemberDialog',
  component: UnlockMemberDialog,
};

export default meta;

type Story = StoryObj<typeof UnlockMemberDialog>;

export const Open: Story = {
  args: { open: true, onOpenChange: () => {}, memberId: 'u-1', email: 'member@example.com' },
};
