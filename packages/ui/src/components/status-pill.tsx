import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@repo/ui/lib/utils';

/**
 * The state chip: a tinted pill, never a solid fill.
 *
 * WHY THIS EXISTS AND `Badge` DOES NOT COVER IT. `Badge` carries the shadcn
 * variants (`default`, `destructive`, ...), and `destructive` is a SOLID red.
 * The design draws a state as a tint of the state color with the state color
 * as the text, `bg-danger-bg text-danger`, not `bg-destructive text-white`.
 * Both treatments were in the app at once, on the SAME underlying record: the
 * records table drew a tinted pill while the agenda drew a solid
 * badge, and the two screens link to each other. This component is the one
 * definition they now share, so the vocabulary cannot fork a fourth time.
 *
 * Geometry matches `Badge` on purpose (same radius, padding and
 * `type-label-caption`), so a state pill and a neutral marker badge sitting in
 * the same row read as one family rather than two sizes of chip.
 */
const statusPillVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 type-label-caption [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      /**
       * Semantic state, not a color name. A consumer maps its own domain
       * states onto these four so the mapping is stated once, at the edge of
       * the domain, rather than as class strings scattered through the markup.
       *
       * `neutral` is the deliberate default: a state only takes a color when
       * it is worth reacting to. Everything else is stated, not alerted on.
       */
      tone: {
        neutral: 'bg-subtle text-text-secondary',
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger-bg text-danger',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

/**
 * The tone vocabulary, exported so a feature can type its own
 * `Record<DomainState, StatusTone>` map instead of widening to `string`.
 */
type StatusTone = NonNullable<VariantProps<typeof statusPillVariants>['tone']>;

interface IStatusPillProps
  extends React.ComponentProps<'span'>, VariantProps<typeof statusPillVariants> {}

function StatusPill({ className, tone = 'neutral', ...props }: IStatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      className={cn(statusPillVariants({ tone }), className)}
      {...props}
    />
  );
}

export { StatusPill, statusPillVariants, type IStatusPillProps, type StatusTone };
