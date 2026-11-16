import type { Meta, StoryObj } from '@storybook/react-vite';
import ResetPasswordForm from './ResetPasswordForm';

const meta: Meta<typeof ResetPasswordForm> = {
  title: 'auth/ResetPasswordForm',
  component: ResetPasswordForm,
};

export default meta;

type Story = StoryObj<typeof ResetPasswordForm>;

/** Reads the reset token from the route; renders inside the reset-password route. */
export const Default: Story = {};
