import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingPricing from './LandingPricing';

const meta: Meta<typeof LandingPricing> = {
  title: 'landing/LandingPricing',
  component: LandingPricing,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingPricing>;

/** Three plans; the middle one carries the ribbon and the solid CTA. */
export const Default: Story = {};
