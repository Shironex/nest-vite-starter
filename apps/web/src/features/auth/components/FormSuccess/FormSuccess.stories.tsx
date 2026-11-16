import type { Meta, StoryObj } from '@storybook/react-vite';
import FormSuccess from './FormSuccess';

const meta: Meta<typeof FormSuccess> = {
  title: 'auth/FormSuccess',
  component: FormSuccess,
  args: { children: 'Verification email sent! Please check your inbox.' },
};

export default meta;

type Story = StoryObj<typeof FormSuccess>;

export const Default: Story = {};
export const FullWidth: Story = { args: { className: 'w-full' } };
