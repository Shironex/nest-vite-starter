import { Injectable } from '@nestjs/common';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { BaseRepository } from '../../common/database/base.repository';
import { PrismaService } from '../../common/database/prisma.service';

/**
 * Every column the workspaces router serves. One shared select, so list, create and
 * update can never disagree about what a Workspace row looks like to the client.
 *
 * `legalName` is here because the edit dialog seeds itself from the list read:
 * a column absent from this select is one the staff UI can display but never
 * correct.
 */
const WORKSPACE_SELECT = {
  id: true,
  name: true,
  legalName: true,
  street: true,
  postalCode: true,
  city: true,
} satisfies Prisma.WorkspaceSelect;

/** A Workspace as the workspaces router returns it. */
export type WorkspaceRecord = Prisma.WorkspaceGetPayload<{ select: typeof WORKSPACE_SELECT }>;

/**
 * Prisma access for `Workspace`, the second tier of the Organization -> Workspace boundary.
 *
 * All reads and writes go through `this.client`, the tenant-scoped extended
 * client, so `tenantId` is filtered on every read automatically: a Workspace of
 * another organization is invisible here, which is what makes `findById` usable as
 * the tenant-ownership check for a caller-supplied `workspaceId`.
 *
 * Every method takes an optional trailing `tx`. A caller inside `$transaction`
 * (a domain service checking a Workspace inside its own write transaction) MUST
 * pass it: without it the read takes a second pool connection and blocks on
 * row locks the enclosing uncommitted transaction already holds.
 */
@Injectable()
export class WorkspaceRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * Look up a Workspace by id. `workspace` IS tenant-scoped by the extension, so this
   * returns null for a Workspace belonging to another organization.
   */
  findById(workspaceId: string, tx?: Prisma.TransactionClient): Promise<{ id: string } | null> {
    return (tx ?? this.client).workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
  }

  /**
   * Every Workspace in the tenant, name-ascending. Serves the pickers, the filter
   * chips and the management screen.
   * Unpaginated on purpose: an organization's client list is tens of rows, and every
   * consumer wants all of them (a picker with a "load more" is worse than one
   * long select).
   */
  list(tx?: Prisma.TransactionClient): Promise<WorkspaceRecord[]> {
    return (tx ?? this.client).workspace.findMany({
      select: WORKSPACE_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Add a workspace to the caller's organization. `tenantId` is supplied by the
   * caller rather than the extension because writes are not scope-injected.
   */
  create(
    data: Prisma.WorkspaceUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<WorkspaceRecord> {
    return (tx ?? this.client).workspace.create({
      data,
      select: WORKSPACE_SELECT,
    });
  }

  /**
   * Update a workspace. The tenant-scope extension injects the scope into
   * the unique `where`, so a foreign id surfaces as P2025 rather than a write,
   * but callers still existence-check first for a friendly NotFoundError.
   */
  update(
    workspaceId: string,
    data: Prisma.WorkspaceUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<WorkspaceRecord> {
    return (tx ?? this.client).workspace.update({
      where: { id: workspaceId },
      data,
      select: WORKSPACE_SELECT,
    });
  }
}
