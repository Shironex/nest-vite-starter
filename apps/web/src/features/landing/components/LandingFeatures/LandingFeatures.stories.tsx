import type { Meta, StoryObj } from '@storybook/react-vite';
import LandingFeatures from './LandingFeatures';

const meta: Meta<typeof LandingFeatures> = {
  title: 'landing/LandingFeatures',
  component: LandingFeatures,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof LandingFeatures>;

/**
 * Three columns on desktop. The first cell carries the brand tint and the last
 * is the inverted signature cell.
 */
export const Default: Story = {};

/** Under `.dark` the signature cell inverts to a light card on a dark page. */
export const Dark: Story = {
  globals: { theme: 'dark' },
};
