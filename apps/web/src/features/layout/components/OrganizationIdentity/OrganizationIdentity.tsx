import { NavRailFooter, NavRailIdentity } from '@repo/ui/nav-rail';
import { Skeleton } from '@repo/ui/skeleton';
import { useOrganizationIdentity } from './OrganizationIdentity.hooks';

/**
 * The sidebar footer's organization identity block.
 *
 * A LABEL, not a control: the design layer is named "Switcher" but wraps a
 * single tenant name with no membership model to switch between, so a
 * switcher affordance would promise something the data cannot do. No chevron, no
 * button, no interactive role. `NavRailIdentity` is the shared primitive, so any
 * other shell draws the same component.
 *
 * The footer always renders: a skeleton while `user.tenant`
 * is pending, the translated fallback name if it failed.
 */
export default function OrganizationIdentity() {
  const view = useOrganizationIdentity();

  return (
    <NavRailFooter>
      {view.status === 'pending' ? (
        <OrganizationIdentitySkeleton />
      ) : (
        <NavRailIdentity initial={view.initial} name={view.name} />
      )}
    </NavRailFooter>
  );
}

/**
 * Mirrors `NavRailIdentity`'s box: same row padding and gap, the 32px avatar
 * glyph, and a bar at the name's 14px/1.45 line height, so the footer keeps its
 * height when the name lands.
 */
function OrganizationIdentitySkeleton() {
  return (
    <div
      data-slot="organization-identity-skeleton"
      aria-hidden="true"
      className="flex min-w-0 items-center gap-2.5 px-1"
    >
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <Skeleton className="h-5 w-28" />
    </div>
  );
}
