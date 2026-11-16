import type { Meta, StoryObj } from '@storybook/react-vite';
import TourLauncher from './TourLauncher';

/**
 * The launcher reads the router and the tour-progress query, so a meaningful
 * story would have to stand up both. It is shown here as the shell renders it:
 * one ghost icon button in a topbar row.
 */
const meta: Meta<typeof TourLauncher> = {
  title: 'help/TourLauncher',
  component: TourLauncher,
};

export default meta;

type Story = StoryObj<typeof TourLauncher>;

export const Default: Story = {};
