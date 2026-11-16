import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingSteps from './LandingSteps';

const meta: Meta<typeof LandingSteps> = {
  title: 'landing/LandingSteps',
  component: LandingSteps,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingSteps>;

/** Sticky-feeling split: heading column on the left, ordered steps on the right. */
export const Default: Story = {};
