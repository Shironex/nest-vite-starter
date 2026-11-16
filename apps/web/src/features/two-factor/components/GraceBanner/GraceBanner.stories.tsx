import type { Meta, StoryObj } from '@storybook/react-vite';
import GraceBanner from './GraceBanner';

const meta: Meta<typeof GraceBanner> = {
  title: 'two-factor/GraceBanner',
  component: GraceBanner,
};

export default meta;

type Story = StoryObj<typeof GraceBanner>;

/** Renders only when the tenant requires 2FA and grace is still running. */
export const Default: Story = {};
