import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Button } from '@repo/ui/button';
import { PageSkeleton } from '@repo/ui/page-skeleton';
import { routeTree } from './routeTree.gen';
import { queryClient, UNAUTHORIZED_EVENT } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import { loginPathForExpiredSession, pendingSkeletonForPath } from '@/lib/shell-routes';
import { initErrorReporting, captureException } from '@/lib/error-reporting';
import './index.css';
import { commonStrings } from '@/lib/strings';

/**
 * What a route shows while it loads, unless it names its own.
 *
 * WITHOUT THIS, a child route with no pending component of its own bubbles the
 * pending state up to the nearest ancestor that has one, which is the shell
 * layout, and the shell tears its own sidebar and topbar down to show a
 * spinner on a blank page. Declaring a default here means the pending state is
 * satisfied AT the child, so the already-mounted shell above it stays exactly
 * where it is and only the content region waits.
 */
function RoutePendingSkeleton() {
  return (
    <div className="w-full p-6">
      <PageSkeleton
        variant={pendingSkeletonForPath(window.location.pathname)}
        label={commonStrings.states.loading}
      />
    </div>
  );
}

/**
 * What a route shows when it FAILS, unless it names its own.
 *
 * WITHOUT THIS a leaf route with no `errorComponent` gets no CatchBoundary at
 * all (router-core resolves the boundary to a plain fragment when the route
 * declares no error component), so the throw travels past every route in the
 * tree to the `@repo/ui` ErrorBoundary the shells wrap around `<Outlet/>`. That
 * boundary tears down the content region, and its retry only clears React
 * state, so a load-phase failure re-throws instantly and the button does
 * nothing. Declaring a default means the failure is caught AT the route, with a
 * retry that re-runs the load.
 */
function RouteErrorComponent({ error, reset }: ErrorComponentProps) {
  const rawMessage = import.meta.env.DEV && error instanceof Error ? error.message : undefined;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-4" role="alert">
      <h2 className="type-heading-h2">{commonStrings.fallback.errorTitle}</h2>
      <p className="type-body-regular text-text-muted">
        {translateAppError(error) ?? commonStrings.errors.unexpected}
      </p>
      {rawMessage !== undefined && <p className="type-mono-small text-text-muted">{rawMessage}</p>}
      <Button
        variant="outline"
        onClick={() => {
          // reset alone only clears the boundary; the match stays in status
          // 'error' and rethrows on the next render. invalidate re-runs the
          // load, which is what makes the button a real retry.
          reset();
          void router.invalidate();
        }}
      >
        {commonStrings.actions.retry}
      </Button>
    </div>
  );
}

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPendingComponent: RoutePendingSkeleton,
  defaultErrorComponent: RouteErrorComponent,
  /*
   * Half a second before anything is drawn, and 400ms of it once drawn.
   *
   * The two numbers guard opposite failure modes. Showing the placeholder
   * eagerly would put a skeleton in front of routes that already resolve
   * imperceptibly, which reads as the app being SLOWER; not holding it once
   * shown would let a fast answer flash it on the way past, which reads as a
   * glitch. Both cost more than the wait they are meant to cover.
   */
  defaultPendingMs: 500,
  defaultPendingMinMs: 400,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/**
 * Take somebody whose session just died to a sign-in screen.
 *
 * The listener lives here rather than in lib/trpc.ts because the router is
 * created in this module and lib/trpc.ts is one of its dependencies. A batch of
 * failing queries fires the event once per query, so the handler has to be
 * idempotent: it reads the CURRENT location every time, and
 * `loginPathForExpiredSession` answers `undefined` once the first navigation
 * has landed on a sign-in route, which is also what stops a refused sign-in
 * attempt from bouncing the sign-in screen off itself.
 *
 * `location.href` here is TanStack's origin-stripped pathname + search + hash,
 * which is exactly the shape `/auth/login`'s open-redirect guard accepts.
 */
window.addEventListener(UNAUTHORIZED_EVENT, () => {
  const { pathname, href } = router.state.location;
  const to = loginPathForExpiredSession(pathname);
  if (to === undefined) return;
  // `replace` so the browser Back button does not lead to the dead page.
  void router.navigate({ to, search: { redirect: href }, replace: true });
});

// Fire-and-forget: loads the Sentry SDK in parallel with app init when a DSN
// is configured (see lib/error-reporting.ts); never blocks or breaks render.
void initErrorReporting();

try {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element not found');

  createRoot(rootEl).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
} catch (error: unknown) {
  // Without this, a failed boot leaves the page blank forever.
  console.error('App initialization failed', error);
  captureException(error);
  const rootEl = document.getElementById('root');
  if (rootEl) {
    // Pre-render boot path: nothing from the app is available, so this is a
    // literal.
    rootEl.innerHTML =
      '<p style="font-family: sans-serif; padding: 2rem; text-align: center;">' +
      'The app could not start. Please restart it.</p>';
  }
}
