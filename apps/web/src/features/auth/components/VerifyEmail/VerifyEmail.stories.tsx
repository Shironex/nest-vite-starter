import type { Meta, StoryObj } from '@storybook/react-vite';
import VerifyEmail from './VerifyEmail';

const meta: Meta<typeof VerifyEmail> = {
  title: 'auth/VerifyEmail',
  component: VerifyEmail,
};

export default meta;

type Story = StoryObj<typeof VerifyEmail>;

/** Reads the optional verify token from the route; renders inside the verify-email route. */
export const Default: Story = {};
