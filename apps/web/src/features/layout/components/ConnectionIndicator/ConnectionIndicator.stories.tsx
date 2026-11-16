import type { Meta, StoryObj } from '@storybook/react-vite';
import ConnectionIndicator from './ConnectionIndicator';

const meta: Meta<typeof ConnectionIndicator> = {
  title: 'layout/ConnectionIndicator',
  component: ConnectionIndicator,
};

export default meta;

type Story = StoryObj<typeof ConnectionIndicator>;

/** Default state: the socket store starts as 'disconnected' until a connection is established. */
export const Default: Story = {};
