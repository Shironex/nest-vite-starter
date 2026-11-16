import { Router, Query, Mutation, Ctx, Input, UseMiddlewares } from 'nestjs-trpc';
import type { z } from 'zod';
import {
  notificationListInput,
  notificationListOutput,
  notificationMarkAllReadOutput,
  notificationMarkReadInput,
  notificationMarkReadOutput,
  notificationPreferencesOutput,
  notificationPreferencesUpdateInput,
} from '@repo/shared/schemas';
import { AuthMiddleware } from '../auth/middleware/auth.middleware';
import { IdempotencyMiddleware } from '../../common/idempotency/idempotency.middleware';
import type { IAuthenticatedContextType } from '../../trpc/trpc.context';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * Notifications router. Class-level `@UseMiddlewares(AuthMiddleware)` gates
 * every procedure, and each operates strictly on `ctx.user.id`; markRead is
 * the only one that reads an id from input, and the service scopes that
 * update by { id, userId }, so there is no IDOR surface.
 *
 * Every procedure declares an `output:` schema: without one nestjs-trpc
 * generates `as any` and poisons the client types. The mutations skip
 * IdempotencyMiddleware on purpose (matching the logout precedent): both are
 * updateMany writes whose predicate (`readAt: null`) makes a replay a no-op.
 */
@Router({ alias: 'notifications' })
@UseMiddlewares(AuthMiddleware)
export class NotificationsRouter {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationPreferencesService: NotificationPreferencesService,
  ) {}

  /**
   * `notifications.list`: hydrate the bell from Postgres (the source of
   * truth). Newest-first, `read` derived from readAt, unreadCount counted
   * across the whole table (the badge, not just the visible page).
   */
  @Query({ input: notificationListInput, output: notificationListOutput })
  async list(
    @Ctx() ctx: IAuthenticatedContextType,
    @Input() input: z.infer<typeof notificationListInput>,
  ) {
    return this.notificationsService.listForUser(ctx.user.id, input.limit);
  }

  /** `notifications.markRead`: flip one owned notification to read. */
  @Mutation({ input: notificationMarkReadInput, output: notificationMarkReadOutput })
  async markRead(
    @Ctx() ctx: IAuthenticatedContextType,
    @Input() input: z.infer<typeof notificationMarkReadInput>,
  ) {
    return this.notificationsService.markRead(ctx.user.id, input.id);
  }

  /** `notifications.markAllRead`: flip every unread notification to read. */
  @Mutation({ output: notificationMarkAllReadOutput })
  async markAllRead(@Ctx() ctx: IAuthenticatedContextType) {
    return this.notificationsService.markAllRead(ctx.user.id);
  }

  /**
   * `notifications.preferencesGet`: the caller's channel matrix, resolved
   * through the defaults while no row exists. Strictly self-serve: every user
   * manages their own preferences, so unlike the tenant-wide reminder policy
   * there is no admin gate.
   */
  @Query({ output: notificationPreferencesOutput })
  async preferencesGet(@Ctx() ctx: IAuthenticatedContextType) {
    return this.notificationPreferencesService.getForUser(ctx.user.id);
  }

  /**
   * `notifications.preferencesUpdate`: save the whole matrix. Carries
   * IdempotencyMiddleware like compliance.settingsUpdate, the other lazily
   * row-creating settings save: the first save is a create, and a network
   * retry must not race itself into the P2002 conflict path.
   */
  @Mutation({
    input: notificationPreferencesUpdateInput,
    output: notificationPreferencesOutput,
  })
  @UseMiddlewares(AuthMiddleware, IdempotencyMiddleware)
  async preferencesUpdate(
    @Ctx() ctx: IAuthenticatedContextType,
    @Input() input: z.infer<typeof notificationPreferencesUpdateInput>,
  ) {
    return this.notificationPreferencesService.updateForUser(ctx.user.id, input.channels);
  }
}
