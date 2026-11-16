import type { Meta, StoryObj } from '@storybook/react-vite';
import NotificationBell from './NotificationBell';

const meta: Meta<typeof NotificationBell> = {
  title: 'notifications/NotificationBell',
  component: NotificationBell,
};

export default meta;

type Story = StoryObj<typeof NotificationBell>;

/**
 * Empty state: the bell hydrates from `notifications.list` (the global
 * QueryClientProvider decorator supplies the query infrastructure); offline
 * in Storybook the query never resolves, so the dropdown shows the empty
 * message and no badge renders.
 */
export const Default: Story = {};
