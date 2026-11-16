import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingCta from './LandingCta';

const meta: Meta<typeof LandingCta> = {
  title: 'landing/LandingCta',
  component: LandingCta,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingCta>;

/** Brand band that closes the page; the CTA stacks below the copy on mobile. */
export const Default: Story = {};
