import type { Meta, StoryObj } from '@storybook/react-vite';
import DashboardPage from './DashboardPage';

const meta: Meta<typeof DashboardPage> = {
  title: 'dashboard/DashboardPage',
  component: DashboardPage,
};

export default meta;

type Story = StoryObj<typeof DashboardPage>;

/** The whole landing page: the greeting and the activity feed. */
export const Default: Story = {};
