import type { Meta, StoryObj } from '@storybook/react-vite';
import InviteMemberDialog from './InviteMemberDialog';

const meta = {
  title: 'Admin/InviteMemberDialog',
  component: InviteMemberDialog,
} satisfies Meta<typeof InviteMemberDialog>;

export default meta;

export const Default: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {} },
};
