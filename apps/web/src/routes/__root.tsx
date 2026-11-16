import { useEffect } from 'react';
import { createRootRouteWithContext, HeadContent, Outlet } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@repo/ui/sonner';
import { ErrorBoundary } from '@repo/ui/error-boundary';
import { UiLabelsProvider } from '@repo/ui/ui-labels';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { translateAppError } from '@/lib/trpc-errors';
import { queryClient } from '@/lib/trpc';
import { captureException } from '@/lib/error-reporting';
import { applyTheme, applyColorTheme } from '@/lib/theme';
import { useUIStore } from '@/stores/ui-store';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';
import { commonStrings } from '@/lib/strings';

export interface IRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<IRouterContext>()({
  component: RootLayout,
  errorComponent: RootErrorComponent,
});

function RootErrorComponent({ error }: ErrorComponentProps) {
  // The errors that actually reach a route boundary are a failed beforeLoad
  // ("Internal server error"), a transport failure, or a lazy-chunk 404 whose
  // message is an asset URL. None of those is copy: translate what can be
  // translated and keep the raw text for DEV only.
  const message = translateAppError(error) ?? commonStrings.errors.unexpected;
  const rawMessage = import.meta.env.DEV && error instanceof Error ? error.message : undefined;

  useEffect(() => {
    // Router-level failures (loaders, beforeLoad, render) land here instead of
    // the ErrorBoundary below, so report them on mount.
    captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{commonStrings.fallback.errorTitle}</CardTitle>
          <CardDescription>{commonStrings.fallback.rootErrorDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="type-body-regular text-muted-foreground">{message}</p>
          {rawMessage !== undefined && (
            <p className="type-mono-small text-text-muted">{rawMessage}</p>
          )}
          {import.meta.env.DEV && error instanceof Error && error.stack && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 type-mono-small">
              {error.stack}
            </pre>
          )}
          <Button onClick={() => window.location.reload()}>{commonStrings.fallback.reload}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The sr-only strings `@repo/ui` primitives render for themselves.
 *
 * The package carries no copy by design, so these arrive from the app. Mounted
 * ONCE in the root layout rather than passed as props because `DialogContent`
 * alone renders "Close" at 23 call sites and the mobile sidebar renders three of
 * them from inside `Sidebar`, which no caller passes through: as props they would
 * be the same literal in two dozen files.
 */
const UI_LABELS = {
  close: commonStrings.actions.close,
  loading: commonStrings.states.loading,
  toggleSidebar: commonStrings.uiLabels.toggleSidebar,
  sidebarTitle: commonStrings.uiLabels.sidebarTitle,
  sidebarDescription: commonStrings.uiLabels.sidebarDescription,
  notifications: commonStrings.uiLabels.notifications,
};

function RootLayout() {
  /*
   * One resolved value drives both halves of theming: the `.dark` class the app
   * paints from, and the `theme` prop sonner needs because it renders in its own
   * React portal and cannot read that class. Reading it through the hook rather than
   * off the store is what makes the 'system' preference track the OS live.
   */
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    applyColorTheme(useUIStore.getState().colorTheme);
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  return (
    <>
      {/*
       * Writes the per-route `head()` title into <head>. Without it every route
       * is index.html's "SaaS Starter": nothing announces a navigation to assistive
       * tech, and a user with several tabs cannot tell one from another.
       */}
      <HeadContent />
      <UiLabelsProvider labels={UI_LABELS}>
        <QueryClientProvider client={queryClient}>
          <div className="flex min-h-screen flex-col bg-background font-sans antialiased">
            {/* Keyboard users can jump past the chrome; visible only while focused. */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:type-body-medium focus:ring-2 focus:ring-ring"
            >
              {commonStrings.fallback.skipToContent}
            </a>
            <div className="flex flex-1 flex-col">
              <ErrorBoundary
                title={commonStrings.fallback.errorTitle}
                description={commonStrings.fallback.rootErrorDescription}
                retryLabel={commonStrings.actions.retry}
                showErrorDetail={import.meta.env.DEV}
                onError={(error, info) => {
                  console.error('[ErrorBoundary]', error, info);
                  captureException(error, { extra: { componentStack: info.componentStack } });
                }}
              >
                <Outlet />
              </ErrorBoundary>
            </div>
          </div>
          <Toaster theme={resolvedTheme} />
        </QueryClientProvider>
      </UiLabelsProvider>
    </>
  );
}
