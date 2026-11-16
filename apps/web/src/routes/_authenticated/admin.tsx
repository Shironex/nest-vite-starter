import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { ROLES } from '@repo/shared/permissions';
import { Button } from '@repo/ui/button';
import { PageSkeleton } from '@repo/ui/page-skeleton';
import { pageTitle } from '@/lib/page-title';
import { trpc } from '@/lib/trpc';
import { USER_ME_STALE_TIME } from '@/hooks/use-auth';
import { AuditLogSection } from '@/features/admin/components/AuditLogSection';
import { UsersSection } from '@/features/admin/components/UsersSection';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings } from '@/lib/strings';

/**
 * ADMIN-only: the users table, then the read-only audit list.
 *
 * The guard is a courtesy that keeps a USER from landing on a screen whose
 * every query would 403; it is NOT the control. Every procedure behind this
 * page carries `AdminMiddleware`, and that server check is what protects it.
 *
 * `_authenticated` has already primed `user.me`, so reading it from the cache
 * here is a cache hit rather than a second request.
 *
 * There is no `<h1>` here: the app shell's topbar renders the page title for
 * every route and that line IS the document heading.
 */
export const Route = createFileRoute('/_authenticated/admin')({
  head: () => pageTitle(commonStrings.pageTitle.admin),
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
  component: AdminRoute,
  pendingComponent: AdminPending,
  errorComponent: AdminError,
});

function AdminRoute() {
  return (
    <div className="space-y-10">
      <UsersSection />
      <AuditLogSection />
    </div>
  );
}

/** The same silhouette the router default uses for a list surface. */
function AdminPending() {
  return <PageSkeleton variant="list" label={commonStrings.states.loading} />;
}

function AdminError({ reset }: { reset: () => void }) {
  const router = useRouter();

  return (
    <div className="space-y-3" role="alert">
      <p className="type-body-regular text-danger">{adminStrings.page.loadError}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // reset alone only clears the boundary against the same errored
          // match; the match stays in status 'error' and rethrows on the next
          // render. invalidate re-runs beforeLoad, which is the real retry
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
