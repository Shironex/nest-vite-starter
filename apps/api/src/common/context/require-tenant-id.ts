import { getTenantId } from './request-context';
import { UnauthorizedError } from '../errors/domain-error';
import { AppErrorCode } from '@repo/shared/errors';

/**
 * The tenant id of the current request, or throw.
 *
 * Most tenant-scoped writes copy tenantId off a row that already carries it,
 * which proves tenant membership transitively. The paths that CREATE the first
 * row of a chain (a Workspace, a tenant-level policy) have no prior row, so they read the ALS directly, the same store the
 * Prisma tenant-scope extension fails closed on. Throwing here mirrors that
 * fail-closed posture.
 */
export function requireTenantId(): string {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new UnauthorizedError(AppErrorCode.UNAUTHORIZED, 'Tenant context required.');
  }
  return tenantId;
}
