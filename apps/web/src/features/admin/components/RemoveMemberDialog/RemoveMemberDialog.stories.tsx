import type { Meta, StoryObj } from '@storybook/react-vite';
import RemoveMemberDialog from './RemoveMemberDialog';

const meta = {
  title: 'Admin/RemoveMemberDialog',
  component: RemoveMemberDialog,
} satisfies Meta<typeof RemoveMemberDialog>;

export default meta;

export const Default: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {}, memberId: 'u-1', email: 'member@example.com' },
};
