import type { Meta, StoryObj } from '@storybook/react-vite';
import { RelativeTime } from './relative-time';

const meta = {
  title: 'Components/RelativeTime',
  component: RelativeTime,
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const minutesAgo = new Date(Date.now() - 5 * 60000);
    return (
      <div className="p-8">
        <p className="text-sm">
          Last updated: <RelativeTime date={minutesAgo} />
        </p>
      </div>
    );
  },
};

export const Various: Story = {
  render: () => {
    const now = new Date();
    const secondsAgo = new Date(now.getTime() - 30000);
    const minutesAgo = new Date(now.getTime() - 15 * 60000);
    const hoursAgo = new Date(now.getTime() - 3 * 60 * 60000);
    const daysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60000);
    const monthsAgo = new Date(now.getTime() - 2 * 30 * 24 * 60 * 60000);

    return (
      <div className="space-y-4 p-8">
        <div className="space-y-3">
          <p className="text-sm">
            30 seconds ago: <RelativeTime date={secondsAgo} />
          </p>
          <p className="text-sm">
            15 minutes ago: <RelativeTime date={minutesAgo} />
          </p>
          <p className="text-sm">
            3 hours ago: <RelativeTime date={hoursAgo} />
          </p>
          <p className="text-sm">
            5 days ago: <RelativeTime date={daysAgo} />
          </p>
          <p className="text-sm">
            2 months ago: <RelativeTime date={monthsAgo} />
          </p>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Hover over the times to see the full date and time
        </p>
      </div>
    );
  },
};
