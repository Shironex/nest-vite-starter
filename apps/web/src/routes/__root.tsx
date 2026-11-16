import { useEffect, useMemo } from 'react';
import { createRootRouteWithContext, HeadContent, Outlet } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Toaster } from '@repo/ui/sonner';
import { ErrorBoundary } from '@repo/ui/error-boundary';
import { UiLabelsProvider } from '@repo/ui/ui-labels';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { translateAppError } from '@/lib/trpc-errors';
import { queryClient } from '@/lib/trpc';
import { i18n } from '@/lib/i18n';
import { captureException } from '@/lib/error-reporting';
import { applyTheme, applyColorTheme } from '@/lib/theme';
import { useUIStore } from '@/stores/ui-store';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';
import { initUpdateListener } from '@/stores/update-store';
import { TitleBar } from '@/features/desktop/components/TitleBar';
import { UpdateBanner } from '@/features/desktop/components/UpdateBanner';

export interface IRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<IRouterContext>()({
  component: RootLayout,
  errorComponent: RootErrorComponent,
});

function RootErrorComponent({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  // The errors that actually reach a route boundary are a failed beforeLoad
  // ("Internal server error"), a transport failure, or a lazy-chunk 404 whose
  // message is an asset URL. None of those is copy: translate what can be
  // translated and keep the raw text for DEV only.
  const message = translateAppError(error) ?? t('errors.unexpected');
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
          <CardTitle>{t('fallback.errorTitle')}</CardTitle>
          <CardDescription>{t('fallback.rootErrorDescription')}</CardDescription>
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
          <Button onClick={() => window.location.reload()}>{t('fallback.reload')}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function RootLayout() {
  const { t } = useTranslation();
  /*
   * One resolved value drives both halves of theming: the `.dark` class the app
   * paints from, and the `theme` prop sonner needs because it renders in its own
   * React portal and cannot read that class. Reading it through the hook rather than
   * off the store is what makes the 'system' preference track the OS live.
   */
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    applyColorTheme(useUIStore.getState().colorTheme);

    // Initialize update listener for Electron mode (no-op in web)
    initUpdateListener();
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  /**
   * The sr-only strings `@repo/ui` primitives render for themselves.
   *
   * The package has no catalog by design, so these arrive from the app. Mounted
   * ONCE here rather than passed as props because `DialogContent` alone renders
   * "Close" at 23 call sites and the mobile sidebar renders three of them from
   * inside `Sidebar`, which no caller passes through: as props they would be
   * the same literal in two dozen files, each one drift away from the
   * catalog copy.
   */
  const uiLabels = useMemo(
    () => ({
      close: t('actions.close'),
      loading: t('states.loading'),
      toggleSidebar: t('uiLabels.toggleSidebar'),
      sidebarTitle: t('uiLabels.sidebarTitle'),
      sidebarDescription: t('uiLabels.sidebarDescription'),
      notifications: t('uiLabels.notifications'),
    }),
    [t],
  );

  return (
    <I18nextProvider i18n={i18n}>
      {/*
       * Writes the per-route `head()` title into <head>. Without it every route
       * is index.html's "SaaS Starter": nothing announces a navigation to assistive
       * tech, and a user with several tabs cannot tell one from another.
       */}
      <HeadContent />
      <UiLabelsProvider labels={uiLabels}>
        <QueryClientProvider client={queryClient}>
          <div className="flex min-h-screen flex-col bg-background font-sans antialiased">
            {/* Keyboard users can jump past the chrome; visible only while focused. */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:type-body-medium focus:ring-2 focus:ring-ring"
            >
              {t('fallback.skipToContent')}
            </a>
            <TitleBar />
            <UpdateBanner />
            <div className="flex flex-1 flex-col">
              <ErrorBoundary
                title={t('fallback.errorTitle')}
                description={t('fallback.rootErrorDescription')}
                retryLabel={t('actions.retry')}
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
    </I18nextProvider>
  );
}
