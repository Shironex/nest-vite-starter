/**
 * The api's one policy for a promise that rejected with nobody listening.
 *
 * POLICY: log through the structured logger, drain Sentry, then EXIT(1).
 *
 * Before this existed the answer depended on the deployment. With SENTRY_DSN
 * set, Sentry's `onUnhandledRejectionIntegration` (default mode "warn") was the
 * only listener, so the process logged and kept running; without it Node's
 * default `--unhandled-rejections=throw` killed the process. The same bug took
 * the api down in one environment and was a warning in another, and neither
 * behavior was chosen.
 *
 * Exit, not continue, because:
 *  - it is what Node does with no listener at all, which is what local dev and
 *    every test run already see, so production now matches them;
 *  - a rejection nobody handled means work the code thought would happen did
 *    not, and the process cannot know what state that left behind; the
 *    orchestrator restarts a clean one;
 *  - deliberate fire-and-forget work has a sanctioned path that never reaches
 *    here (`detach()`, common/utils/detach.ts), and the type-aware
 *    `no-floating-promises` lint refuses the unsanctioned ones in apps/api/src.
 *
 * Sentry is pinned to the same choice: otel.ts registers
 * `onUnhandledRejectionIntegration({ mode: SENTRY_UNHANDLED_REJECTION_MODE })`,
 * so with a DSN Sentry only CAPTURES the rejection (its listener runs first,
 * because Sentry.init runs first) and neither prints its own warning nor
 * decides whether to exit. This handler decides, in both environments.
 *
 * Deliberately free of @nestjs and of the Sentry SDK: it is imported by otel.ts,
 * which must load before any @nestjs module, and the effects are injected so the
 * policy unit-tests without a process to kill.
 */
import type { Logger } from '@repo/shared/logger';

/** The exit code a process leaves with after an unhandled rejection. */
export const UNHANDLED_REJECTION_EXIT_CODE = 1;

/**
 * Upper bound on draining queued Sentry events before exiting. Sentry's
 * `flush(timeout)` resolves by then even if the transport hangs, so the exit is
 * never held hostage by a slow network.
 */
export const UNHANDLED_REJECTION_FLUSH_TIMEOUT_MS = 2000;

/**
 * Mode for Sentry's own unhandled-rejection integration. "none" means capture
 * only: no console warning, no exit. The exit decision belongs to the handler
 * below, so it is the same with and without SENTRY_DSN.
 */
export const SENTRY_UNHANDLED_REJECTION_MODE = 'none';

export interface IUnhandledRejectionPolicyDeps {
  logger: Pick<Logger, 'error'>;
  /**
   * Drain queued telemetry. `Sentry.flush` in production, which resolves at
   * once when no client was initialized (SENTRY_DSN unset).
   */
  flush: (timeoutMs: number) => PromiseLike<unknown>;
  /** `process.exit` in production. */
  exit: (code: number) => void;
}

/**
 * The `unhandledRejection` listener. Every rejection is logged; the first one
 * starts the flush-then-exit, and any that arrive while it drains are logged
 * without starting a second.
 */
export function createUnhandledRejectionHandler(
  deps: IUnhandledRejectionPolicyDeps,
): (reason: unknown) => void {
  let exiting = false;
  return (reason: unknown): void => {
    deps.logger.error('Unhandled promise rejection; exiting', {
      reason,
      exitCode: UNHANDLED_REJECTION_EXIT_CODE,
    });
    if (exiting) return;
    exiting = true;
    const exit = (): void => deps.exit(UNHANDLED_REJECTION_EXIT_CODE);
    Promise.resolve(deps.flush(UNHANDLED_REJECTION_FLUSH_TIMEOUT_MS)).then(exit, exit);
  };
}

/** Register the policy. Called once, from main.ts. */
export function installUnhandledRejectionPolicy(
  deps: IUnhandledRejectionPolicyDeps,
  target: Pick<NodeJS.Process, 'on'> = process,
): void {
  target.on('unhandledRejection', createUnhandledRejectionHandler(deps));
}
