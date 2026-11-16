import type { Meta, StoryObj } from '@storybook/react-vite';
import UpdatesSection from './UpdatesSection';

const meta: Meta<typeof UpdatesSection> = {
  title: 'settings/UpdatesSection',
  component: UpdatesSection,
};

export default meta;

type Story = StoryObj<typeof UpdatesSection>;

/** Default state: the update store initializes with status 'idle' and channel 'stable'. */
export const Default: Story = {};
