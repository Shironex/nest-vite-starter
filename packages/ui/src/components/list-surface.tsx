'use client';

import * as React from 'react';
import { AnimatePresence, LazyMotion, m, useReducedMotion } from 'framer-motion';
import { Tabs as TabsPrimitive } from 'radix-ui';

import { MOTION_LAYOUT_CLASS, animationVariants } from '@repo/ui/animations';
import { cn } from '@repo/ui/lib/utils';

/**
 * The one list surface, from the design's list screen.
 *
 * WHY THIS EXISTS. Every list in the app already shared the seven `table.tsx`
 * primitives; nobody hand-rolled a `<table>`. The divergence was entirely in
 * the chrome AROUND the table: six different wrapper treatments, two radii,
 * five copies of the same "Load more" footer, and three different answers to
 * "what does an empty list look like", one of which left a bare header row
 * floating over nothing. This component owns that chrome so a screen only has
 * to supply rows.
 *
 * THE PIECES, top to bottom, matching the design:
 *
 * - `ListTabs` / `ListTab`: underline tabs carrying a count badge, with the
 *   page actions on the right of that same row rather than above it.
 * - `ListToolbar`: search on the left, filter and column controls on the
 *   right. Filters live behind a button; they are not sprayed across the page.
 * - `ListSurface`: the bordered card holding the table, and the state it is
 *   in.
 * - `ListSurfaceFooter`: the range summary and the pager. See `Pagination`.
 *
 * The page title and its count subtitle are NOT here. The shell topbar owns the
 * heading and a page publishes into it, so a page never renders its own `<h1>`.
 *
 * STATE IS A PROP. `state` decides what the card shows and it shows exactly one
 * thing: loading, empty and error REPLACE the table rather than sitting under a
 * still-rendered header row. That is the whole cure for the bare-header cases.
 */

type ListSurfaceState = 'ready' | 'loading' | 'empty' | 'error';

interface IListSurfaceProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  /** What the card is showing. Anything but `ready` replaces the table. */
  state?: ListSurfaceState;
  /** The table. Rendered only when `state` is `ready`. */
  children: React.ReactNode;
  /** Shown while `state` is `loading`. Skeleton rows, or a plain block. */
  loading?: React.ReactNode;
  /** Shown while `state` is `empty`. */
  empty?: React.ReactNode;
  /** Shown while `state` is `error`. */
  error?: React.ReactNode;
  /** The footer row: a range summary and a pager. Hidden while not `ready`. */
  footer?: React.ReactNode;
}

/**
 * `overflow-x-auto` on the scroller is the one wrapper treatment that survived
 * a narrow container, and `rounded-xl` is the design's `xl` and the majority
 * intent across the app. `overflow-hidden` on the card is what makes the top
 * row clip to the radius.
 */
const SURFACE_CLASS = 'overflow-hidden rounded-xl border border-border bg-surface';
const SCROLL_CLASS = 'w-full overflow-x-auto';
const PLACEHOLDER_CLASS = 'flex min-h-40 flex-col items-center justify-center gap-2 px-6 py-12';

function ListSurface({
  className,
  state = 'ready',
  children,
  loading,
  empty,
  error,
  footer,
  ...props
}: IListSurfaceProps) {
  const reduceMotion = useReducedMotion();
  const placeholder = pickPlaceholder(state, { loading, empty, error });
  const body =
    placeholder === null ? (
      <div className={SCROLL_CLASS}>{children}</div>
    ) : (
      <div className={PLACEHOLDER_CLASS} role="status">
        {placeholder}
      </div>
    );

  return (
    <div
      data-slot="list-surface"
      data-state={state}
      // The placeholder is already `role="status"`, but without aria-busy the
      // announcement is a status with no text next to unlabeled pulsing bars.
      // PageSkeleton and StatTile both set it; every list in both shells
      // inherited this one's silence.
      aria-busy={state === 'loading' || undefined}
      className={cn(SURFACE_CLASS, className)}
      {...props}
    >
      <ListSurfaceBody state={state} reduceMotion={reduceMotion ?? false}>
        {body}
      </ListSurfaceBody>
      {state === 'ready' && footer !== undefined ? footer : null}
    </div>
  );
}

interface IListSurfaceBodyProps {
  state: ListSurfaceState;
  reduceMotion: boolean;
  children: React.ReactNode;
}

/**
 * The skeleton-to-content crossfade, and the ONE place this package reaches for
 * framer-motion rather than a CSS class.
 *
 * The outgoing skeleton has to keep painting while the rows fade in, which
 * means animating an element React has already decided to unmount. CSS cannot
 * see that moment; `AnimatePresence` is what holds the node until its exit
 * finishes. `mode="wait"` so the two never overlap and the card never jumps to
 * the taller of the two heights mid-transition.
 *
 * `domAnimation` rather than `domMax`: it carries animations, variants and exit
 * and nothing else, which is roughly 5 kB gzipped against the full namespace's
 * ~35 kB. Layout animation, the expensive half, is deliberately not used
 * anywhere in this package.
 *
 * The feature set is loaded as a FUNCTION, which is what makes `LazyMotion`
 * lazy. Passing the imported `domAnimation` value makes the whole motion
 * runtime a static dependency of this module, so the 27 kB brotli it costs
 * rides with every list route (records, documents, audit, agenda, settings)
 * whether or not anything animates, and the wrapper saves nothing at all.
 */
const loadDomAnimation = () => import('framer-motion').then((mod) => mod.domAnimation);

function ListSurfaceBody({ state, reduceMotion, children }: IListSurfaceBodyProps) {
  if (reduceMotion) return <>{children}</>;

  return (
    <LazyMotion features={loadDomAnimation} strict>
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={state}
          variants={animationVariants.fadeIn}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {children}
        </m.div>
      </AnimatePresence>
    </LazyMotion>
  );
}

/**
 * `null` means "render the table". A state with no slot supplied falls through
 * to the table rather than to a blank card, so a consumer that forgets `empty`
 * gets the old behavior instead of an invisible list.
 */
function pickPlaceholder(
  state: ListSurfaceState,
  slots: Pick<IListSurfaceProps, 'loading' | 'empty' | 'error'>,
): React.ReactNode {
  if (state === 'loading') return slots.loading ?? null;
  if (state === 'empty') return slots.empty ?? null;
  if (state === 'error') return slots.error ?? null;
  return null;
}

/**
 * The footer strip: a range summary on the left, a pager on the right. Sits
 * inside the card above its bottom border, exactly as the design draws it.
 */
function ListSurfaceFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-surface-footer"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Search on the left, filter and column controls on the right.
 *
 * The single biggest consistency win available: some screens put filters on top
 * and some scattered loose selects through the page. One row, one place.
 */
function ListToolbar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-toolbar"
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
      {...props}
    />
  );
}

/** Left group of the toolbar: the search field, and nothing that is a filter. */
function ListToolbarSearch({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-toolbar-search"
      className={cn('flex min-w-0 flex-1 items-center gap-2 sm:max-w-xs', className)}
      {...props}
    />
  );
}

/** Right group of the toolbar: "Filters", "Columns", and anything of that kind. */
function ListToolbarActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-toolbar-actions"
      className={cn('flex shrink-0 items-center gap-2', className)}
      {...props}
    />
  );
}

/** Radix Tabs, so keyboard semantics and roving focus come for free. */
function ListTabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="list-tabs"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  );
}

/** The tab row: tabs on the left, page actions on the right, one bottom rule. */
function ListTabsRow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-tabs-row"
      className={cn(
        'flex flex-wrap items-end justify-between gap-3 border-b border-border',
        className,
      )}
      {...props}
    />
  );
}

/*
 * Written as literals in BOTH places on purpose. Tailwind finds utilities by
 * scanning source text, so a class assembled from these constants
 * (`w-(${INDICATOR_W})`) is never generated and the indicator silently
 * collapses to zero width. Keep INDICATOR_CLASS below in step with these names.
 */
const INDICATOR_X = '--list-tab-indicator-x';
const INDICATOR_W = '--list-tab-indicator-w';

/**
 * Measures the active tab and writes the underline's position and width onto
 * the list as custom properties.
 *
 * WHY CUSTOM PROPERTIES AND NOT STATE. The underline is one box that slides
 * between siblings, which needs a measurement, and a measurement that goes
 * through `useState` costs a second render on every tab change and trips
 * `react-hooks/set-state-in-effect`. Writing the two numbers straight onto the
 * element does the same job with no React work at all, and the transition that
 * animates them is plain CSS, so `prefers-reduced-motion` is handled by the
 * same `motion-reduce:transition-none` every other transition here carries.
 *
 * The alternative was framer-motion's `layoutId`, which needs the `domMax`
 * feature bundle. That is the expensive half of the library, bought for one
 * underline.
 */
function useTabIndicator(ref: React.RefObject<HTMLDivElement | null>): void {
  React.useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-slot="list-tab"][data-state="active"]');
      if (!active) {
        list.style.setProperty(INDICATOR_W, '0px');
        return;
      }
      list.style.setProperty(INDICATOR_X, `${active.offsetLeft - list.scrollLeft}px`);
      list.style.setProperty(INDICATOR_W, `${active.offsetWidth}px`);
    };

    measure();

    // `data-state` flips on the triggers, not on the list, hence `subtree`.
    const mutations = new MutationObserver(measure);
    mutations.observe(list, { attributes: true, attributeFilter: ['data-state'], subtree: true });
    const resizes = new ResizeObserver(measure);
    resizes.observe(list);
    list.addEventListener('scroll', measure, { passive: true });

    return () => {
      mutations.disconnect();
      resizes.disconnect();
      list.removeEventListener('scroll', measure);
    };
  }, [ref]);
}

const INDICATOR_CLASS = cn(
  'pointer-events-none absolute bottom-0 left-0 h-0.5 w-(--list-tab-indicator-w) translate-x-(--list-tab-indicator-x) rounded-full bg-brand-ink transition-[translate,width]',
  MOTION_LAYOUT_CLASS,
);

function ListTabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const ref = React.useRef<HTMLDivElement>(null);
  useTabIndicator(ref);

  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="list-tabs-list"
      className={cn('relative -mb-px flex min-w-0 items-center gap-1 overflow-x-auto', className)}
      {...props}
    >
      {children}
      <span data-slot="list-tabs-indicator" aria-hidden className={INDICATOR_CLASS} />
    </TabsPrimitive.List>
  );
}

/** Page actions, on the right of the tab row rather than stacked above it. */
function ListTabsActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-tabs-actions"
      className={cn('flex shrink-0 items-center gap-2 pb-2', className)}
      {...props}
    />
  );
}

interface IListTabProps extends React.ComponentProps<typeof TabsPrimitive.Trigger> {
  /**
   * How many records this tab holds, rendered as the design's badge. A zero is
   * rendered rather than hidden: "0 need attention" is the answer a user
   * came to the screen for.
   */
  count?: number;
}

const TAB_CLASS =
  'group/list-tab relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-2 pt-2 pb-3 type-body-medium text-text-secondary transition-colors outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:type-body-strong data-[state=active]:text-brand-ink';
const TAB_COUNT_CLASS =
  'rounded-full bg-subtle px-1.5 py-0.5 type-label-caption text-text-secondary transition-colors group-data-[state=active]/list-tab:bg-brand-50 group-data-[state=active]/list-tab:text-brand-ink';

function ListTab({ className, children, count, ...props }: IListTabProps) {
  return (
    <TabsPrimitive.Trigger data-slot="list-tab" className={cn(TAB_CLASS, className)} {...props}>
      <span>{children}</span>
      {count === undefined ? null : <span className={TAB_COUNT_CLASS}>{count}</span>}
    </TabsPrimitive.Trigger>
  );
}

/** The panel for one tab. Nothing but a pass-through, for a complete set. */
function ListTabPanel({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="list-tab-panel"
      // Radix gives Tabs.Content tabIndex={0}; without a focus-visible ring the
      // tab stop is invisible (see tabs.tsx).
      className={cn(
        'flex flex-col gap-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        className,
      )}
      {...props}
    />
  );
}

export {
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
  type IListSurfaceProps,
  type IListTabProps,
  type ListSurfaceState,
};
