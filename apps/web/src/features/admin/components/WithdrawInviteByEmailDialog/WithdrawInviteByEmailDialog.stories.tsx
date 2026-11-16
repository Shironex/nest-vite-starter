import type { Meta, StoryObj } from '@storybook/react-vite';
import WithdrawInviteByEmailDialog from './WithdrawInviteByEmailDialog';

const meta = {
  title: 'Admin/WithdrawInviteByEmailDialog',
  component: WithdrawInviteByEmailDialog,
} satisfies Meta<typeof WithdrawInviteByEmailDialog>;

export default meta;

export const Default: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {} },
};
