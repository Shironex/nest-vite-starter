import { Skeleton } from '@repo/ui/skeleton';
import { cn } from '@repo/ui/lib/utils';

/**
 * The content-region placeholder every shell shows while a route resolves.
 *
 * A shell that drops its sidebar and topbar for one centered spinner on a blank
 * page is indistinguishable from a failed load. Software people trust keeps its
 * frame and fills only the region that is actually changing, which is what this
 * fills it with.
 *
 * Deliberately a SHAPE rather than a gray box: a heading line, a toolbar row
 * and a rule of rows, which is the silhouette of every list surface in the
 * product. When the data lands, content replaces something the eye has already
 * parsed as a page.
 *
 * `variant` picks which silhouette. `list` is the default because most staff
 * routes are lists; `detail` is the two-column read view; `cards` is the
 * dashboard's tile grid.
 *
 * It carries `role="status"` and an accessible name so the wait is announced
 * once, and `aria-busy` so assistive tech treats the region as in flight.
 */

export type PageSkeletonVariant = 'list' | 'detail' | 'cards';

interface IPageSkeletonProps {
  readonly variant?: PageSkeletonVariant;
  /** Accessible name for the busy region, translated by the caller. */
  readonly label: string;
  readonly className?: string;
}

const listRows = [0, 1, 2, 3, 4, 5].map((row) => (
  <div
    key={row}
    className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0"
  >
    <Skeleton className="size-8 shrink-0 rounded-full" />
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Skeleton className="h-3.5 w-2/5" />
      <Skeleton className="h-3 w-1/4" />
    </div>
    <Skeleton className="hidden h-3.5 w-24 sm:block" />
    <Skeleton className="h-5 w-16 rounded-full" />
  </div>
));

const cardTiles = [0, 1, 2, 3].map((tile) => (
  <div key={tile} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
    <div className="flex items-start justify-between gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="size-8 rounded-md" />
    </div>
    <Skeleton className="h-8 w-16" />
    <Skeleton className="h-3 w-28" />
  </div>
));

const detailFields = [0, 1, 2, 3, 4, 5].map((field) => (
  <div key={field} className="flex flex-col gap-1.5">
    <Skeleton className="h-3 w-20" />
    <Skeleton className="h-4 w-3/4" />
  </div>
));

const listBody = (
  <>
    <div className="flex items-center justify-between gap-3">
      <Skeleton className="h-9 w-full max-w-72 rounded-md" />
      <div className="flex shrink-0 gap-2">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
    </div>
    <div className="overflow-hidden rounded-lg border border-border bg-surface">{listRows}</div>
  </>
);

const cardsBody = (
  <>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cardTiles}</div>
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="h-56 rounded-lg border border-border bg-surface p-5">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="h-56 rounded-lg border border-border bg-surface p-5">
        <Skeleton className="h-4 w-36" />
      </div>
    </div>
  </>
);

const detailBody = (
  <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
      <Skeleton className="h-4 w-40" />
      <div className="grid gap-5 sm:grid-cols-2">{detailFields}</div>
    </div>
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  </div>
);

const BODY: Record<PageSkeletonVariant, React.ReactNode> = {
  list: listBody,
  cards: cardsBody,
  detail: detailBody,
};

export function PageSkeleton({ variant = 'list', label, className }: IPageSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-slot="page-skeleton"
      className={cn('flex w-full flex-col gap-5', className)}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-72" />
      </div>
      {BODY[variant]}
    </div>
  );
}
