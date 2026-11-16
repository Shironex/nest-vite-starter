import { useState } from 'react';
import type { IListFilterPopoverProps, IListFilterPopoverView } from './ListFilterPopover.types';

/**
 * Open state for the filter panel, plus the one behavior worth encoding:
 * clearing closes.
 *
 * A user who presses "Clear" is asking to see the unfiltered list. Leaving
 * the panel open leaves it covering the rows that just appeared, which is the
 * opposite of what they asked for.
 */
export function useListFilterPopover({
  activeCount,
  onClear,
}: IListFilterPopoverProps): IListFilterPopoverView {
  const [isOpen, setOpen] = useState(false);

  return {
    isOpen,
    onOpenChange: setOpen,
    hasActiveFilters: activeCount > 0,
    onClear: () => {
      onClear?.();
      setOpen(false);
    },
  };
}
