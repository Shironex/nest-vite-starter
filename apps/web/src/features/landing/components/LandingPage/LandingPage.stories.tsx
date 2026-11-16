import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingPage from './LandingPage';

const meta: Meta<typeof LandingPage> = {
  title: 'landing/LandingPage',
  component: LandingPage,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingPage>;

/** The whole marketing page, top to bottom. */
export const Default: Story = {};
