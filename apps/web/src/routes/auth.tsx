import { createFileRoute, isRedirect, Outlet, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@repo/ui/spinner';
import { trpc } from '@/lib/trpc';
import { USER_ME_STALE_TIME } from '@/hooks/use-auth';
import { LOGIN_PATH, STAFF_HOME_PATH } from '@/lib/shell-routes';
import { isOAuthErrorCode } from '@/features/auth/Auth.constants';
import type { OAuthErrorCode } from '@/features/auth/Auth.constants';

function AuthPendingComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-brand-ink">
      <Spinner size="lg" label={t('states.loading')} />
    </div>
  );
}

export const Route = createFileRoute('/auth')({
  /**
   * The OAuth callback cannot answer a browser navigation with JSON, so every
   * failure comes back as a redirect to `/auth?error=<code>` (SPEC sections 5
   * to 7). Declared on the layout so every screen underneath inherits the param
   * and OAuthErrorAlert can read it with `strict: false`.
   *
   * The explicit `{ error?: OAuthErrorCode }` return keeps the key OPTIONAL in
   * the route's search type, the same reason `/auth/login` spells its own out
   * instead of using a zod .transform. Anything outside the five known codes is
   * dropped: a code with no sentence behind it means the api changed the
   * contract without shipping copy, and echoing it raw would put an
   * attacker-supplied string inside a destructive banner.
   *
   * Deliberately a total function with no schema parse. This is the LAYOUT for
   * every auth screen, and TanStack surfaces a throw from here as a route
   * error, so a hand-typed `/auth/login?error=1` (which the search parser hands
   * over as the number 1, not a string) would take down sign-in, registration
   * and password reset alike. The guard already rejects every non-member value,
   * so there is nothing a parse would add beyond that blast radius.
   */
  validateSearch: (search: Record<string, unknown>): { error?: OAuthErrorCode } =>
    isOAuthErrorCode(search.error) ? { error: search.error } : {},
  beforeLoad: async ({ context, location, search }) => {
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
    // empty Outlet. The OAuth callback lands exactly there, so forward it to the
    // sign-in screen and carry `error` across for OAuthErrorAlert. Placed after
    // the block above so an authenticated visitor still goes to the dashboard
    // rather than back to the login form.
    if (location.pathname === '/auth' || location.pathname === '/auth/') {
      throw redirect({ to: LOGIN_PATH, search });
    }
  },
  component: AuthLayout,
  pendingComponent: AuthPendingComponent,
});

function AuthLayout() {
  return <Outlet />;
}
