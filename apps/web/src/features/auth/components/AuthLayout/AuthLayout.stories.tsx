import type { Meta, StoryObj } from '@storybook/react-vite';
import AuthLayout from './AuthLayout';

const meta: Meta<typeof AuthLayout> = {
  title: 'auth/AuthLayout',
  component: AuthLayout,
  args: { children: <p>Form content goes here.</p> },
};

export default meta;

type Story = StoryObj<typeof AuthLayout>;

export const WithHeader: Story = {
  args: {
    title: 'Sign in',
    description: 'Enter your credentials to continue.',
  },
};

export const TitleOnly: Story = {
  args: {
    title: 'Create account',
  },
};

export const NoHeader: Story = {
  args: {},
};
