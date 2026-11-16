import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingFooter from './LandingFooter';

const meta: Meta<typeof LandingFooter> = {
  title: 'landing/LandingFooter',
  component: LandingFooter,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingFooter>;

/** Wordmark and copyright on one side, section anchors on the other. */
export const Default: Story = {};
