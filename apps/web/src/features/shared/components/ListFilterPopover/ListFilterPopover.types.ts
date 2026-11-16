import type { ReactNode } from 'react';

export interface IListFilterPopoverLabels {
  /** The trigger's text, "Filters". */
  readonly trigger: string;
  /** Heading inside the panel, naming what is being narrowed. */
  readonly heading: string;
  /** The reset action, shown only while something is active. */
  readonly clear: string;
  /**
   * Accessible name for the active-filter count, formatted by the caller:
   * plural rules differ per language ("1 filter" / "2 filters") and that
   * cannot be assembled from fragments here.
   */
  readonly activeCount: string;
}

export interface IListFilterPopoverProps {
  /**
   * The surface's own filter controls. Every list has a different filter
   * grammar; what this component owns is WHERE they live, not what they are.
   */
  readonly children: ReactNode;
  readonly labels: IListFilterPopoverLabels;
  /**
   * How many filters are currently narrowing the list. Drives the count badge
   * on the trigger, which is the only thing that tells a user a collapsed
   * panel is doing something. Zero renders no badge.
   */
  readonly activeCount: number;
  /** Reset every filter. Omitted when the surface has nothing to reset. */
  readonly onClear?: (() => void) | undefined;
}

export interface IListFilterPopoverView {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly hasActiveFilters: boolean;
  /** Clears the filters and closes the panel, so the result is visible. */
  readonly onClear: () => void;
}
