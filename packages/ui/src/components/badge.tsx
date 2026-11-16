import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@repo/ui/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 type-label-caption w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        /*
         * `bg-danger-strong text-danger-strong-fg`, NOT `bg-destructive
         * text-white`. `--destructive` is a shadcn leftover that holds the same
         * design variable as `--danger-strong`, and white on it measures 3.61:1
         * in Dark, an AA failure. `--danger-strong-fg` flips to a near-black ink
         * in Dark so the fill stays readable in both modes.
         *
         * This stays a SOLID fill on purpose: that is what separates a
         * destructive Badge from `StatusPill tone="danger"`, which is a tint.
         * The fill is also full strength in Dark, never faded with an alpha:
         * a translucent fill drags the ink's contrast down toward whatever page
         * is behind it, which is the same failure by another route.
         */
        destructive:
          'bg-danger-strong text-danger-strong-fg [a&]:hover:bg-danger-strong/90 focus-visible:ring-danger-strong/20 dark:focus-visible:ring-danger-strong/40',
        outline:
          'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
