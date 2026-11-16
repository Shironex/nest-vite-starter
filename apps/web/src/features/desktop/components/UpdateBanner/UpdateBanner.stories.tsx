import type { Meta, StoryObj } from '@storybook/react-vite';
import UpdateBanner from './UpdateBanner';

const meta: Meta<typeof UpdateBanner> = {
  title: 'desktop/UpdateBanner',
  component: UpdateBanner,
};

export default meta;

type Story = StoryObj<typeof UpdateBanner>;

/** Default state: renders nothing in web mode (IS_ELECTRON is false, hook returns null). */
export const Default: Story = {};
