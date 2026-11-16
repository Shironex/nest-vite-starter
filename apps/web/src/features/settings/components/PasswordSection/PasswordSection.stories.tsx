import type { Meta, StoryObj } from '@storybook/react-vite';
import PasswordSection from './PasswordSection';

const meta: Meta<typeof PasswordSection> = {
  title: 'settings/PasswordSection',
  component: PasswordSection,
};

export default meta;

type Story = StoryObj<typeof PasswordSection>;

export const Default: Story = {};
