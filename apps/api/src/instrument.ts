// Sentry bootstrap. Dormant unless SENTRY_DSN is set.
//
// Imported by main.ts and worker.ts right after ./load-env and before any
// @nestjs/* import, so Sentry.init() runs before the modules it instruments
// load. Reordering that import silently loses error capture.
//
//   - SENTRY_DSN unset or empty: Sentry is never initialised (one info line).
//     Zero egress. Sentry.captureException / flush stay safe no-ops.
//   - SENTRY_DSN set: standalone error capture (errors and release health, no
//     tracing). Every event and breadcrumb passes through the PII and OS-path
//     scrubber. Works with a self-hosted GlitchTip DSN as well as Sentry.
//
// Source-map upload is deliberately not wired.

import * as Sentry from '@sentry/nestjs';
import { scrubEvent, scrubBreadcrumb } from './common/observability/sentry-scrub';
import { SENTRY_UNHANDLED_REJECTION_MODE } from './common/observability/unhandled-rejection';

function logLine(context: string, message: string): void {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', context, message }),
  );
}

/**
 * Initialise Sentry from `vars`, or do nothing. Returns whether it initialised.
 * Exported so the dormant path is unit-tested; the module calls it once with
 * `process.env` at load.
 */
export function initSentry(vars: NodeJS.ProcessEnv): boolean {
  const dsn = vars['SENTRY_DSN']?.trim();
  if (!dsn) {
    logLine('Sentry', 'SENTRY_DSN not set, Sentry disabled (no-op)');
    return false;
  }

  // Release name. The runner launches `node dist/src/main` directly (no npm
  // script), so npm_package_version is undefined at runtime; APP_VERSION (a
  // Dockerfile build arg) names a real release, else 0.0.0.
  const release = vars['APP_VERSION']?.trim() || vars['npm_package_version'] || '0.0.0';

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    environment: vars['SENTRY_ENVIRONMENT']?.trim() || vars['NODE_ENV'] || 'development',
    release,
    // The scrubbers are SDK-free (typed on a generic record) so they unit-test
    // in isolation; the SDK's ErrorEvent / Breadcrumb are objects without an
    // index signature, so bridge through `unknown` once at this boundary. The
    // scrub functions only read/rewrite a known subset of fields and return the
    // same reference, so the round-trip is type-sound.
    beforeSend: (event) =>
      scrubEvent(event as unknown as Record<string, unknown>) as typeof event | null,
    beforeBreadcrumb: (breadcrumb) =>
      scrubBreadcrumb(breadcrumb as unknown as Record<string, unknown>) as typeof breadcrumb | null,
    // Capture-only: without this pin the SDK default ("warn") would be the one
    // listener, logging and continuing, while a process with no DSN exits. The
    // exit decision belongs to the entrypoint's policy in both environments;
    // see common/observability/unhandled-rejection.ts.
    integrations: [
      Sentry.onUnhandledRejectionIntegration({ mode: SENTRY_UNHANDLED_REJECTION_MODE }),
    ],
  });

  // Drain captured events before the single process exit on SIGTERM/SIGINT.
  // Registered only with a DSN, so a dormant process keeps Nest's own
  // enableShutdownHooks() path untouched.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    const exit = (): void => process.exit(0);
    Sentry.close(2000).then(exit, exit);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  logLine('Sentry', 'Sentry initialized (standalone error capture)');
  return true;
}

initSentry(process.env);
