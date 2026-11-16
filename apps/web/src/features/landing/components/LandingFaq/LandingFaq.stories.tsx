import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingFaq from './LandingFaq';

const meta: Meta<typeof LandingFaq> = {
  title: 'landing/LandingFaq',
  component: LandingFaq,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingFaq>;

/** Single-open accordion; the first question starts expanded. */
export const Default: Story = {};
