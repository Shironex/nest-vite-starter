'use client';

import * as React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/lib/utils';

/**
 * The list footer: a range summary on the left, previous / next on the right.
 *
 * ONE MODE, BECAUSE THERE IS ONLY ONE PAGINATION MODEL LEFT. Every list in this
 * app pages by keyset cursor: it asks for `limit + 1` rows and lets the extra
 * row answer "is there another page" without a COUNT. A cursor names a row
 * rather than a position, so there is no way to ASK for page 7, and numbered
 * buttons would be controls nothing can honor.
 *
 * This component used to carry a second `mode="pages"` for one list,
 * which paged by OFFSET so the design's numbered buttons had something to ask
 * for. That arm is gone: the offset carried real drift (a row inserted above
 * the reader between two clicks repeated one row, a delete hid one) and its
 * footer re-counted the whole predicate on every page. Nothing renders numbered
 * pages any more, so nothing here draws them.
 *
 * THE TOTAL IS NOT LOST WITH THE BUTTONS. It rides the summary, which is a
 * string the caller formats: "Showing 1-25 of 312" is exactly as honest
 * beside prev/next as it was beside page buttons, and the lists that can afford
 * a count still state it. `hasNext` comes from the response's `nextCursor` and
 * `hasPrevious` from the caller's stack of visited cursors.
 *
 * EVERY STRING IS A PROP. This package carries no copy of its own, and the
 * summary is a sentence with numbers in it, so the consumer formats it and
 * passes it in.
 */

interface IPaginationLabels {
  /**
   * The whole summary sentence, already formatted. Word order and
   * pluralization are the caller's job: "Showing 1-10 of 135 people".
   */
  summary: React.ReactNode;
  /** Accessible name for the nav landmark, e.g. "People list pagination". */
  label: string;
  /** Accessible name for the previous control. */
  previous: string;
  /** Accessible name for the next control. */
  next: string;
}

interface IPaginationProps extends Omit<React.ComponentProps<'nav'>, 'onChange'> {
  labels: IPaginationLabels;
  /** Disables every control, for the moment a page is in flight. */
  isBusy?: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

const SUMMARY_CLASS = 'type-body-regular text-text-muted';

function Pagination({
  labels,
  isBusy = false,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  className,
  ...navProps
}: IPaginationProps) {
  return (
    <nav
      data-slot="pagination"
      aria-label={labels.label}
      className={cn('flex w-full flex-wrap items-center justify-between gap-3', className)}
      {...navProps}
    >
      <p data-slot="pagination-summary" className={SUMMARY_CLASS}>
        {labels.summary}
      </p>
      <div data-slot="pagination-controls" className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={labels.previous}
          disabled={isBusy || !hasPrevious}
          onClick={onPrevious}
        >
          <ChevronLeftIcon />
          <span>{labels.previous}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={labels.next}
          disabled={isBusy || !hasNext}
          onClick={onNext}
        >
          <span>{labels.next}</span>
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  );
}

export { Pagination, type IPaginationLabels, type IPaginationProps };
