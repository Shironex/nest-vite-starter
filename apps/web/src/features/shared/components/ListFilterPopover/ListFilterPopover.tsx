import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/popover';
import { useListFilterPopover } from './ListFilterPopover.hooks';
import type { IListFilterPopoverProps } from './ListFilterPopover.types';

/**
 * The toolbar's "Filters" control: one button that opens the surface's filters
 * in a panel.
 *
 * WHY THIS EXISTS. Every list screen has its own filter grammar: a workspace
 * picker on one, three pickers and a date range on the audit feed, a state
 * multi-select or a whole `<fieldset>` of type checkboxes on others. Left on the
 * page they are different shapes competing with the data. The design puts every
 * one of them behind this single button, and this component is that button.
 *
 * It owns WHERE filters live, not WHAT they are. Each surface passes its own
 * controls as children and its own copy as labels, because some screens read
 * their copy from a feature catalog while audit and settings read from
 * `common`.
 *
 * The count badge is the whole reason a collapsed panel is safe: a filtered
 * list that looks unfiltered is how a user concludes rows are missing.
 */

const TRIGGER_CLASS = 'shrink-0 gap-2';
const COUNT_CLASS =
  'inline-flex min-w-5 items-center justify-center rounded-full bg-brand-50 px-1.5 type-label-caption text-brand-ink';
const CONTENT_CLASS = 'flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4';
const HEADER_CLASS = 'flex items-center justify-between gap-2';

export default function ListFilterPopover(props: IListFilterPopoverProps) {
  const v = useListFilterPopover(props);
  const canClear = v.hasActiveFilters && props.onClear !== undefined;

  return (
    <Popover open={v.isOpen} onOpenChange={v.onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-slot="list-filter-popover-trigger"
          className={TRIGGER_CLASS}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          <span>{props.labels.trigger}</span>
          {v.hasActiveFilters && (
            <span className={COUNT_CLASS} aria-label={props.labels.activeCount}>
              {props.activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        data-slot="list-filter-popover"
        className={CONTENT_CLASS}
        // The panel holds form controls a user tabs through; a Radix popover
        // otherwise returns focus to the trigger the moment one of them opens
        // its own layer.
        collisionPadding={16}
      >
        <div className={HEADER_CLASS}>
          <p className="type-label-overline text-text-muted">{props.labels.heading}</p>
          {canClear && (
            <Button type="button" variant="ghost" size="sm" onClick={v.onClear}>
              {props.labels.clear}
            </Button>
          )}
        </div>

        {props.children}
      </PopoverContent>
    </Popover>
  );
}
