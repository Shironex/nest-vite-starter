import type { Meta, StoryObj } from '@storybook/react-vite';
import FormError from './FormError';

const meta: Meta<typeof FormError> = {
  title: 'auth/FormError',
  component: FormError,
  args: { children: 'Invalid email or password' },
};

export default meta;

type Story = StoryObj<typeof FormError>;

export const Default: Story = {};
export const FullWidth: Story = { args: { className: 'w-full' } };
