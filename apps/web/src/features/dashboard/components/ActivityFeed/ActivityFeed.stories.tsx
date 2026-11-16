import type { Meta, StoryObj } from '@storybook/react-vite';
import ActivityFeed from './ActivityFeed';

const meta: Meta<typeof ActivityFeed> = {
  title: 'dashboard/ActivityFeed',
  component: ActivityFeed,
};

export default meta;

type Story = StoryObj<typeof ActivityFeed>;

/**
 * Driven by notifications.list through the QueryClient decorator, which never
 * reaches a backend, so this renders the loading skeletons.
 */
export const Default: Story = {};
