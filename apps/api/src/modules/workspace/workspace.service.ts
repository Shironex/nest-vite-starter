import { Injectable } from '@nestjs/common';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AppErrorCode } from '@repo/shared/errors';
import type {
  WorkspaceListOutput,
  WorkspaceCreateInput,
  WorkspaceCreateOutput,
  WorkspaceUpdateInput,
  WorkspaceUpdateOutput,
} from '@repo/shared/schemas';
import { AuditService } from '../audit/audit.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { WorkspaceRepository } from './workspace.repository';
import { isPrismaUniqueViolation } from '../../common/database/prisma-error';
import { requireTenantId } from '../../common/context/require-tenant-id';

/**
 * The workspaces one organization holds.
 *
 * Every Workspace-scoped write asserts the Workspace is in the caller's tenant, and
 * self-signup provisions a Tenant with no Workspace at all, so without `create`
 * a fresh organization could never record its first Workspace-scoped row, and without
 * `list` no picker could be populated.
 *
 * Reads are tenant-scoped by the Prisma extension. The create path is the only
 * one that needs an explicit `tenantId`, because writes are not scope-injected.
 *
 * `legalName` (the registered legal name) travels these two paths and no
 * other; see the reachability test in the spec, which exists to make dropping
 * it fail loudly.
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly auditService: AuditService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  async list(): Promise<WorkspaceListOutput> {
    return { workspaces: await this.repository.list() };
  }

  async create(input: WorkspaceCreateInput): Promise<WorkspaceCreateOutput> {
    const tenantId = requireTenantId();

    let workspace: WorkspaceCreateOutput;
    try {
      // `?? null` normalization: absent registration fields become explicit
      // NULL columns.
      workspace = await this.repository.create({
        tenantId,
        name: input.name,
        legalName: input.legalName ?? null,
        street: input.street ?? null,
        postalCode: input.postalCode ?? null,
        city: input.city ?? null,
      });
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.WORKSPACE_CREATED,
      targetType: 'Workspace',
      targetId: workspace.id,
      workspaceId: workspace.id,
      metadata: { name: workspace.name },
    });

    // Fail-soft broadcast to staff who opted in (muted by default).
    await this.notificationEvents.workspaceCreated(workspace.name);

    return workspace;
  }

  async update(input: WorkspaceUpdateInput): Promise<WorkspaceUpdateOutput> {
    const { workspaceId, ...changes } = input;

    // Scoped read: a Workspace in another organization resolves to null, so a foreign id
    // is indistinguishable from a missing one: the tenant boundary rule.
    const existing = await this.repository.findById(workspaceId);
    if (!existing) {
      throw new NotFoundError(AppErrorCode.NOT_FOUND, 'Workspace not found in this tenant.');
    }

    // Only the keys the caller sent: an absent key must stay untouched, and
    // spreading the zod output would smuggle `undefined` values past
    // exactOptionalPropertyTypes.
    const data: Prisma.WorkspaceUncheckedUpdateInput = {};
    if (changes.name !== undefined) data.name = changes.name;
    if (changes.legalName !== undefined) data.legalName = changes.legalName;
    if (changes.street !== undefined) data.street = changes.street;
    if (changes.postalCode !== undefined) data.postalCode = changes.postalCode;
    if (changes.city !== undefined) data.city = changes.city;

    let workspace: WorkspaceUpdateOutput;
    try {
      workspace = await this.repository.update(workspaceId, data);
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.WORKSPACE_UPDATED,
      targetType: 'Workspace',
      targetId: workspace.id,
      workspaceId: workspace.id,
      // Field NAMES only, never the values.
      metadata: { fields: Object.keys(data) },
    });

    return workspace;
  }

  /**
   * Map a P2002 from Workspace's per-tenant unique name constraint to a conflict.
   * Anything that is not a unique violation is rethrown untouched.
   */
  private translateUniqueViolation(error: unknown): unknown {
    if (!isPrismaUniqueViolation(error)) return error;
    // @@unique([tenantId, name]): two Workspaces with the same name inside one
    // organization would be indistinguishable in every picker and filter chip in the
    // app, so the constraint is a product rule, not just a data one.
    return new ConflictError(
      AppErrorCode.ALREADY_EXISTS,
      'A workspace with this name already exists.',
    );
  }
}
