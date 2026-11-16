import type { Meta, StoryObj } from '@storybook/react-vite';
import LoginForm from './LoginForm';

const meta: Meta<typeof LoginForm> = {
  title: 'auth/LoginForm',
  component: LoginForm,
};

export default meta;

type Story = StoryObj<typeof LoginForm>;

/** Unauthenticated state: the mutation is idle and no server error is shown. */
export const Default: Story = {};
