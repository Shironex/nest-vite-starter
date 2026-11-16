import type { Meta, StoryObj } from '@storybook/react-vite';
import RestoreMemberDialog from './RestoreMemberDialog';

const meta = {
  title: 'Admin/RestoreMemberDialog',
  component: RestoreMemberDialog,
} satisfies Meta<typeof RestoreMemberDialog>;

export default meta;

export const Default: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {}, memberId: 'u-1', email: 'member@example.com' },
};
