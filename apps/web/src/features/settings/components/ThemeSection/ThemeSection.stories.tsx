import type { Meta, StoryObj } from '@storybook/react-vite';
import ThemeSection from './ThemeSection';

const meta: Meta<typeof ThemeSection> = {
  title: 'settings/ThemeSection',
  component: ThemeSection,
};

export default meta;

type Story = StoryObj<typeof ThemeSection>;

/** Default state: the UI store initializes with the 'system' theme preference. */
export const Default: Story = {};
