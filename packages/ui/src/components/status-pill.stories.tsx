import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusPill } from './status-pill';

/**
 * The state chip. One definition for every "what state is this record
 * in" pill in the app: the status columns of the list tables, the calendar
 * rows and the detail drawers all render it.
 *
 * Reach for `Badge` instead when the chip is a neutral MARKER rather than a
 * state ("Deferred", "Superseded") or when it needs the solid brand fill.
 */
const meta = {
  title: 'Components/StatusPill',
  component: StatusPill,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Tinted state chip: the state color as the text on a tint of the same color. Never a solid fill, which is what separates it from Badge variant="destructive".',
      },
    },
  },
  argTypes: {
    tone: {
      control: 'select',
      options: ['neutral', 'success', 'warning', 'danger'],
    },
  },
  args: {
    children: 'Overdue',
    tone: 'danger',
  },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Danger: Story = {};

export const Warning: Story = {
  args: { children: 'Expiring soon', tone: 'warning' },
};

export const Success: Story = {
  args: { children: 'Valid', tone: 'success' },
};

export const Neutral: Story = {
  args: { children: 'No expiry', tone: 'neutral' },
};

/** Every tone side by side, which is how the expiry states read in a list. */
export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill tone="danger">Overdue</StatusPill>
      <StatusPill tone="warning">Expiring soon</StatusPill>
      <StatusPill tone="success">Valid</StatusPill>
      <StatusPill tone="neutral">No expiry</StatusPill>
    </div>
  ),
};
