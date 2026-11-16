import type { Meta, StoryObj } from '@storybook/react-vite';
import RegisterForm from './RegisterForm';

const meta: Meta<typeof RegisterForm> = {
  title: 'auth/RegisterForm',
  component: RegisterForm,
};

export default meta;

type Story = StoryObj<typeof RegisterForm>;

export const Default: Story = {};
