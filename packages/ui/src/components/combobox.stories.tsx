import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Combobox, type IComboboxOption } from './combobox';

/**
 * A picker with type-to-search.
 *
 * Reach for `Select` instead when the list is a bounded enum the user can read
 * at a glance (a theme, a status, a sort order). Reach for this when the user
 * has to FIND something: every user in a tenant, every workspace, the 74
 * audit event types. `searchPlaceholder` is required so the choice has to be
 * made deliberately.
 */
const meta = {
  title: 'Components/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Searchable picker. Supports grouped options, two-line items, a clear entry, and server-side filtering via `search` + `onSearchChange`.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const workspaces: IComboboxOption[] = [
  { value: 'alfa', label: 'Acme Robotics' },
  { value: 'beta', label: 'Beta Consulting Inc.' },
  { value: 'gamma', label: 'Gamma Logistics Corp.' },
  { value: 'delta', label: 'Delta Real Estate' },
  { value: 'epsilon', label: 'Epsilon Software House' },
];

const events: IComboboxOption[] = [
  {
    value: 'workspace.created',
    label: 'Workspace added',
    group: 'Workspaces',
  },
  {
    value: 'workspace.updated',
    label: 'Workspace details changed',
    group: 'Workspaces',
  },
  {
    value: 'workspace.archived',
    label: 'Workspace archived',
    group: 'Workspaces',
  },
  { value: 'user.invited', label: 'User invited', group: 'Users' },
  { value: 'user.role_changed', label: 'User role changed', group: 'Users' },
  { value: 'auth.login', label: 'Sign in', group: 'Access' },
  { value: 'auth.logout', label: 'Signed out', group: 'Access' },
];

const role: IComboboxOption[] = [
  {
    value: 'ADMIN',
    label: 'Administrator',
    description: 'Full access, including users and organization settings',
  },
  {
    value: 'MEMBER',
    label: 'Team member',
    description: 'Works with workspace data, without managing users',
  },
  {
    value: 'VIEWER',
    label: 'Viewer',
    description: 'Read only',
  },
];

const labels = {
  placeholder: 'Choose a workspace...',
  searchPlaceholder: 'Search workspaces...',
  emptyText: 'No workspaces found.',
};

function ComboboxDemo(props: Partial<React.ComponentProps<typeof Combobox>>) {
  const [value, setValue] = React.useState<string | null>(null);

  return (
    <div className="w-80">
      <Combobox
        options={workspaces}
        value={value}
        onValueChange={setValue}
        placeholder={labels.placeholder}
        searchPlaceholder={labels.searchPlaceholder}
        emptyText={labels.emptyText}
        {...props}
      />
    </div>
  );
}

/** The default: an unbounded list, filtered on the client. */
export const Default: Story = {
  render: () => <ComboboxDemo />,
};

/** With a clear entry, which is how a filter offers "all". */
export const Clearable: Story = {
  render: () => <ComboboxDemo clearLabel="All workspaces" />,
};

/** Grouped, as the audit event-type filter needs. */
export const Grouped: Story = {
  render: () => (
    <ComboboxDemo
      options={events}
      placeholder="Choose an event type..."
      searchPlaceholder="Search event types..."
      emptyText="No event type found."
      clearLabel="All events"
    />
  ),
};

/** Two-line items, for options that need a sentence of explanation. */
export const WithDescriptions: Story = {
  render: () => (
    <ComboboxDemo
      options={role}
      placeholder="Choose a role..."
      searchPlaceholder="Search roles..."
      emptyText="No role found."
    />
  ),
};

/** While the options are still being fetched. */
export const Loading: Story = {
  render: () => <ComboboxDemo options={[]} isLoading loadingText="Loading..." />,
};

export const Disabled: Story = {
  render: () => <ComboboxDemo disabled />,
};

/**
 * Server-side filtering. Supplying `onSearchChange` switches client filtering
 * off, so the options shown are exactly what the caller passed.
 */
export const ServerFiltered: Story = {
  render: function ServerFilteredStory() {
    const [value, setValue] = React.useState<string | null>(null);
    const [search, setSearch] = React.useState('');
    const options = workspaces.filter((option) =>
      option.label.toLowerCase().includes(search.toLowerCase()),
    );

    return (
      <div className="w-80">
        <Combobox
          options={options}
          value={value}
          onValueChange={setValue}
          search={search}
          onSearchChange={setSearch}
          placeholder={labels.placeholder}
          searchPlaceholder={labels.searchPlaceholder}
          emptyText={labels.emptyText}
        />
      </div>
    );
  },
};
