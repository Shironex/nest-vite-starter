import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColumnsIcon, DownloadIcon, FilterIcon, PlusIcon, SearchIcon } from 'lucide-react';

import { Avatar, AvatarFallback } from './avatar';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';
import { Pagination } from './pagination';
import { Skeleton } from './skeleton';
import { StatusPill } from './status-pill';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import {
  ListSurface,
  ListSurfaceFooter,
  ListTab,
  ListTabPanel,
  ListTabs,
  ListTabsActions,
  ListTabsList,
  ListTabsRow,
  ListToolbar,
  ListToolbarActions,
  ListToolbarSearch,
} from './list-surface';

/**
 * The one list surface, from the design's list screen.
 *
 * Every list screen in the staff app converges on this: underline tabs with
 * count badges and the page actions on the same row, a toolbar with search on
 * the left and Filters/Columns on the right, the table, and a footer carrying a
 * range summary and a pager.
 *
 * The page title and its count subtitle are deliberately absent. The shell
 * topbar owns the heading, and a page publishes into it.
 */
const meta = {
  title: 'Components/ListSurface',
  component: ListSurface,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The card around a table: one wrapper, one head treatment, and loading / empty / error states that REPLACE the table rather than sitting under a bare header row.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

interface IRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  contract: string;
  role: string;
  rate: string;
  status: 'Active' | 'Onboarding' | 'Ended';
}

const rows: IRow[] = [
  {
    id: '1',
    name: 'Alex Morgan',
    email: 'alex.morgan@example.com',
    phone: '+1 555-0101',
    contract: 'Full-time',
    role: 'Product Designer',
    rate: '$8,500',
    status: 'Active',
  },
  {
    id: '2',
    name: 'Sam Rivera',
    email: 'sam.rivera@example.com',
    phone: '+1 555-0102',
    contract: 'Contractor',
    role: 'Frontend Engineer',
    rate: '$45/h',
    status: 'Onboarding',
  },
  {
    id: '3',
    name: 'Jordan Lee',
    email: 'jordan.lee@example.com',
    phone: '+1 555-0103',
    contract: 'Full-time',
    role: 'Support Specialist',
    rate: '$7,200',
    status: 'Active',
  },
  {
    id: '4',
    name: 'Taylor Brooks',
    email: 'taylor.brooks@example.com',
    phone: '+1 555-0104',
    contract: 'Contractor',
    role: 'IT Support',
    rate: '$10,000',
    status: 'Ended',
  },
];

const TONE: Record<IRow['status'], 'success' | 'neutral'> = {
  Active: 'success',
  Onboarding: 'neutral',
  Ended: 'neutral',
};

const HEADS = ['Person', 'Phone', 'Contract', 'Position', 'Rate', 'Status'];

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('');
}

function MemberTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {HEADS.map((head) => (
            <TableHead key={head}>{head}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <span className="flex items-center gap-3">
                <Avatar className="size-8">
                  <AvatarFallback>{initials(row.name)}</AvatarFallback>
                </Avatar>
                <span className="flex flex-col">
                  <span className="type-body-strong text-text">{row.name}</span>
                  <span className="type-label-caption text-text-muted">{row.email}</span>
                </span>
              </span>
            </TableCell>
            <TableCell className="text-text-secondary">{row.phone}</TableCell>
            <TableCell>
              <Badge variant="secondary">{row.contract}</Badge>
            </TableCell>
            <TableCell className="text-text-secondary">{row.role}</TableCell>
            <TableCell className="text-text-secondary">{row.rate}</TableCell>
            <TableCell>
              <StatusPill tone={TONE[row.status]}>{row.status}</StatusPill>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SkeletonRows() {
  return (
    <div className="flex w-full flex-col gap-3">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

const footer = (
  <ListSurfaceFooter>
    <Pagination
      hasPrevious={false}
      hasNext
      onPrevious={() => undefined}
      onNext={() => undefined}
      labels={{
        label: 'People list pagination',
        previous: 'Previous',
        next: 'Next',
        summary: 'Showing 1-25 of 312 people',
      }}
    />
  </ListSurfaceFooter>
);

/** The whole screen: tabs, toolbar, table, footer. */
export const FullScreen: Story = {
  render: function FullScreenStory() {
    const [tab, setTab] = React.useState('all');

    return (
      <ListTabs value={tab} onValueChange={setTab}>
        <ListTabsRow>
          <ListTabsList>
            <ListTab value="all" count={135}>
              All
            </ListTab>
            <ListTab value="active" count={94}>
              Current
            </ListTab>
            <ListTab value="onboarding" count={19}>
              Onboarding
            </ListTab>
            <ListTab value="ended" count={22}>
              Ended
            </ListTab>
            <ListTab value="attention" count={21}>
              Needs attention
            </ListTab>
          </ListTabsList>
          <ListTabsActions>
            <Button variant="ghost" size="sm">
              <DownloadIcon />
              Export
            </Button>
            <Button variant="outline" size="sm">
              Import
            </Button>
            <Button size="sm">
              <PlusIcon />
              New person
            </Button>
          </ListTabsActions>
        </ListTabsRow>

        <ListTabPanel value={tab}>
          <ListToolbar>
            <ListToolbarSearch>
              <span className="relative w-full">
                <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-placeholder" />
                <Input placeholder="Search people..." className="pl-9" />
              </span>
              <Button variant="outline" size="sm">
                <FilterIcon />
                Filters
              </Button>
            </ListToolbarSearch>
            <ListToolbarActions>
              <Button variant="ghost" size="sm">
                <ColumnsIcon />
                Columns
              </Button>
            </ListToolbarActions>
          </ListToolbar>

          <ListSurface footer={footer}>
            <MemberTable />
          </ListSurface>
        </ListTabPanel>
      </ListTabs>
    );
  },
};

/** Just the card. */
export const Ready: Story = {
  render: () => (
    <ListSurface footer={footer}>
      <MemberTable />
    </ListSurface>
  ),
};

/** Loading REPLACES the table, so no header row floats over nothing. */
export const Loading: Story = {
  render: () => (
    <ListSurface state="loading" loading={<SkeletonRows />} footer={footer}>
      <MemberTable />
    </ListSurface>
  ),
};

export const Empty: Story = {
  render: () => (
    <ListSurface
      state="empty"
      empty={
        <>
          <p className="type-body-strong text-text">No people</p>
          <p className="type-body-regular text-text-muted">
            Change the filters or add the first person.
          </p>
          <Button size="sm" className="mt-2">
            <PlusIcon />
            New person
          </Button>
        </>
      }
      footer={footer}
    >
      <MemberTable />
    </ListSurface>
  ),
};

export const Errored: Story = {
  render: () => (
    <ListSurface
      state="error"
      error={
        <>
          <p className="type-body-strong text-text">The list could not be loaded</p>
          <Button variant="outline" size="sm" className="mt-2">
            Try again
          </Button>
        </>
      }
    >
      <MemberTable />
    </ListSurface>
  ),
};

/** A list that refuses to pay for a count: the same footer, no total in it. */
export const WithoutTotal: Story = {
  render: () => (
    <ListSurface
      footer={
        <ListSurfaceFooter>
          <Pagination
            hasPrevious={false}
            hasNext
            onPrevious={() => undefined}
            onNext={() => undefined}
            labels={{
              label: 'Audit log pagination',
              previous: 'Previous',
              next: 'Next',
              summary: 'Showing 1-4',
            }}
          />
        </ListSurfaceFooter>
      }
    >
      <MemberTable />
    </ListSurface>
  ),
};
