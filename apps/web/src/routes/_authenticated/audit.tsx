import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { ROLES } from '@repo/shared/permissions';
import { Button } from '@repo/ui/button';
import { PageSkeleton } from '@repo/ui/page-skeleton';
import { pageTitle } from '@/lib/page-title';
import { trpc } from '@/lib/trpc';
import { USER_ME_STALE_TIME } from '@/hooks/use-auth';
import { AuditLogPage } from '@/features/audit/components/AuditLogPage';
import { commonStrings } from '@/lib/strings';
import { auditStrings } from '@/features/audit/Audit.strings';

/**
 * ADMIN-only audit trail ("Audit log").
 *
 * The guard is a courtesy that keeps a USER from landing on a screen whose
 * every query would 403; it is NOT the control. `audit.list` carries
 * `AdminMiddleware`, and that server check is what actually protects the
 * feed.
 *
 * `_authenticated` has already primed `user.me`, so reading it from the cache
 * here is a cache hit rather than a second request.
 */
export const Route = createFileRoute('/_authenticated/audit')({
  head: () => pageTitle(commonStrings.pageTitle.audit),
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData({
      ...trpc.user.me.queryOptions(),
      retry: false,
      staleTime: USER_ME_STALE_TIME,
    });
    if (user.role !== ROLES.ADMIN) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: AuditRoute,
  pendingComponent: AuditPending,
  errorComponent: AuditError,
});

function AuditRoute() {
  return <AuditLogPage />;
}

/**
 * The shaped silhouette, not a stack of bars.
 *
 * A route-level pending state is only ever followed by the screen's OWN
 * loading state (none of these routes has a loader; the data is fetched by
 * `useQuery` after mount), so what a reader watches is two placeholders in a
 * row. Making the first one the same `PageSkeleton` the router default and both
 * shells use means the two agree on the shape of what is coming, instead of
 * three gray bars handing over to a tab row and a table.
 */
function AuditPending() {
  return <PageSkeleton variant="list" label={commonStrings.states.loading} />;
}

function AuditError({ reset }: { reset: () => void }) {
  const router = useRouter();

  return (
    <div className="space-y-3" role="alert">
      <p className="type-body-regular text-danger">{auditStrings.list.loadError}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // reset alone only clears the boundary against the same errored
          // match; the match stays in status 'error' and rethrows on the next
          // render, so for any load-phase failure the button visibly does
          // nothing. invalidate re-runs beforeLoad, which is the real retry
          // (convention from routes/_authenticated.tsx).
          reset();
          void router.invalidate();
        }}
      >
        {commonStrings.actions.retry}
      </Button>
    </div>
  );
}
