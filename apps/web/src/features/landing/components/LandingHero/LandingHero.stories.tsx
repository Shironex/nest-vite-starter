import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingHero from './LandingHero';

const meta: Meta<typeof LandingHero> = {
  title: 'landing/LandingHero',
  component: LandingHero,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingHero>;

/** Two-column split: copy on the left, product mock on the right. */
export const Default: Story = {};

/** The columns stack and the mock drops its last roster row. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
