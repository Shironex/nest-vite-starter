import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Pagination } from './pagination';

/**
 * The list footer, from the design's list screen.
 *
 * One model, because every list in the app pages by keyset cursor: it names a
 * row rather than a position, so there is no way to ask for page 7 and numbered
 * buttons would be controls nothing can honor. The design's numbered pager was
 * served by an OFFSET arm on one list; that arm is gone, and the total
 * it existed to spend now rides the summary instead.
 *
 * Every string is a prop: `@repo/ui` has no translation catalog, and the
 * summary is a sentence with numbers in it.
 */
const meta = {
  title: 'Components/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Range summary plus previous / next. The summary is formatted by the consumer, so a list that can afford a count states it ("z 312") and one that cannot (audit) simply does not.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const labels = {
  label: 'People list pagination',
  previous: 'Previous',
  next: 'Next',
  summary: '',
};

/** The design footer: 312 records, walked 25 at a time. */
export const WithTotal: Story = {
  render: function WithTotalStory() {
    const [offset, setOffset] = React.useState(0);
    const total = 312;
    const perPage = 25;
    const to = Math.min(offset + perPage, total);

    return (
      <div className="w-[46rem] rounded-xl border border-border bg-surface px-4 py-3">
        <Pagination
          hasPrevious={offset > 0}
          hasNext={to < total}
          onPrevious={() => setOffset(offset - perPage)}
          onNext={() => setOffset(offset + perPage)}
          labels={{
            ...labels,
            summary: `Showing ${offset + 1}-${to} of ${total} people`,
          }}
        />
      </div>
    );
  },
};

/** A single page still renders the summary, so the count never disappears. */
export const SinglePage: Story = {
  render: () => (
    <div className="w-[46rem] rounded-xl border border-border bg-surface px-4 py-3">
      <Pagination
        hasPrevious={false}
        hasNext={false}
        onPrevious={() => undefined}
        onNext={() => undefined}
        labels={{ ...labels, summary: 'Showing 1-7 of 7 people' }}
      />
    </div>
  ),
};

/**
 * A list that refuses to pay for a count states its position and nothing else.
 * `audit.list` is the one; the reason is on `auditLogListOutput`.
 */
export const WithoutTotal: Story = {
  render: () => (
    <div className="w-[46rem] rounded-xl border border-border bg-surface px-4 py-3">
      <Pagination
        hasPrevious
        hasNext
        onPrevious={() => undefined}
        onNext={() => undefined}
        labels={{
          ...labels,
          label: 'Audit log pagination',
          summary: 'Showing 26-50',
        }}
      />
    </div>
  ),
};

/** While a page is in flight. */
export const Busy: Story = {
  render: () => (
    <div className="w-[46rem] rounded-xl border border-border bg-surface px-4 py-3">
      <Pagination
        hasPrevious
        hasNext
        onPrevious={() => undefined}
        onNext={() => undefined}
        isBusy
        labels={{ ...labels, summary: 'Showing 76-100 of 312 people' }}
      />
    </div>
  ),
};
