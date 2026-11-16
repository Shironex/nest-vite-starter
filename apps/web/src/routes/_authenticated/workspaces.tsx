import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { PageSkeleton } from '@repo/ui/page-skeleton';
import { pageTitle } from '@/lib/page-title';
import { i18n } from '@/lib/i18n';
import { WorkspaceListPage } from '@/features/workspace/components/WorkspaceListPage';

/**
 * The workspaces of the caller's organization.
 *
 * No role guard, unlike `/audit`: `workspaces.list` is open to every staff account
 * (AuthMiddleware only), because every screen that picks a workspace already
 * reads it for its pickers. The write half is what is ADMIN-only, and the screen hides it for a
 * USER; `AdminMiddleware` on `workspaces.create` and `workspaces.update` is the control.
 */
export const Route = createFileRoute('/_authenticated/workspaces')({
  head: () => pageTitle('pageTitle.workspaces'),
  component: WorkspacesRoute,
  pendingComponent: WorkspacesPending,
  errorComponent: WorkspacesError,
});

function WorkspacesRoute() {
  return <WorkspaceListPage />;
}

/**
 * The shaped silhouette, not a stack of bars: the same `PageSkeleton` the
 * screen's own list placeholder hands over to (see `/audit`).
 */
function WorkspacesPending() {
  return <PageSkeleton variant="list" label={i18n.t('states.loading')} />;
}

function WorkspacesError({ reset }: { reset: () => void }) {
  const router = useRouter();
  const { t } = useTranslation('workspace');

  return (
    <div className="space-y-3" role="alert">
      <p className="type-body-regular text-danger">{t('list.loadError')}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // reset alone only clears the boundary against the same errored
          // match; the match stays in status 'error' and rethrows on the next
          // render. invalidate re-runs the match, which is the real retry
          // (convention from routes/_authenticated.tsx).
          reset();
          void router.invalidate();
        }}
      >
        {t('actions.retry', { ns: 'common' })}
      </Button>
    </div>
  );
}
