import { cn } from '@repo/ui/lib/utils';

/**
 * `motion-reduce:animate-none!` because a pulse is still movement. The skeleton
 * stays visible and stops breathing, which is the point: it is a placeholder,
 * not an animation.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent motion-reduce:animate-none!', className)}
      {...props}
    />
  );
}

export { Skeleton };
