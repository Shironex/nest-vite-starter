import type { Meta, StoryObj } from '@storybook/react-vite';
import RevokeInviteDialog from './RevokeInviteDialog';

const meta = {
  title: 'Admin/RevokeInviteDialog',
  component: RevokeInviteDialog,
} satisfies Meta<typeof RevokeInviteDialog>;

export default meta;

export const Default: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {}, memberId: 'u-1', email: 'member@example.com' },
};
