import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '@repo/ui/input';
import { Label } from '@repo/ui/label';
import ListFilterPopover from './ListFilterPopover';

const meta: Meta<typeof ListFilterPopover> = {
  title: 'shared/ListFilterPopover',
  component: ListFilterPopover,
  args: {
    labels: {
      trigger: 'Filters',
      heading: 'Narrow the list',
      clear: 'Clear',
      activeCount: '2 active filters',
    },
    activeCount: 0,
    children: (
      <div className="space-y-1.5">
        <Label htmlFor="story-filter">Stanowisko</Label>
        <Input id="story-filter" placeholder="Ksiegowa" />
      </div>
    ),
  },
};

export default meta;

type Story = StoryObj<typeof ListFilterPopover>;

export const Default: Story = {};

/** The badge is what tells a user a collapsed panel is still narrowing the list. */
export const WithActiveFilters: Story = {
  args: { activeCount: 2, onClear: () => undefined },
};
