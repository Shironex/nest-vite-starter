import { Router, Mutation, Ctx, Input, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import {
  staffInviteSendSchema,
  staffInviteSendOutput,
  staffInviteRevokeSchema,
  staffInviteWithdrawByEmailSchema,
  ackOutput,
} from '@repo/shared/schemas';
import { AuthMiddleware } from '../middleware/auth.middleware';
import { AdminMiddleware } from '../middleware/role.middleware';
import { IdempotencyMiddleware } from '../../../common/idempotency/idempotency.middleware';
import type { IAuthenticatedContextType } from '../../../trpc/trpc.context';
import { getClientIp, getUserAgent } from '../../../common/utils/request';
import { StaffInviteService } from './staff-invite.service';

/**
 * The ADMIN side of a staff invitation: sending one and withdrawing it.
 *
 * Acceptance is NOT here. It lives on the `auth` router with the password
 * reset, for the reason that one does: the caller has no
 * session yet, so there is nothing for a guard on this router to fence.
 *
 * ADMIN-guarded rather than any-staff, matching every other access grant in the
 * product (role change, admin delete, 2FA policy). Inviting
 * somebody into an organization hands them every tenant-scoped read the organization has.
 */
@Router({ alias: 'staffInvite' })
@UseMiddlewares(AuthMiddleware)
export class StaffInviteRouter {
  constructor(private readonly staffInviteService: StaffInviteService) {}

  /**
   * Invite a colleague by address.
   *
   * Idempotency-guarded like every other mutation with an external side effect:
   * a double-submit must not mail two invitations, and must not race itself
   * into two tokens against the same person.
   *
   * The tenant comes from the ALS rather than the input, so an admin can only
   * ever invite into the organization they are signed into.
   */
  @Mutation({ input: staffInviteSendSchema, output: staffInviteSendOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware, IdempotencyMiddleware)
  async send(
    @Input() input: z.infer<typeof staffInviteSendSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    return this.staffInviteService.invite(input.email, input.role, ctx.user.id, ip, userAgent);
  }

  /**
   * Withdraw an invitation that was never accepted.
   *
   * Refuses once the invitee has set a password: that is a member, and removing
   * a member is `user.removeMember`, which is reversible and audited
   * differently.
   */
  @Mutation({ input: staffInviteRevokeSchema, output: ackOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware, IdempotencyMiddleware)
  async revoke(
    @Input() input: z.infer<typeof staffInviteRevokeSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    await this.staffInviteService.revoke(input.userId, ctx.user.id, ip, userAgent);
    return { success: true as const };
  }

  /**
   * Withdraw an invitation that would move an account from another organization.
   *
   * Keyed on the address because there is no row in this organization to click, and
   * acked identically whether or not anything was open, so it cannot be used to
   * learn whether the address has an account elsewhere.
   */
  @Mutation({ input: staffInviteWithdrawByEmailSchema, output: ackOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware, IdempotencyMiddleware)
  async withdrawByEmail(
    @Input() input: z.infer<typeof staffInviteWithdrawByEmailSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    await this.staffInviteService.withdrawByEmail(input.email, ip, userAgent);
    return { success: true as const };
  }
}
