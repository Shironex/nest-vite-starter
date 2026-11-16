import type { Meta, StoryObj } from '@storybook/react-vite';
import PasswordStrength from './PasswordStrength';

const meta: Meta<typeof PasswordStrength> = {
  title: 'shared/PasswordStrength',
  component: PasswordStrength,
  args: { password: '' },
};

export default meta;

type Story = StoryObj<typeof PasswordStrength>;

export const Empty: Story = { args: { password: '' } };
export const PartiallyMet: Story = { args: { password: 'abcdefgh' } };
export const AllMet: Story = { args: { password: 'Abcdef1!' } };
