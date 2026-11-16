import { Router, Query, Mutation, Ctx, Input, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import {
  accountDeletedOutput,
  ackOutput,
  adminUserListPageOutput,
  userActionSchema,
  userProfileOutput,
} from '@repo/shared/schemas';
import { ROLES } from '@repo/shared/permissions';
import { UserService } from './user.service';
import { LockoutService } from '../auth/services/lockout.service';
import { AuthMiddleware } from '../auth/middleware/auth.middleware';
import { AdminMiddleware } from '../auth/middleware/role.middleware';
import type { IAuthenticatedContextType } from '../../trpc/trpc.context';

const listUsersInputSchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  // prefault (not default): the fallback {} is parsed through the object
  // schema, so the inner limit default applies and the handler always
  // receives a concrete limit.
  .prefault({});

const unlockUserInputSchema = z.object({ userId: z.string() });

const updateUserRoleInputSchema = z.object({
  userId: z.string(),
  role: z.enum([ROLES.USER, ROLES.ADMIN]),
});

const adminDeleteUserInputSchema = z.object({ userId: z.string() });

@Router({ alias: 'user' })
@UseMiddlewares(AuthMiddleware)
export class UserRouter {
  constructor(
    private readonly userService: UserService,
    private readonly lockoutService: LockoutService,
  ) {}

  /**
   * Get the authenticated user's profile.
   * Returns: id, email, displayName, role, emailVerified,
   * createdAt. Self-scoped: the id comes from ctx.user.id.
   */
  @Query({ output: userProfileOutput })
  async me(@Ctx() ctx: IAuthenticatedContextType) {
    return this.userService.getProfile(ctx.user.id);
  }

  // ── Admin procedures ──────────────────────────────────────────────

  /**
   * List users (admin only), one cursor page at a time.
   * Returns admin-visible fields including lock status, plus `nextCursor` to
   * feed back for the following page (null on the last page). The whole input
   * defaults via zod, so a bare call (no args) yields the first page of 50.
   */
  @Query({
    input: listUsersInputSchema,
    output: adminUserListPageOutput,
  })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async listUsers(@Input() input: z.infer<typeof listUsersInputSchema>) {
    return this.userService.listUsers(input);
  }

  /**
   * Unlock a locked user account (admin only).
   * Resets all lockout state: failedAttempts, lockoutCount, lockedUntil.
   */
  @Mutation({ input: unlockUserInputSchema, output: ackOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async unlockUser(@Input() input: z.infer<typeof unlockUserInputSchema>) {
    await this.lockoutService.adminUnlock(input.userId);
    return { success: true as const };
  }

  /**
   * Change a user's role (admin only).
   * Revokes the target's sessions so the new role takes effect immediately
   * instead of staying frozen in their Redis session up to the TTL.
   */
  @Mutation({ input: updateUserRoleInputSchema, output: ackOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async updateUserRole(
    @Input() input: z.infer<typeof updateUserRoleInputSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    await this.userService.updateRole(ctx.user.id, input.userId, input.role);
    return { success: true as const };
  }

  /**
   * Soft delete a user's account (admin only; hard-deleted by the purge cron
   * after the grace window). Refuses the
   * caller's own account (self-service auth.deleteAccount owns that) and
   * refuses ADMIN targets. Revokes the target's sessions.
   */
  @Mutation({ input: adminDeleteUserInputSchema, output: accountDeletedOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async adminDeleteUser(
    @Ctx() ctx: IAuthenticatedContextType,
    @Input() input: z.infer<typeof adminDeleteUserInputSchema>,
  ) {
    await this.userService.adminDeleteUser(input.userId, ctx.user.id);
    return { deleted: true as const };
  }

  /**
   * Disable an account without deleting it (admin only).
   *
   * The reversible alternative to deleting an account, which leaves nothing
   * recoverable. The guards (no self, no ADMIN target) are in the service,
   * where the write repeats the role predicate.
   */
  @Mutation({ input: userActionSchema, output: ackOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async disableUser(
    @Input() input: z.infer<typeof userActionSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    await this.userService.disableUser(ctx.user.id, input.userId);
    return { success: true as const };
  }

  /** Enable a disabled account (admin only). */
  @Mutation({ input: userActionSchema, output: ackOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async enableUser(@Input() input: z.infer<typeof userActionSchema>) {
    await this.userService.enableUser(input.userId);
    return { success: true as const };
  }

  /**
   * Sign another user out of every session (admin only). The account itself
   * is untouched; the self-target refusal is in the service.
   */
  @Mutation({ input: userActionSchema, output: ackOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async revokeUserSessions(
    @Input() input: z.infer<typeof userActionSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    await this.userService.revokeUserSessions(ctx.user.id, input.userId);
    return { success: true as const };
  }
}
