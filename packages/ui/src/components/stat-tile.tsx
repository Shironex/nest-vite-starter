import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@repo/ui/lib/utils';
import { Card } from '@repo/ui/card';
import { Skeleton } from '@repo/ui/skeleton';

/**
 * Colors the figure only.
 *
 * The design stat tiles keep the icon chip brand tinted in every state,
 * including the "needs attention" one, so tone deliberately does not touch the
 * chip. Deciding when a figure is alarming is the consumer's policy, not the
 * tile's: pass the tone you want rather than expecting the tile to infer one
 * from the value.
 */
const statFigureVariants = cva('type-stat-figure tabular-nums', {
  variants: {
    tone: {
      default: 'text-text',
      warning: 'text-warning',
      danger: 'text-danger',
    },
  },
  defaultVariants: {
    tone: 'default',
  },
});

interface IStatTileProps
  extends React.ComponentProps<typeof Card>, VariantProps<typeof statFigureVariants> {
  /** Short description of what the figure counts, e.g. "Active members". */
  label: React.ReactNode;
  /**
   * The figure itself.
   *
   * Typed as a number or string rather than a ReactNode so a count and its
   * formatting stay the only things that can land here. `0` renders as "0";
   * the tile never treats a zero count as "nothing to show", which is the
   * usual way an empty stat silently disappears.
   */
  value: number | string;
  /**
   * Icon for the chip in the top right, e.g. `<CalendarClock />`. Sized by the
   * tile unless the node already carries a `size-*` class. Omit it and the top
   * row collapses to the label alone.
   */
  icon?: React.ReactNode;
  /**
   * Renders a skeleton in place of the figure, at the exact height the figure
   * occupies, so a slow query resolves without moving anything below the tile.
   *
   * The label and the chip stay visible: they are static copy the consumer
   * already holds, not pending data, so hiding them would drop the tile's
   * accessible name for as long as the query runs. `aria-busy` carries the
   * pending state instead.
   */
  loading?: boolean;
  /**
   * Optional link or trailing action under the figure.
   *
   * A slot rather than an `href` on purpose: `@repo/ui` has no router
   * dependency and must not grow one, so the consumer passes its own `<Link>`.
   */
  footer?: React.ReactNode;
}

/**
 * The stat tile the design repeats across the dashboard: an icon chip, a
 * figure, a label, and an optional link or trailing action.
 *
 * Chrome comes from `Card` rather than being hand rolled, so the tile follows
 * the shared card radius, border and elevation. Note that the design draws
 * these tiles at a 14px radius while `rounded-xl` is 12px; that disagreement is
 * upstream and is deliberately not patched here, because the radius token is
 * shared by every card in the app.
 *
 * Padding (18px) and gap (14px) are the design values and are off the 4px ramp,
 * which is why they read as `p-4.5` and `gap-3.5`.
 */
function StatTile({
  className,
  label,
  value,
  icon,
  tone = 'default',
  loading = false,
  footer,
  ...props
}: IStatTileProps) {
  const labelId = React.useId();

  return (
    <Card
      data-slot="stat-tile"
      data-tone={tone}
      role="group"
      aria-labelledby={labelId}
      aria-busy={loading || undefined}
      className={cn('gap-3.5 p-4.5', className)}
      {...props}
    >
      <div className="flex items-center gap-2" data-slot="stat-tile-top">
        {/*
         * A flex row so an inline icon composes into the label without a second
         * prop, which is how a dashboard counter flags an overdue count. A plain
         * string label wraps, matching the break-word the design label uses.
         * `*:min-w-0` is what lets a consumer's own `truncate` span actually
         * shrink: flex items default to min-width:auto, so `truncate` alone
         * would overflow rather than ellipsize.
         */}
        <p
          id={labelId}
          data-slot="stat-tile-label"
          className="flex min-w-0 flex-1 items-center gap-1 type-label-caption text-text-muted *:min-w-0"
        >
          {label}
        </p>
        {icon && (
          <span
            aria-hidden="true"
            data-slot="stat-tile-icon"
            className="flex size-8.5 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-ink [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5"
          >
            {icon}
          </span>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-8.5 w-14" data-slot="stat-tile-value-skeleton" />
      ) : (
        <p data-slot="stat-tile-value" className={statFigureVariants({ tone })}>
          {value}
        </p>
      )}

      {footer && (
        <div data-slot="stat-tile-footer" className="flex items-center gap-1.5">
          {footer}
        </div>
      )}
    </Card>
  );
}

export { StatTile, statFigureVariants, type IStatTileProps };
