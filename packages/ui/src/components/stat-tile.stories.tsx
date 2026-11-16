import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlertTriangle, CalendarClock, FileText, Inbox, TrendingUp, Users } from 'lucide-react';
import { StatTile } from './stat-tile';

// Annotated rather than `satisfies`, because the decorators below make the
// inferred meta type unnameable outside this file and tsc rejects it (TS2742).
/**
 * The stat tile the dashboard repeats, built on the design's stat cards
 * (`16:52`, `16:66`, `16:78`, `16:93`).
 *
 * The figure uses `type-stat-figure`, the 28px Instrument Sans Bold utility
 * added alongside this component. Before it existed the dashboard re-skin set
 * these figures in `type-display-large`, which is 32px Bricolage Grotesque.
 */
const meta: Meta<typeof StatTile> = {
  title: 'Components/StatTile',
  component: StatTile,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Icon chip, figure, label and an optional link or trailing action. Chrome comes from Card, so the tile follows the shared card radius, border and elevation.',
      },
    },
  },
  argTypes: {
    tone: {
      control: 'select',
      options: ['default', 'warning', 'danger'],
      description: 'Colors the figure only. The chip stays brand tinted in every tone.',
    },
    loading: { control: 'boolean' },
  },
  decorators: [
    (Story) => (
      <div className="w-[273px] bg-bg p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof StatTile>;

/** The tile as the design draws it: 273px wide, chip top right, figure below. */
export const Default: Story = {
  args: {
    label: 'Active members',
    value: 94,
    icon: <Users />,
  },
};

/**
 * The four dashboard tiles from the design, at the widths the design
 * uses. Every chip is brand tinted, including the one whose figure needs
 * attention, which is why `tone` colors the figure and not the chip.
 */
export const DashboardRow: Story = {
  decorators: [
    (Story) => (
      <div className="w-[1140px] bg-bg p-4">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="grid grid-cols-4 gap-4">
      <StatTile label="Active members" value={94} icon={<Users />} />
      <StatTile label="Pending requests" value={12} icon={<Inbox />} />
      <StatTile label="Contracts up for renewal" value={3} icon={<FileText />} tone="warning" />
      <StatTile label="Attendance" value="97.4%" icon={<TrendingUp />} />
    </div>
  ),
};

/** Tone colors the figure. Default, warning and danger, side by side. */
export const Tones: Story = {
  decorators: [
    (Story) => (
      <div className="w-[860px] bg-bg p-4">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="grid grid-cols-3 gap-4">
      <StatTile label="Upcoming" value={7} icon={<CalendarClock />} />
      <StatTile label="Contracts up for renewal" value={3} icon={<FileText />} tone="warning" />
      <StatTile label="Overdue" value={2} icon={<AlertTriangle />} tone="danger" />
    </div>
  ),
};

/**
 * A zero count renders as "0". This is the state that usually disappears,
 * because `{count && ...}` hides it, so the tile takes the figure as a value
 * rather than deciding for itself whether there is anything worth showing.
 *
 * Note that zero is not automatically calm, either: whether a zero is good news
 * is the consumer's call, so tone stays explicit. Here "Overdue 0" is the
 * all-clear and keeps the default tone.
 */
export const ZeroCount: Story = {
  args: {
    label: 'Overdue',
    value: 0,
    icon: <CalendarClock />,
  },
};

/**
 * Only the figure is skeletoned. The label and the chip are static copy the
 * consumer already holds, so they stay put and the tile keeps its accessible
 * name while the query runs; `aria-busy` carries the pending state. The
 * skeleton is exactly as tall as the figure, so nothing below the tile moves
 * when the data lands.
 */
export const Loading: Story = {
  args: {
    label: 'Active members',
    value: 94,
    icon: <Users />,
    loading: true,
  },
};

/**
 * The footer slot takes a link or a trailing action. It is a slot rather than
 * an `href` because `@repo/ui` has no router dependency, so the consumer passes
 * its own `<Link>`; the anchor below stands in for one.
 */
export const WithFooterLink: Story = {
  args: {
    label: 'Upcoming deadlines',
    value: 5,
    icon: <CalendarClock />,
    footer: (
      <a
        href="#agenda"
        className="rounded-sm type-body-medium text-brand-ink underline-offset-4 hover:text-brand-ink-hover hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Open agenda
      </a>
    ),
  },
};

/**
 * An inline icon in the label, which is how a dashboard counter flags an overdue
 * count. `label` takes a node and the label row is a flex row, so this composes
 * without a second icon prop.
 */
export const LabelWithInlineIcon: Story = {
  args: {
    label: (
      <>
        <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
        <span className="truncate">Overdue</span>
      </>
    ),
    value: 2,
    tone: 'danger',
  },
};

/**
 * Without an icon the top row collapses to the label alone, which is the shape
 * a card uses for two figures side by side.
 */
export const WithoutIcon: Story = {
  args: {
    label: 'Upcoming',
    value: 7,
  },
};

/**
 * A label longer than the tile wraps, which is what the design label does, and
 * never pushes the chip out of the row. A consumer that wants one line instead
 * passes a truncating span, as the right hand tile does.
 */
export const LongLabel: Story = {
  decorators: [
    (Story) => (
      <div className="w-[570px] bg-bg p-4">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="grid grid-cols-2 items-start gap-4">
      <StatTile
        label="Contracts up for renewal in this billing quarter"
        value={3}
        icon={<FileText />}
        tone="warning"
      />
      <StatTile
        label={<span className="truncate">Contracts up for renewal in this billing quarter</span>}
        value={3}
        icon={<FileText />}
        tone="warning"
      />
    </div>
  ),
};
