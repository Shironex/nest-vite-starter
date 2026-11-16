import type { Meta, StoryObj } from '@storybook/react-vite';
import NotificationItem from './NotificationItem';

const meta: Meta<typeof NotificationItem> = {
  title: 'notifications/NotificationItem',
  component: NotificationItem,
  args: {
    notification: {
      id: 'story-1',
      type: 'info',
      title: 'System update',
      message: 'A new version is available.',
      createdAt: '2023-11-14T22:13:20.000Z',
      read: false,
    },
  },
};

export default meta;

type Story = StoryObj<typeof NotificationItem>;

export const Unread: Story = {};

export const Read: Story = {
  args: {
    notification: {
      id: 'story-2',
      type: 'success',
      title: 'Export complete',
      message: 'Your report has been exported successfully.',
      createdAt: '2023-11-14T22:13:20.000Z',
      read: true,
    },
  },
};

export const Warning: Story = {
  args: {
    notification: {
      id: 'story-3',
      type: 'warning',
      title: 'Low disk space',
      message: 'Less than 1 GB of disk space remaining.',
      createdAt: '2023-11-14T22:13:20.000Z',
      read: false,
    },
  },
};

export const Error: Story = {
  args: {
    notification: {
      id: 'story-4',
      type: 'error',
      title: 'Connection failed',
      message: 'Unable to reach the server. Retrying...',
      createdAt: '2023-11-14T22:13:20.000Z',
      read: false,
    },
  },
};
