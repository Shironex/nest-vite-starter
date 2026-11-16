import { Module } from '@nestjs/common';
import { SessionModule } from '../auth/session.module';
import { AuthMiddlewareModule } from '../auth/auth-middleware.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceService } from './workspace.service';
import { WorkspaceLookupService } from './workspace-lookup.service';
import { WorkspacesRouter } from './workspaces.router';

/**
 * Workspace: the workspaces of one organization, the second tier of the
 * Organization -> Workspace tenancy boundary.
 *
 * PLATFORM, not domain. Every tenant-owned record below the organization hangs off a
 * Workspace, so this module imports no feature module. Domain modules import it
 * (for the Workspace gate on their writes); it imports none of them.
 *
 * Imports the cycle-breaker pair (SessionModule + AuthMiddlewareModule, never
 * AuthModule) for the router guards, IdempotencyModule for the row-creating
 * mutations, and NotificationsModule for the fail-soft "workspace created"
 * broadcast. PrismaService and AuditService need no import: their modules are
 * `@Global()`.
 */
@Module({
  imports: [SessionModule, AuthMiddlewareModule, IdempotencyModule, NotificationsModule],
  providers: [WorkspaceRepository, WorkspaceService, WorkspaceLookupService, WorkspacesRouter],
  exports: [
    // The read half only: the tenant gate for a caller-supplied workspaceId and the
    // tenant's Workspace list. Creating or renaming a Workspace stays behind this
    // module's own router, so its audit row has exactly one writer.
    WorkspaceLookupService,
  ],
})
export class WorkspaceModule {}
