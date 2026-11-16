/**
 * A broken internal invariant: a boot-time misconfiguration, a state the code
 * proved impossible, or stored data that no longer decodes. Distinct from
 * `DomainError`, which is a refusal a caller can observe and act on. An
 * `InvariantError` reaches the client as INTERNAL_SERVER_ERROR and should page:
 * there is nothing the caller can change to make the request succeed.
 *
 * The one named home for these throws, so `contracts/restrict-throw-to-taxonomy`
 * can hold the rest of the api to the DomainError taxonomy (see
 * `packages/eslint-config/nestjs.js`). Not a `DomainError`: it has no `appCode`
 * and no tRPC code, and `AppErrorHandler` already maps any other `Error` to 500.
 */
export class InvariantError extends Error {
  readonly name = 'InvariantError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
