import type { Meta, StoryObj } from '@storybook/react-vite';
import ForgotPasswordForm from './ForgotPasswordForm';

const meta: Meta<typeof ForgotPasswordForm> = {
  title: 'auth/ForgotPasswordForm',
  component: ForgotPasswordForm,
};

export default meta;

type Story = StoryObj<typeof ForgotPasswordForm>;

export const Default: Story = {};
