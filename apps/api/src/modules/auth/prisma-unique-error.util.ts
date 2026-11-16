/**
 * Duck-typed helpers for Prisma P2002 unique-constraint violations: signup
 * (RegisterService) races its own pre-check against the User.email unique
 * constraint inside the provisioning transaction.
 *
 * Duck-typed (never `instanceof Prisma.PrismaClientKnownRequestError`) because
 * a value import of the ESM-only Prisma client into a CJS service would drag
 * the WASM query compiler through jest's transform. Mirrors
 * `trpc/trpc.error-handler.ts`.
 */

export function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

/**
 * The lowercased text of a Prisma P2002 `meta.target` - a column-name array
 * (e.g. `['email']`) or a constraint-name string (e.g. `User_email_key`),
 * depending on the driver adapter - so the caller can tell WHICH unique
 * constraint was violated. Returns undefined when no target is reported.
 */
export function uniqueConstraintTargetText(err: unknown): string | undefined {
  const target = (err as { meta?: { target?: unknown } })?.meta?.target;
  if (Array.isArray(target)) {
    return target.join(',').toLowerCase();
  }
  if (typeof target === 'string') {
    return target.toLowerCase();
  }
  return undefined;
}
