import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createFileRoute,
  isRedirect,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { SidebarProvider } from '@repo/ui/sidebar';
import { Button } from '@repo/ui/button';
import { PageSkeleton } from '@repo/ui/page-skeleton';
import { ErrorBoundary } from '@repo/ui/error-boundary';
import { AppErrorCode } from '@repo/shared/errors';
import { translateAppError } from '@/lib/trpc-errors';
import { trpc, isUnauthorizedError } from '@/lib/trpc';
import { getAppErrorCode } from '@/lib/trpc-errors';
import { useUIStore } from '@/stores/ui-store';
import { USER_ME_STALE_TIME } from '@/hooks/use-auth';
import { pendingSkeletonForPath } from '@/lib/shell-routes';
import { AppSidebar } from '@/features/layout/components/AppSidebar';
import { AppTopbar } from '@/features/layout/components/AppTopbar';
import { GraceBanner } from '@/features/two-factor/components/GraceBanner';

/** 240px, matching the design's sidebar. The primitive defaults to 256px. */
const SHELL_STYLE = { '--sidebar-width': '15rem' } as CSSProperties;

function AuthenticatedErrorComponent({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  // The errors that actually reach a route boundary are a failed beforeLoad
  // ("Internal server error"), a transport failure, or a lazy-chunk 404 whose
  // message is an asset URL. None of those is copy: translate what can be
  // translated and keep the raw text for DEV only.
  const message = translateAppError(error) ?? t('errors.unexpected');
  const rawMessage = import.meta.env.DEV && error instanceof Error ? error.message : undefined;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-4">
      <h2 className="type-heading-h2">{t('fallback.errorTitle')}</h2>
      <p className="type-body-regular text-text-muted">{message}</p>
      {rawMessage !== undefined && <p className="type-mono-small text-text-muted">{rawMessage}</p>}
      <Button
        variant="outline"
        onClick={() => {
          // reset alone only clears the boundary against the same errored
          // match; invalidate re-runs beforeLoad/loader so the retry is real.
          reset();
          void router.invalidate();
        }}
      >
        {t('actions.retry')}
      </Button>
    </div>
  );
}

/**
 * The shell is kept, and only the content region waits.
 *
 * THIS IS THE LAYOUT ROUTE'S PENDING COMPONENT, so every child route without
 * one of its own bubbles up to here. Anything less than the full frame
 * therefore means an ordinary navigation discards the sidebar, the topbar and
 * all chrome, and the app reads as having failed to load rather than as being
 * busy. Rendering the frame with a shaped skeleton in the content region keeps
 * the reader's bearings and moves only the part that is actually changing.
 *
 * `defaultPendingComponent` in `main.tsx` means a child route rarely reaches
 * this at all now: it holds the already-mounted shell and skeletons only the
 * Outlet. This path covers the cold case, where `user.me` has not resolved yet
 * and the whole layout is pending.
 */
function AuthenticatedPendingComponent() {
  const { t } = useTranslation();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    // Uncontrolled on purpose: a placeholder frame that is about to be replaced
    // has no toggle state worth owning, and seeding from the store keeps the
    // rail the width the user last chose so nothing jumps on handover.
    <SidebarProvider defaultOpen={!sidebarCollapsed} style={SHELL_STYLE}>
      <AppSidebar />
      <div className="relative flex w-full min-w-0 flex-1 flex-col bg-bg">
        <AppTopbar />
        <main className="flex-1 p-6">
          <PageSkeleton variant={pendingSkeletonForPath(pathname)} label={t('states.loading')} />
        </main>
      </div>
    </SidebarProvider>
  );
}

function AuthenticatedNotFoundComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-4">
      <h2 className="type-heading-h2">{t('fallback.notFoundTitle')}</h2>
      <p className="type-body-regular text-text-muted">{t('fallback.notFoundDescription')}</p>
      <Button asChild>
        <Link to="/dashboard">{t('fallback.goToDashboard')}</Link>
      </Button>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData({
        ...trpc.user.me.queryOptions(),
        retry: false,
        staleTime: USER_ME_STALE_TIME,
      });
    } catch (error) {
      if (isRedirect(error)) throw error;
      // Only a confirmed UNAUTHORIZED means the user is logged out. Anything
      // else (network blip, 500) rethrows so the route's errorComponent
      // renders with a retry instead of bouncing a valid session to login.
      if (isUnauthorizedError(error)) {
        throw redirect({
          to: '/auth/login',
          search: { redirect: location.href },
        });
      }
      // A session flagged for 2FA enrollment 403s every non-allowlisted
      // procedure (including user.me). Send those users to the enroll-only
      // screen. The server allowlist is the boundary; this is the UX redirect.
      if (getAppErrorCode(error) === AppErrorCode.TWO_FACTOR_ENROLLMENT_REQUIRED) {
        throw redirect({ to: '/enroll-two-factor' });
      }
      console.error('[auth] user.me failed during route guard', error);
      throw error;
    }
  },
  component: AuthenticatedLayout,
  errorComponent: AuthenticatedErrorComponent,
  pendingComponent: AuthenticatedPendingComponent,
  notFoundComponent: AuthenticatedNotFoundComponent,
});

function AuthenticatedLayout() {
  const { t } = useTranslation();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  /*
   * The rail is FULLY controlled: `open` AND `onOpenChange`, never `defaultOpen`
   * alone. `SidebarProvider` keeps an internal `_open` and only falls back to it
   * when no `open` prop arrives, so handing it `onOpenChange` on its own left it
   * half controlled: a toggle wrote the store and persisted it while `_open`
   * never moved and nothing collapsed. `defaultOpen` then re-seeded `_open` from
   * the store on the next mount, which is why the collapse "applied on refresh".
   */
  return (
    <SidebarProvider
      open={!sidebarCollapsed}
      style={SHELL_STYLE}
      onOpenChange={(open) => {
        useUIStore.getState().setSidebarCollapsed(!open);
      }}
    >
      <AppSidebar />
      {/*
       * `SidebarInset` is hardcoded to `<main>`, which would nest the topbar's
       * `<header>` inside the main landmark and demote it to a generic element.
       * A plain column carries the same layout for the default sidebar variant
       * and keeps banner and main as siblings.
       */}
      <div className="relative flex w-full min-w-0 flex-1 flex-col bg-bg">
        <AppTopbar />
        <main id="main-content" className="flex-1 p-6">
          <GraceBanner />
          <ErrorBoundary
            title={t('fallback.errorTitle')}
            description={t('errors.unexpected')}
            retryLabel={t('actions.retry')}
            showErrorDetail={import.meta.env.DEV}
          >
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </SidebarProvider>
  );
}
