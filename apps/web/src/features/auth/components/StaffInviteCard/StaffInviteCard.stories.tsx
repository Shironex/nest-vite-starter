import type { Meta, StoryObj } from '@storybook/react-vite';
import StaffInviteCard from './StaffInviteCard';

const meta = {
  title: 'Auth/StaffInviteCard',
  component: StaffInviteCard,
} satisfies Meta<typeof StaffInviteCard>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
