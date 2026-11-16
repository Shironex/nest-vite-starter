import type { Meta, StoryObj } from '@storybook/react-vite';
import HelpToursSection from './HelpToursSection';

/**
 * The section reads the tour-progress query and the router, so a meaningful
 * story would have to stand up both. It is shown here as the settings rail
 * renders it: one card carrying the tour table and the reset control.
 */
const meta: Meta<typeof HelpToursSection> = {
  title: 'help/HelpToursSection',
  component: HelpToursSection,
};

export default meta;

type Story = StoryObj<typeof HelpToursSection>;

export const Default: Story = {};
