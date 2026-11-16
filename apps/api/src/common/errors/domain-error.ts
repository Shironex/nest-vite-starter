import { AppErrorCode } from '@repo/shared/errors';

/**
 * tRPC-compatible error code. Mirrors the values in `@trpc/server`'s
 * TRPC_ERROR_CODES_BY_KEY without importing the wire-transport package
 * into the service layer. AppErrorHandler maps these onto the actual
 * TRPCError code at the boundary.
 */
export type DomainErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_SERVER_ERROR';

/**
 * Base class for service-layer errors. Services throw subclasses of
 * DomainError instead of `TRPCError` so business code stays decoupled from
 * the wire transport: `AppErrorHandler` (`trpc/trpc.error-handler.ts`) is
 * the single boundary that promotes a DomainError into a TRPCError.
 *
 * Carries both:
 *   - `code`: the tRPC-style code, so jest specs that use
 *     `.rejects.toMatchObject({ code: 'NOT_FOUND', message: ... })` pass
 *     against DomainError without changes.
 *   - `appCode`: the canonical AppErrorCode, exposed to clients via
 *     TRPCError.message and consumed by the web app's error toaster.
 *
 * EVERY subclass takes `(appCode = <its default>, message?)`, in that order and
 * never the reverse. The order is load-bearing rather than cosmetic: `message`
 * is `string` and `appCode` is a union of string LITERALS, so a call written the
 * old way round, `new NotFoundError('Workspace not found')`, no longer compiles.
 * That is the whole guard. The previous arrangement had ValidationError on this
 * shape and its five siblings on the mirror image, which is why 39 call sites
 * ended up passing an AppErrorCode in the message slot: harmless only while the
 * code they passed happened to equal the subclass default, and a silent wrong
 * code on the wire the first time it did not.
 */
export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;

  constructor(
    public readonly appCode: AppErrorCode,
    message?: string,
  ) {
    super(message ?? appCode);
    // Set the prototype explicitly so `instanceof` works through
    // `super.constructor` chains compiled to ES5+ targets. NestJS / SWC
    // emit ES2022, so this is a defensive belt-and-braces line; cheap.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends DomainError {
  readonly code = 'BAD_REQUEST' as const;
  readonly name = 'ValidationError';
}

export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED' as const;
  readonly name = 'UnauthorizedError';

  constructor(appCode: AppErrorCode = AppErrorCode.UNAUTHORIZED, message?: string) {
    super(appCode, message);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN' as const;
  readonly name = 'ForbiddenError';

  constructor(appCode: AppErrorCode = AppErrorCode.FORBIDDEN, message?: string) {
    super(appCode, message);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND' as const;
  readonly name = 'NotFoundError';

  constructor(appCode: AppErrorCode = AppErrorCode.NOT_FOUND, message?: string) {
    super(appCode, message);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT' as const;
  readonly name = 'ConflictError';

  /**
   * Defaults to CONFLICT, not ALREADY_EXISTS: the overwhelming majority of the
   * throw sites are optimistic-version CAS losers and state-machine refusals,
   * whose remedy is "reload and retry". A genuine duplicate (workspace name,
   * email already a login identity) passes ALREADY_EXISTS or the
   * field-specific code explicitly, so the web can tell the user to change the
   * value instead of reloading.
   */
  constructor(appCode: AppErrorCode = AppErrorCode.CONFLICT, message?: string) {
    super(appCode, message);
  }
}

export class RateLimitError extends DomainError {
  readonly code = 'TOO_MANY_REQUESTS' as const;
  readonly name = 'RateLimitError';

  constructor(appCode: AppErrorCode = AppErrorCode.RATE_LIMITED, message?: string) {
    super(appCode, message);
  }
}
