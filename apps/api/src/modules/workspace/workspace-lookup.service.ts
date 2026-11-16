import { Injectable } from '@nestjs/common';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { AppErrorCode } from '@repo/shared/errors';
import { NotFoundError } from '../../common/errors/domain-error';
import { WorkspaceRepository, type WorkspaceRecord } from './workspace.repository';

/**
 * The read half of Workspace that other modules may depend on: the tenant gate for
 * a caller-supplied `workspaceId`, and the tenant's Workspace list.
 *
 * A separate service from WorkspaceService on purpose. A domain module needs to
 * CHECK a Workspace inside its own write transactions and to fan a lookup out over
 * every Workspace; it never needs to create or rename one. Handing it WorkspaceService
 * would hand it the audited write path too, and the module boundary is what
 * says it may not.
 */
@Injectable()
export class WorkspaceLookupService {
  constructor(private readonly repository: WorkspaceRepository) {}

  /**
   * Assert a Workspace belongs to the caller's tenant.
   *
   * The workspaceId half of the tenancy boundary: `workspaceId` is deliberately not a
   * scope key on the Prisma extension (it is never in the request ALS, and a
   * list may span Workspaces), so nothing at the data layer stops a caller
   * supplying a Workspace id belonging to another organization. What does stop them is
   * this lookup: `workspace` IS tenant-scoped, so a foreign id resolves to null,
   * and a foreign id is indistinguishable from a missing one.
   *
   * Every write path that accepts a caller-supplied workspaceId must call this
   * first, passing its `tx` when it runs inside a transaction.
   */
  async assertInTenant(workspaceId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const workspace = await this.repository.findById(workspaceId, tx);
    if (!workspace) {
      throw new NotFoundError(AppErrorCode.NOT_FOUND, 'Workspace not found in this tenant.');
    }
  }

  /** Every Workspace in the caller's tenant, name-ascending. */
  list(tx?: Prisma.TransactionClient): Promise<WorkspaceRecord[]> {
    return this.repository.list(tx);
  }
}
