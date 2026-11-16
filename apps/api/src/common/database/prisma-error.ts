/**
 * Duck-typed recognition of Prisma's known-request errors.
 *
 * `@repo/database` is ESM-only while this app compiles to CJS, so importing
 * `Prisma.PrismaClientKnownRequestError` just to use `instanceof` would drag the
 * generated client across that seam. Matching the error's shape avoids the
 * import entirely and behaves the same at runtime.
 *
 * Shared rather than redeclared per call site: the tRPC error handler maps these
 * to client-facing codes, and the repository layer translates one of them into a
 * domain error, so both need the identical check.
 */

/** Prisma error codes this app reacts to by name. */
export const PRISMA_ERROR = {
  /** Unique constraint violation. */
  UNIQUE_VIOLATION: 'P2002',
  /**
   * "An operation failed because it depends on one or more records that were
   * required but not found." Raised by singular `update`/`delete`/
   * `findUniqueOrThrow` when the `where` matches no row - including a
   * tenant-scoped write whose injected scope key excluded the target.
   */
  RECORD_NOT_FOUND: 'P2025',
} as const;

export interface IPrismaKnownRequestError {
  code: string;
  meta?: Record<string, unknown>;
  message: string;
}

export function isPrismaKnownRequestError(err: unknown): err is IPrismaKnownRequestError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string' &&
    String((err as Record<string, unknown>).code).startsWith('P') &&
    'name' in err &&
    (err as Record<string, unknown>).name === 'PrismaClientKnownRequestError'
  );
}

/** True when `err` is the specific Prisma known-request error `code`. */
export function isPrismaErrorCode(err: unknown, code: string): boolean {
  return isPrismaKnownRequestError(err) && err.code === code;
}

/**
 * Whether an error is Prisma's unique-constraint violation (P2002).
 *
 * Deliberately weaker than `isPrismaErrorCode(err, PRISMA_ERROR.UNIQUE_VIOLATION)`:
 * it reads `code` alone and does not require the `name` discriminator. The
 * dedupe checks that use it read without row locks, so a concurrent writer can
 * slip between check and insert; the DB constraint then rejects the loser with
 * P2002. Services translate that into the same ConflictError the sequential
 * path produces; the tRPC error handler deliberately does NOT promote raw
 * P2002 (it treats one as "a service failed to guard a constraint it should
 * know about" and pages). The two forms are kept apart on purpose until
 * someone proves every caller can take the stricter check; collapsing them
 * blind would turn a handled conflict into a page.
 */
export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
