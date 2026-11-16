import { Router, Query, Mutation, Input, UseMiddlewares } from 'nestjs-trpc';
import type { z } from 'zod';
import {
  workspaceCreateInput,
  workspaceCreateOutput,
  workspaceListOutput,
  workspaceUpdateInput,
  workspaceUpdateOutput,
} from '@repo/shared/schemas';
import { AuthMiddleware } from '../auth/middleware/auth.middleware';
import { AdminMiddleware } from '../auth/middleware/role.middleware';
import { IdempotencyMiddleware } from '../../common/idempotency/idempotency.middleware';
import { WorkspaceService } from './workspace.service';

/**
 * Workspaces of the caller's organization, the Organization -> Workspace tenancy tier.
 *
 * Read is open to USER+ADMIN: every Workspace-scoped screen needs it to render a
 * Workspace name, a picker, or a filter chip. Create and update are ADMIN-only:
 * a workspace's identity (name, legal name, registered address) is
 * account-management data, not day-to-day work, and a typo creates a second
 * Workspace that silently splits one client's records across two lists.
 */
@Router({ alias: 'workspaces' })
@UseMiddlewares(AuthMiddleware)
export class WorkspacesRouter {
  constructor(private readonly workspaceService: WorkspaceService) {}

  /** Every Workspace in the tenant, name-ascending. Unpaginated (tens of rows). */
  @Query({ output: workspaceListOutput })
  async list() {
    return this.workspaceService.list();
  }

  @Mutation({ input: workspaceCreateInput, output: workspaceCreateOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware, IdempotencyMiddleware)
  async create(@Input() input: z.infer<typeof workspaceCreateInput>) {
    return this.workspaceService.create(input);
  }

  @Mutation({ input: workspaceUpdateInput, output: workspaceUpdateOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware, IdempotencyMiddleware)
  async update(@Input() input: z.infer<typeof workspaceUpdateInput>) {
    return this.workspaceService.update(input);
  }
}
