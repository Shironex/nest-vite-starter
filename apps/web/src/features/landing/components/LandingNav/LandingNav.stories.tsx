import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingNav from './LandingNav';

const meta: Meta<typeof LandingNav> = {
  title: 'landing/LandingNav',
  component: LandingNav,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingNav>;

/** Desktop rendering: inline section links plus both auth CTAs. */
export const Default: Story = {};

/** Below `md` the links collapse behind the menu disclosure. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
