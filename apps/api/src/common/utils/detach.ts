import { createAppLogger } from '../../modules/logger/logger.service';

const logger = createAppLogger('Detached');

/** What a detached task is, for its failure log line. */
export interface IDetachContext {
  /**
   * A constant naming the work (`'mail.send'`, `'audit.write'`):
   * the key an operator searches the failure on. Never an interpolated value.
   */
  task: string;
  /**
   * Correlation fields (ids, never payloads). They ride the log's data object,
   * so the shared logger's redaction walks them like any other.
   */
  [field: string]: unknown;
}

/**
 * Run a promise deliberately unawaited, with its failure logged instead of
 * becoming an unhandled rejection.
 *
 * The api's `unhandledRejection` policy is to log and EXIT (see
 * common/observability/unhandled-rejection.ts), so fire-and-forget work that
 * drops its promise, or hides it behind a bare `void`, is one rejection away
 * from restarting the process. `@typescript-eslint/no-floating-promises` refuses
 * both in apps/api/src; this is the sanctioned way through.
 *
 * Use it only when nothing downstream depends on the outcome: the caller has
 * already answered, and a failure is worth a log line, not an error response.
 * If the caller's result depends on the work, `await` it instead.
 *
 * The failure line keeps the request's correlation ids: AsyncLocalStorage
 * follows the promise chain, so the handler runs in the scope the work started
 * in.
 */
export function detach(work: PromiseLike<unknown>, context: IDetachContext): void {
  Promise.resolve(work).then(undefined, (err: unknown) => {
    logger.error('Detached task failed', { ...context, err });
  });
}
