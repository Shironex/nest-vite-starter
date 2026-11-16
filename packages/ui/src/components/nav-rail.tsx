import { Slot } from 'radix-ui';
import { cn } from '@repo/ui/lib/utils';

/**
 * The parts a navigation rail is made of.
 *
 * The brand lockup, the group label, the link treatment and the footer
 * identity block. Each is written exactly once, so a second shell built from
 * them cannot drift into a different active tint or quietly lose its logo.
 * What stays per-shell is the CONTAINER: the app shell wraps the `Sidebar`
 * primitive to get the icon rail, Cmd+B and the mobile off-canvas sheet, while
 * a simpler shell can use a plain always-visible column.
 *
 * Density is the one axis a shell may vary: identical tokens, identical type
 * scale, identical components. `comfortable` is the all-day app rail;
 * `relaxed` breathes more for an occasional visitor.
 *
 * It lives in `@repo/ui` rather than in `features/layout` because
 * `no-cross-feature-imports` would refuse another feature an import from
 * `layout`, and because a shared rail is design-system surface.
 */

export type NavRailDensity = 'comfortable' | 'relaxed';

const ITEM_DENSITY: Record<NavRailDensity, string> = {
  comfortable: 'gap-2.5 px-2.5 py-2',
  relaxed: 'gap-3 px-3 py-2.5',
};

const GROUP_LABEL_DENSITY: Record<NavRailDensity, string> = {
  comfortable: 'px-2.5 pt-3.5 pb-1.5',
  relaxed: 'px-3 pt-4 pb-2',
};

/**
 * The resting and selected treatment for one rail destination, written once.
 *
 * Selected is `brand-50` on `brand-ink`: the design token pair, and the one the
 * contrast checker asserts. It is the single definition on purpose, because the
 * failure mode of a second one is silent. `sidebar-accent` is a shadcn leftover
 * that resolves to a different tint, and a plausible-looking `brand-subtle` is
 * not a token at all, so Tailwind emits nothing for it and the selected row
 * paints no fill whatsoever.
 *
 * Selection is matched on `data-[active=true]` and `aria-current=page`, never
 * on a bare `data-active` presence check: the sidebar primitive renders
 * `data-active={isActive}`, which serializes a false to the literal string
 * "false" and leaves the ATTRIBUTE present on every row. A presence check
 * therefore paints the whole rail selected, which is exactly the class of bug
 * this file exists to stop being written twice.
 */
export function navRailItemClass(density: NavRailDensity = 'comfortable', className?: string) {
  return cn(
    'flex h-auto w-full items-center rounded-md type-body-medium text-text-secondary transition-colors',
    'hover:bg-hover hover:text-text',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    '[&>svg]:size-4.5 [&>svg]:shrink-0',
    ITEM_DENSITY[density],
    'data-[active=true]:bg-brand-50 data-[active=true]:type-body-strong data-[active=true]:text-brand-ink',
    'aria-[current=page]:bg-brand-50 aria-[current=page]:type-body-strong aria-[current=page]:text-brand-ink',
    className,
  );
}

interface INavRailBrandProps {
  /** Single glyph for the filled square, normally the product initial. */
  readonly mark: string;
  /** Full product or surface name, hidden when the app rail collapses. */
  readonly wordmark: string;
  /**
   * Optional second line naming the surface rather than the product, so a
   * shell that is one of several (an admin console, say) can say which one it is
   * without giving up the product's mark.
   */
  readonly caption?: string;
  /** Renders into a router `Link` when the lockup is a destination. */
  readonly asChild?: boolean;
  readonly className?: string;
}

/**
 * Brand square plus wordmark, at the `h-16` height both topbars use so the rail
 * and the topbar share a baseline.
 *
 * Every shell gets one: a rail without the brand reads as unfinished.
 */
export function NavRailBrand({
  mark,
  wordmark,
  caption,
  asChild = false,
  className,
  ...props
}: INavRailBrandProps & React.ComponentProps<'div'>) {
  const Comp = asChild ? Slot.Root : 'div';
  return (
    <Comp
      data-slot="nav-rail-brand"
      className={cn(
        'flex h-16 shrink-0 items-center gap-2.5 rounded-md px-4',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand type-display-wordmark text-brand-fg"
        >
          {mark}
        </span>
        <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
          <span className="truncate type-display-wordmark text-text">{wordmark}</span>
          {caption ? (
            <span className="truncate type-label-caption text-text-tertiary">{caption}</span>
          ) : null}
        </span>
      </span>
    </Comp>
  );
}

/**
 * The overline above a group of destinations.
 *
 * Deliberately NOT a heading. As an `<h2>` it would put an H2 ahead of the
 * topbar's H1 in DOM order on every screen and invert the document outline. A group label is a name for its list, so it is
 * associated by `aria-labelledby` from the `<ul>` instead, which is what a
 * screen reader actually announces when entering the group.
 */
export function navRailGroupLabelClass(
  density: NavRailDensity = 'comfortable',
  className?: string,
) {
  return cn(
    'h-auto type-label-overline text-text-tertiary',
    GROUP_LABEL_DENSITY[density],
    className,
  );
}

export function NavRailGroupLabel({
  density = 'comfortable',
  className,
  ...props
}: { readonly density?: NavRailDensity } & React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="nav-rail-group-label"
      className={navRailGroupLabelClass(density, className)}
      {...props}
    />
  );
}

/**
 * Footer identity block: who is signed in, and the action that ends it.
 *
 * The app shell keeps its account menu in the topbar next to the bell. A shell
 * with no topbar puts its person here, which answers the "whose device is
 * this" question a shared or borrowed machine raises.
 */
export function NavRailFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="nav-rail-footer"
      className={cn(
        'mt-auto flex shrink-0 flex-col gap-2 border-t border-border px-3 py-3',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  );
}

interface INavRailIdentityProps {
  /** Single glyph avatar, normally the first letter of the display name. */
  readonly initial: string;
  /** Which persona is signed in. Drawn as the strong line. */
  readonly name: string;
  /** Login address or secondary descriptor. Drawn muted underneath. */
  readonly detail?: string;
  readonly className?: string;
}

export function NavRailIdentity({ initial, name, detail, className }: INavRailIdentityProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5 px-1', className)}>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 type-body-strong text-brand-ink"
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate type-body-medium text-text">{name}</span>
        {detail ? (
          <span className="truncate type-label-caption text-text-tertiary">{detail}</span>
        ) : null}
      </span>
    </div>
  );
}
