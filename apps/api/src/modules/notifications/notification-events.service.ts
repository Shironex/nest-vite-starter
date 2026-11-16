import { Injectable, Logger } from '@nestjs/common';
import { ROLES } from '@repo/shared/permissions';
import { NOTIFICATION_CATEGORIES } from '@repo/shared/schemas';
import type { NotificationCategory } from '@repo/shared/schemas';
import { getRequestContext } from '../../common/context/request-context';
import type { INotificationInput } from './notification-dispatch/notification-dispatch.types';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';

/** Bell copy for a role value. Falls back to the raw value for a future role. */
const ROLE_LABEL: Record<string, string> = {
  [ROLES.ADMIN]: 'Administrator',
  [ROLES.USER]: 'User',
};

/**
 * The event-notification producers: new workspace, admin actions.
 *
 * Deliberately conservative, in both directions:
 *
 *   - Every emission respects preferences from day one, and the DEFAULT for
 *     every event category is muted: the events notified nobody before this
 *     service existed, so anyone who wants them opts in. That is what keeps
 *     the bell (and one day the digest) quiet by default.
 *   - Every emission is fail-soft. These are courtesy broadcasts riding on a
 *     business write that has already succeeded; a Redis hiccup on the
 *     enqueue must not roll back or fail a created Workspace. The loss is logged
 *     and accepted (the queued dispatch pipeline has its own retries once the
 *     job is in).
 *
 * The actor and tenant come from the ALS request context, like AuditService:
 * the emitting services stay one-liner call sites, and the ACTOR IS EXCLUDED
 * from the audience: being told about your own click is noise. Outside a
 * tenant context (seeds, system jobs) there is no audience and the emission
 * is a silent no-op.
 */
@Injectable()
export class NotificationEventsService {
  private readonly logger = new Logger(NotificationEventsService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly notificationsService: NotificationsService,
    private readonly notificationPreferences: NotificationPreferencesService,
  ) {}

  /** A workspace was created. Audience: the whole organization staff. */
  async workspaceCreated(workspaceName: string): Promise<void> {
    await this.emit({
      category: NOTIFICATION_CATEGORIES.WORKSPACE_CREATED,
      audience: 'staff',
      notification: {
        type: 'info',
        title: `New workspace: ${workspaceName}`,
        message: `The workspace "${workspaceName}" was added.`,
      },
    });
  }

  /**
   * An admin changed a member's role. Audience: the OTHER admins; role
   * grants are the tenant's security posture, and the second admin is the one
   * who would want to know.
   */
  async adminRoleChanged(input: { targetEmail: string; role: string }): Promise<void> {
    await this.emit({
      category: NOTIFICATION_CATEGORIES.ADMIN_ACTIONS,
      audience: 'admins',
      notification: {
        type: 'info',
        title: 'User role changed',
        message: `${input.targetEmail}: new role ${ROLE_LABEL[input.role] ?? input.role}.`,
      },
    });
  }

  /** An admin deleted a member's account. Audience: the other admins. */
  async adminUserDeleted(input: { targetEmail: string }): Promise<void> {
    await this.emit({
      category: NOTIFICATION_CATEGORIES.ADMIN_ACTIONS,
      audience: 'admins',
      notification: {
        type: 'warning',
        title: 'User account deleted',
        message: `An administrator deleted the account ${input.targetEmail}.`,
      },
    });
  }

  private async emit(input: {
    category: NotificationCategory;
    audience: 'staff' | 'admins';
    notification: INotificationInput;
  }): Promise<void> {
    try {
      const ctx = getRequestContext();
      const tenantId = ctx?.tenantId;
      // No tenant in context means no audience to broadcast to (seeds, system
      // jobs). The business write these ride on has its own audit trail.
      if (tenantId === undefined) return;
      const actorId = ctx?.userId;

      const users = await this.repository.listActiveUsersByTenant(tenantId);
      const candidates = users.filter(
        (user) => user.id !== actorId && (input.audience === 'staff' || user.role === ROLES.ADMIN),
      );

      const recipients = await this.notificationPreferences.filterByChannel(
        candidates.map((user) => user.id),
        input.category,
        'inApp',
      );
      // ONE enqueue for the whole audience. This runs inside the mutation that
      // triggered it (workspace created, member deleted), which
      // is awaited by the caller, so the old per-recipient loop put the organization's
      // whole head-count worth of sequential BullMQ adds on the response time
      // of a create. On a remote Redis that was tens of milliseconds a click,
      // paid by the user who did the thing, for a courtesy broadcast to
      // everyone else.
      //
      // Fails as one unit, which loses nothing here: `emit` is fail-soft by
      // contract, so a partial send and no send were already the same outcome
      // to the caller, and both are logged below.
      await this.notificationsService.notifyMany(recipients, input.notification);
    } catch (error) {
      // Fail-soft by contract (see the class comment): the business write has
      // already succeeded and must not be failed by a courtesy broadcast.
      this.logger.error(
        'Failed to emit a notification (continuing)',
        { category: input.category },
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
