import { createFileRoute, isRedirect, Outlet, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@repo/ui/spinner';
import { trpc } from '@/lib/trpc';
import { USER_ME_STALE_TIME } from '@/hooks/use-auth';
import { LOGIN_PATH, STAFF_HOME_PATH } from '@/lib/shell-routes';

function AuthPendingComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-brand-ink">
      <Spinner size="lg" label={t('states.loading')} />
    </div>
  );
}

export const Route = createFileRoute('/auth')({
  beforeLoad: async ({ context, location }) => {
    // If user is already authenticated, redirect to dashboard
    try {
      await context.queryClient.ensureQueryData({
        ...trpc.user.me.queryOptions(),
        retry: false,
        staleTime: USER_ME_STALE_TIME,
      });
      throw redirect({ to: STAFF_HOME_PATH });
    } catch (error) {
      // If it's a redirect, re-throw it
      if (isRedirect(error)) throw error;
      // If the query failed (not authenticated), let them through to auth pages
    }

    // `/auth` is a layout segment with no index child, so a bare visit paints an
    // empty Outlet: forward it to the sign-in screen. Placed after the block
    // above so an authenticated visitor still goes to the dashboard rather than
    // back to the login form.
    if (location.pathname === '/auth' || location.pathname === '/auth/') {
      throw redirect({ to: LOGIN_PATH });
    }
  },
  component: AuthLayout,
  pendingComponent: AuthPendingComponent,
});

function AuthLayout() {
  return <Outlet />;
}
