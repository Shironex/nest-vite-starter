import { Injectable } from '@nestjs/common';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { type Role } from '@repo/shared/permissions';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { PENDING_INVITATION_WHERE } from '../../user/pending-invitation.util';
import { STAFF_INVITE_TOKEN_TYPE } from './staff-invite.constants';

/** What the invite algorithm needs to know about an address that already exists. */
export interface IExistingAccountRow {
  id: string;
  role: string;
  tenantId: string | null;
  deletedAt: Date | null;
  passwordHash: string | null;
  emailVerified: boolean;
  membershipEndedAt: Date | null;
}

/**
 * Reads and writes for staff invitations.
 *
 * Every method here touches `User`, `Tenant` or `Token`, none of which are in
 * TENANT_SCOPED_MODELS, so the tenant predicate is written out explicitly on
 * every statement rather than injected by the extension. That is not a
 * shortcut around the boundary, it is where the boundary is enforced for these
 * models, and it is the same arrangement `UserRepository` already works under.
 */
@Injectable()
export class StaffInviteRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * The account holding this address, anywhere in the product.
   *
   * DELIBERATELY GLOBAL and deliberately unscoped: `User.email` is unique
   * across every organization and every persona, so the question "can this address be
   * invited" cannot be answered inside one tenant. The caller never learns the
   * answer's shape, which is what keeps this off the enumeration surface: every
   * branch that reads a foreign account returns the same response as a fresh
   * address.
   */
  async findAccountByEmail(email: string): Promise<IExistingAccountRow | null> {
    return this.client.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        tenantId: true,
        deletedAt: true,
        passwordHash: true,
        emailVerified: true,
        membershipEndedAt: true,
      },
    });
  }

  /**
   * Create the pending member: a real User row with no password.
   *
   * `emailVerified: false` and `passwordHash: null` together are what "pending"
   * MEANS here (`PENDING_INVITATION_WHERE`). There is no status column, and
   * adding one would give the invariant two homes: the guarded acceptance
   * UPDATE keys on that same pair, so it is the thing that makes the invitation
   * still open, and anything else would be a second opinion about it.
   */
  async createPendingMember(email: string, tenantId: string, role: Role): Promise<{ id: string }> {
    return this.client.user.create({
      data: {
        email,
        tenantId,
        role,
        passwordHash: null,
        emailVerified: false,
      },
      select: { id: true },
    });
  }

  /**
   * Set the password on a pending account that is already in the target organization.
   *
   * The predicate IS the security control, not a sanity check. The pending
   * pair means only an account that has never been used can be claimed this
   * way, so a leaked or replayed token cannot overwrite a live colleague's
   * credential. Both halves, not `passwordHash: null` alone: a Google-only
   * member has no password either, and is a colleague, not an invitation. Zero
   * rows is returned rather than
   * thrown so the caller can answer with the generic INVALID_TOKEN: which of
   * these failed must not be readable from outside.
   */
  async acceptInPlace(
    tx: Prisma.TransactionClient,
    userId: string,
    tenantId: string,
    passwordHash: string,
  ): Promise<number> {
    const result = await tx.user.updateMany({
      // `deletedAt: null` spelled out rather than spread, matching
      // `acceptAndMove` below: a soft-deleted invitation still carries a null
      // passwordHash, so without it a withdrawn colleague's dead row could be
      // revived by replaying the link that was minted before the withdrawal.
      where: {
        id: userId,
        tenantId,
        ...PENDING_INVITATION_WHERE,
        deletedAt: null,
      },
      data: { passwordHash, emailVerified: true },
    });
    return result.count;
  }

  /**
   * Accept an invitation on an account that lives in a DIFFERENT organization: set the
   * password, move the row, and take the invited role.
   *
   * The one sanctioned mutation of `User.tenantId` in the product. Note what
   * the predicate does NOT include: `passwordHash: null`. An existing account
   * has a password by definition, so requiring a null one here would make the
   * collision path unreachable. What replaces it as the control is that the
   * caller reached this method at all: it is only called after the token was
   * consumed atomically and, when the account carries an active second factor,
   * after a valid TOTP or recovery code.
   *
   * `membershipEndedAt: null` clears a removal on the way in: somebody who left
   * an organization and was invited to another arrives as a full member of the new one.
   */
  async acceptAndMove(
    tx: Prisma.TransactionClient,
    userId: string,
    targetTenantId: string,
    role: Role,
    passwordHash: string,
  ): Promise<number> {
    const result = await tx.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: {
        passwordHash,
        emailVerified: true,
        tenantId: targetTenantId,
        role,
        membershipEndedAt: null,
      },
    });
    return result.count;
  }

  /**
   * Every User row belonging to this organization, soft-deleted ones included.
   *
   * NOT a live count, and the difference is what stops a 500. `User.tenantId`
   * is `onDelete: Restrict`, so a soft-deleted former colleague still pending
   * purge would make the tenant delete fail with a P2003 well after the caller
   * was told the organization was abandonable. Counting every row means that organization is
   * simply not abandonable, which is the designed refusal.
   */
  async countAllUsersInTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    // No `deletedAt` filter, and this method is named in
    // SOFT_DELETE_ALLOW_IN_FUNCTIONS for exactly this call: the omission IS
    // the question being asked. See the note above: a live-only count would
    // report an abandonable organization whose delete then fails on the Restrict FK.
    return tx.user.count({ where: { tenantId } });
  }

  /**
   * Delete an abandoned organization.
   *
   * Only ever reached with the emptiness conditions freshly checked inside the
   * SAME serializable transaction. `Workspace.tenant` is `onDelete: Cascade`, so a
   * workspace created between a stale check and this call would be silently taken
   * with it; the isolation level, not this method, is what prevents that.
   */
  async deleteTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    await tx.tenant.delete({ where: { id: tenantId } });
  }

  /**
   * Who owns this organization, or null when nobody does. Same read and same null
   * semantics as `UserRepository.findOwnerId`: an organization whose only ADMIN
   * self-deleted keeps its row with no owner to name.
   */
  async findOwnerId(tenantId: string): Promise<string | null> {
    const tenant = await this.client.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerId: true },
    });
    return tenant?.ownerId ?? null;
  }

  /** The organization's name, for the invitation mail. */
  async findTenantName(tenantId: string): Promise<string | null> {
    const tenant = await this.client.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name ?? null;
  }

  /**
   * How the inviter is shown in the members list, for the invitation mail.
   *
   * Live rows only: a soft-deleted inviter reads as null, and the mail then
   * goes out without an inviter name rather than under a removed colleague's.
   */
  async findDisplayName(userId: string): Promise<string | null> {
    const user = await this.client.user.findFirst({
      where: { id: userId, ...this.notDeleted },
      select: { displayName: true },
    });
    return user?.displayName ?? null;
  }

  /**
   * Hard-delete an invitation that was never accepted.
   *
   * Hard, not soft, and safe precisely because of the pending predicate: an
   * account that never had a password AND never had its address vouched for
   * was never an actor on anything, so there is no trail to preserve on the row
   * itself. `passwordHash: null` alone is NOT that: a Google signup has no
   * password either, and that is how the organization owner was once deletable
   * through this method. The
   * `staff.invite.revoked` audit entry is the surviving record that the
   * invitation existed. The tenant predicate keeps a cross-tenant id matching
   * nothing, and the role predicate is absent on purpose: withdrawing an
   * invitation you sent to a future ADMIN is the same act as any other.
   */
  async deletePendingMember(userId: string, tenantId: string): Promise<number> {
    const result = await this.client.user.deleteMany({
      // Live rows only, so an already-withdrawn invitation reports zero and the
      // caller answers NotFound instead of writing a second
      // `staff.invite.revoked` audit entry for a withdrawal that already
      // happened. The purge job owns the erasure of soft-deleted rows.
      //
      // `ownedTenant: null` repeats the service's owner refusal inside the
      // write, so no future predicate drift can make this reach the owner.
      where: {
        id: userId,
        tenantId,
        ...PENDING_INVITATION_WHERE,
        deletedAt: null,
        ownedTenant: null,
      },
    });
    return result.count;
  }

  /**
   * Withdraw an invitation that would move an account from ANOTHER organization.
   *
   * There is no pending row on this path: the invitation is only the token,
   * minted against somebody else's existing account and carrying this organization as
   * `staffInviteTenantId`. So the token is what gets deleted, by its id, and
   * the account is never touched. The target-tenant clause is the boundary: a
   * organization can withdraw only an invitation INTO itself, never one somebody else
   * sent to the same person.
   *
   * Live tokens only, so a withdrawal of a link that already expired reports
   * nothing and writes no audit row. Returns the account id the invitation was
   * for, or null when there was nothing open.
   */
  async deleteForeignInviteToken(
    email: string,
    tenantId: string,
    at: Date,
  ): Promise<string | null> {
    const token = await this.client.token.findFirst({
      where: {
        type: STAFF_INVITE_TOKEN_TYPE,
        staffInviteTenantId: tenantId,
        expiresAt: { gt: at },
        user: { email },
      },
      select: { id: true, userId: true },
    });
    if (token === null) return null;

    // Guarded by the tenant again, so a token consumed or superseded between
    // the read and this write reports zero instead of a withdrawal that did
    // not happen.
    const result = await this.client.token.deleteMany({
      where: { id: token.id, type: STAFF_INVITE_TOKEN_TYPE, staffInviteTenantId: tenantId },
    });
    return result.count > 0 ? token.userId : null;
  }
}
