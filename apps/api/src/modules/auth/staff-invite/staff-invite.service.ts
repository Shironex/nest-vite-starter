import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { STAFF_INVITE_TOKEN_TTL_MS } from '@repo/shared/constants';
import { ROLES, type Role } from '@repo/shared/permissions';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors';
import { PrismaService } from '../../../common/database/prisma.service';
import { getTenantId, requestContext } from '../../../common/context/request-context';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { UserService } from '../../user/user.service';
import { isPendingInvitation } from '../../user/pending-invitation.util';
import { PasswordService } from '../services/password.service';
import { AuthSharedService } from '../services/auth-shared.service';
import { StepUpService } from '../services/step-up.service';
import { TokenRepository } from '../repositories/token.repository';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import { sha256Hex } from '../../../common/utils/crypto';
import { now, nowMs } from '../../../common/clock';
import { TOKEN_ENTROPY_BYTES } from '../auth.constants';
import {} from '../two-factor.util';
import {
  STAFF_INVITE_ACCEPT_RATE_LIMIT,
  STAFF_INVITE_ACCEPT_RATE_WINDOW_SECONDS,
  STAFF_INVITE_FAILURE_REASONS,
  STAFF_INVITE_TOKEN_TYPE,
  type StaffInviteFailureReason,
} from './staff-invite.constants';
import { StaffInviteRepository } from './staff-invite.repository';

export interface IStaffInviteResult {
  pending: true;
  /**
   * Whether the invitation mail reached the queue. False means the account and
   * the token exist but nothing was sent, which is a re-invitable state rather
   * than a broken one, and the admin has to be told: the invitee cannot log in
   * to ask for another link.
   */
  emailSent: boolean;
}

/** How many members one organization may hold. Unbounded today; see `assertCanAddMember`. */
const SEAT_LIMIT: number | null = null;

/**
 * Staff invitations into an existing organization.
 *
 * Until this shipped, every registration provisioned a NEW organization through
 * ProvisioningService, so every account was a single-operator tenant. This is the one
 * path by which a second person joins an existing one.
 *
 * The flow is deliberately the Token-table flow with a new type rather than a
 * new mechanism: mint a single-use hashed token
 * with a 7-day TTL, mail the link, and on acceptance set the password and flip
 * emailVerified. Reusing it means the hourly expired-token sweep, the atomic
 * single-use consume and the hashed-at-rest storage are the implementations
 * already in production rather than three new ones.
 *
 * The hard part is the collision case, and it is the whole difficulty of this
 * file. `User.email` is unique across
 * the entire product, so an address invited here may already belong to somebody
 * running their own organization. Accepting then MOVES that account, which is the only
 * sanctioned mutation of `User.tenantId` anywhere, and can close the organization it
 * came from. Everything serializable, every disclosure, and the second-factor
 * gate below exist for that one branch.
 */
@Injectable()
export class StaffInviteService {
  private readonly logger = new Logger(StaffInviteService.name);

  constructor(
    private readonly repository: StaffInviteRepository,
    private readonly tokenRepository: TokenRepository,
    private readonly prismaService: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly shared: AuthSharedService,
    private readonly secondFactorRepository: SecondFactorRepository,
    private readonly stepUpService: StepUpService,
  ) {}

  /**
   * Invite a colleague into the caller's organization.
   *
   * Five outcomes, and the ones that look alike on the wire are alike on
   * purpose: a fresh address, a re-invite and a collision all return the same
   * shape. This procedure must not become a way to ask whether an address has an
   * account, so it never reports that it found one somewhere else, and never
   * inspects whether that other organization is empty. The emptiness answer would be
   * stale by acceptance anyway, which is why it is decided there instead.
   */
  async invite(
    email: string,
    role: Role,
    actorUserId: string,
    ip: string,
    userAgent: string,
  ): Promise<IStaffInviteResult> {
    const tenantId = this.requireTenant();
    await this.assertCanAddMember(tenantId, ip, userAgent);

    const normalizedEmail = this.userService.normalizeEmail(email);
    // GLOBAL, not tenant-scoped: `User.email` is unique across every organization, so
    // "can this address be invited" is unanswerable inside one tenant.
    const existing = await this.repository.findAccountByEmail(normalizedEmail);

    if (existing === null) {
      return this.inviteFreshAddress(normalizedEmail, role, actorUserId, tenantId, ip, userAgent);
    }

    // The refusal below names a property of somebody else's row, so it may
    // only ever be spoken to the organization that owns it. Outside that organization it is
    // an oracle: one call per address classifies the whole deployment into
    // deleted / other, which is exactly what the docblock above
    // promises this procedure never does. A foreign hit is answered with the
    // fresh-address response instead, and the failure row is still written.
    const foreign = existing.tenantId !== tenantId;

    if (existing.deletedAt !== null) {
      // The soft-deleted row holds the globally unique address until the purge
      // sweep runs, so this is a real month-long wait and the copy says so.
      // Presenting "delete your account and get re-invited" as an immediate
      // remedy would be presenting one that fails for four weeks.
      await this.auditInviteFailure(
        existing.id,
        STAFF_INVITE_FAILURE_REASONS.DELETED_ADDRESS,
        ip,
        userAgent,
      );
      if (foreign) {
        return this.refuseSilently();
      }
      throw new ConflictError(
        AppErrorCode.EMAIL_IN_USE,
        'That email address belongs to a deleted account. It becomes available again once the account is purged, about a month after deletion.',
      );
    }

    if (!foreign) {
      return this.inviteSameOrganizationAddress(
        existing,
        normalizedEmail,
        actorUserId,
        tenantId,
        ip,
        userAgent,
      );
    }

    return this.inviteForeignAddress(
      existing.id,
      normalizedEmail,
      role,
      actorUserId,
      tenantId,
      ip,
      userAgent,
    );
  }

  /** The ordinary case: nobody holds this address, so the invitation creates the member. */
  private async inviteFreshAddress(
    normalizedEmail: string,
    role: Role,
    actorUserId: string,
    tenantId: string,
    ip: string,
    userAgent: string,
  ): Promise<IStaffInviteResult> {
    const created = await this.repository.createPendingMember(normalizedEmail, tenantId, role);
    const rawToken = await this.mintFreshToken(created.id, null, null);
    return this.finishInvite(
      created.id,
      normalizedEmail,
      rawToken,
      { role, movesExistingAccount: false, outcome: 'created' },
      actorUserId,
      tenantId,
      ip,
      userAgent,
    );
  }

  /**
   * The address already belongs to this organization. Two of the three sub-cases are
   * refusals, and the third is the supported resend.
   */
  private async inviteSameOrganizationAddress(
    existing: {
      id: string;
      role: string;
      passwordHash: string | null;
      emailVerified: boolean;
      membershipEndedAt: Date | null;
    },
    normalizedEmail: string,
    actorUserId: string,
    tenantId: string,
    ip: string,
    userAgent: string,
  ): Promise<IStaffInviteResult> {
    if (existing.membershipEndedAt !== null) {
      // They were removed from THIS organization. The action wanted is restore, which
      // is one click on the members list and keeps their history; re-inviting
      // would mint a set-password link for an account that already has one.
      await this.auditInviteFailure(
        existing.id,
        STAFF_INVITE_FAILURE_REASONS.REMOVED_MEMBER,
        ip,
        userAgent,
      );
      throw new ConflictError(
        AppErrorCode.ALREADY_EXISTS,
        'That person was removed from this organization. Restore them from the members list instead of inviting them again.',
      );
    }

    // The pending pair, not `passwordHash !== null`: a Google-only colleague has
    // no password and IS a member, and treating them as an open invitation
    // would mail a set-password link for an account that is already in use.
    if (!isPendingInvitation(existing)) {
      await this.auditInviteFailure(
        existing.id,
        STAFF_INVITE_FAILURE_REASONS.ALREADY_A_MEMBER,
        ip,
        userAgent,
      );
      throw new ConflictError(
        AppErrorCode.ALREADY_EXISTS,
        'That person is already a member of this organization.',
      );
    }

    // Pending and unaccepted: a resend. The link expires after 7 days and the
    // invitee has no way to ask for another, so this is a normal, supported
    // action rather than an error. The ROLE is deliberately not re-applied from
    // this call: the pending row's current role is the truth, because an admin
    // may have re-graded it through the ordinary role surface since.
    const rawToken = await this.mintFreshToken(existing.id, null, null);
    return this.finishInvite(
      existing.id,
      normalizedEmail,
      rawToken,
      { role: existing.role, movesExistingAccount: false, outcome: 'reinvited' },
      actorUserId,
      tenantId,
      ip,
      userAgent,
    );
  }

  /**
   * The address belongs to an account in a DIFFERENT organization that cannot be
   * invited at all (a soft-deleted account still holding the address).
   *
   * Nothing is minted and nothing is mailed, but the answer is the one the
   * caller would have got for an address nobody holds. `emailSent: true` is the
   * fresh-address value: the alternative, reporting a delivery that did not
   * happen as failed, would restore the very distinction this method removes.
   * The audit failure row is written before this returns, so the refusal is
   * visible to the organization that owns the account and to an operator, just not to
   * the caller.
   */
  private refuseSilently(): IStaffInviteResult {
    return { pending: true, emailSent: true };
  }

  /**
   * The address belongs to a live staff account in a DIFFERENT organization.
   *
   * The token is minted against that existing account and carries the target
   * tenant and the invited role, because there is no pending row here to carry
   * them. Nothing is moved yet: the invitation is an offer, and the move happens
   * only when the holder of that account proves they hold it.
   *
   * The response is byte-identical to the fresh-address one. The caller is never
   * told the address exists elsewhere.
   */
  private async inviteForeignAddress(
    existingUserId: string,
    normalizedEmail: string,
    role: Role,
    actorUserId: string,
    tenantId: string,
    ip: string,
    userAgent: string,
  ): Promise<IStaffInviteResult> {
    const rawToken = await this.mintFreshToken(existingUserId, tenantId, role);
    return this.finishInvite(
      existingUserId,
      normalizedEmail,
      rawToken,
      { role, movesExistingAccount: true, outcome: 'created' },
      actorUserId,
      tenantId,
      ip,
      userAgent,
    );
  }

  /**
   * Replace whatever invitation the account holds with a fresh one.
   *
   * BOTH HALVES OR NEITHER, in one transaction: outside one, two concurrent
   * invitations can interleave so both deletes run before either create, leaving
   * two live single-use tokens against the same account.
   *
   * The delete is scoped by TYPE only and not by target tenant, deliberately. An
   * account holds at most one open staff invitation at a time; a second organization
   * inviting the same person supersedes the first, which is the same "the newest
   * link is the live one" rule every other token flow in this repo follows.
   */
  private async mintFreshToken(
    userId: string,
    staffInviteTenantId: string | null,
    staffInviteRole: Role | null,
  ): Promise<string> {
    const rawToken = randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');
    const expiresAt = new Date(nowMs() + STAFF_INVITE_TOKEN_TTL_MS);

    await this.prismaService.client.$transaction(async (tx) => {
      await this.tokenRepository.deleteUserTokensByType(userId, STAFF_INVITE_TOKEN_TYPE, tx);
      await tx.token.create({
        data: {
          userId,
          type: STAFF_INVITE_TOKEN_TYPE,
          token: sha256Hex(rawToken),
          expiresAt,
          staffInviteTenantId,
          staffInviteRole,
        },
      });
    });

    return rawToken;
  }

  /** Mail the link and audit, shared by every invite path. */
  private async finishInvite(
    userId: string,
    normalizedEmail: string,
    rawToken: string,
    invitation: { role: string; movesExistingAccount: boolean; outcome: 'created' | 'reinvited' },
    actorUserId: string,
    tenantId: string,
    ip: string,
    userAgent: string,
  ): Promise<IStaffInviteResult> {
    const inviteUrl = `${this.shared.appUrl}/auth/invite/${rawToken}`;
    const [organizationName, inviterName] = await Promise.all([
      this.repository.findTenantName(tenantId),
      this.repository.findDisplayName(actorUserId),
    ]);

    let emailSent = true;
    try {
      // `movesExistingAccount` picks the TEMPLATE, and that choice is the
      // disclosure: on that path, accepting closes the reader's current organization.
      await this.mailService.sendStaffInviteEmail(
        normalizedEmail,
        inviteUrl,
        organizationName ?? '',
        {
          inviterName: inviterName ?? undefined,
          movesExistingAccount: invitation.movesExistingAccount,
        },
      );
    } catch (error) {
      // Await only the ENQUEUE (delivery is async, retried, DLQ-backed). The
      // account and the token already committed, so a failed enqueue is reported
      // rather than thrown: the admin can invite again, which mints a fresh
      // token, and throwing here would strand a real pending row behind an error
      // that reads like nothing happened.
      emailSent = false;
      this.logger.error('Failed to enqueue staff invite email', error);
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.STAFF_INVITE_SENT,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
      // The role and the outcome, never the address: the invitee's address is
      // their own PII, and the target row already IS that identity.
      metadata: {
        role: invitation.role,
        outcome: invitation.outcome,
        movesExistingAccount: invitation.movesExistingAccount,
        emailSent,
      },
    });

    return { pending: true, emailSent };
  }

  /**
   * Withdraw an invitation that was never accepted.
   *
   * Hard-deletes the pending row, which is safe precisely because an account
   * that never had a password was never an actor on anything: there is no trail
   * on the row worth preserving, and the audit entry written here is the record
   * that the invitation existed. Refuses once a password is set, because that is
   * a member and removing a member is a different, reversible action.
   *
   * The owner and the caller are refused BEFORE the delete is attempted, as
   * defense in depth over the pending predicate: neither can be an open
   * invitation today, but this is a hard delete with every foreign key to
   * `User` cascading, and the one time the predicate was wrong (a Google-signup
   * owner has no password) it was the owner this method could erase.
   */
  async revoke(userId: string, actorUserId: string, ip: string, userAgent: string): Promise<void> {
    const tenantId = this.requireTenant();
    if (userId === actorUserId) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'You cannot withdraw your own account.');
    }
    const ownerId = await this.repository.findOwnerId(tenantId);
    if (ownerId !== null && ownerId === userId) {
      throw new ForbiddenError(
        AppErrorCode.FORBIDDEN,
        'The organization owner is not an invitation.',
      );
    }

    const deleted = await this.repository.deletePendingMember(userId, tenantId);
    if (deleted === 0) {
      // Covers three states with one answer: no such user, a user in another
      // organization, and a user who has already accepted. The first two must be
      // indistinguishable, and the third is genuinely a different action.
      throw new NotFoundError(
        AppErrorCode.NOT_FOUND,
        'No pending invitation to withdraw for that person.',
      );
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.STAFF_INVITE_REVOKED,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
    });
  }

  /**
   * Withdraw an invitation that would move an account from another organization.
   *
   * `revoke` cannot reach this one: there is no pending row in the caller's
   * organization, only a token against somebody else's account. So it is keyed on the
   * address the admin typed when sending it, and it deletes that token, never
   * the account.
   *
   * ALWAYS answers the same, whether or not anything was open, and that is the
   * point rather than a shortcut. `invite` answers a fresh address, a
   * staff-elsewhere address and a deleted one identically; a
   * withdrawal that said "nothing to withdraw" would undo that, because only the
   * staff-elsewhere branch leaves a token behind. The audit row is written only
   * when something was deleted, so the trail records withdrawals, not probes.
   */
  async withdrawByEmail(email: string, ip: string, userAgent: string): Promise<void> {
    const tenantId = this.requireTenant();
    const normalizedEmail = this.userService.normalizeEmail(email);
    const userId = await this.repository.deleteForeignInviteToken(normalizedEmail, tenantId, now());
    if (userId === null) return;

    await this.auditService.log({
      action: AUDIT_ACTIONS.STAFF_INVITE_REVOKED,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
      metadata: { movesExistingAccount: true },
    });
  }

  /**
   * The unauthenticated pre-check the set-password screen calls before showing
   * its form. Does NOT consume the token: a page load must not burn an invite.
   *
   * Returns the two things the form cannot be built without, and nothing else.
   * `requiresTwoFactor` decides whether to render the code field; asking every
   * invitee for a code they do not have is worse than asking the one who does.
   * `movesExistingAccount` is a disclosure rather than a convenience: accepting
   * on that path closes the reader's current organization, and a screen that takes a
   * password without saying so is a phishing page we wrote ourselves.
   *
   * Deliberately absent: the address, the inviting organization, the inviter and the
   * role. A guessed token must not be a disclosure even when it is rejected, and
   * every one of those is already answered by the mail the real invitee holds.
   */
  async getInviteState(
    rawToken: string,
    ip: string,
  ): Promise<{ valid: boolean; requiresTwoFactor: boolean; movesExistingAccount: boolean }> {
    await this.shared.enforceRateLimit(
      `staff-invite:${ip}`,
      STAFF_INVITE_ACCEPT_RATE_LIMIT,
      STAFF_INVITE_ACCEPT_RATE_WINDOW_SECONDS,
    );

    const record = await this.findLiveToken(sha256Hex(rawToken));
    if (record === null) {
      return { valid: false, requiresTwoFactor: false, movesExistingAccount: false };
    }

    const activeFactor = await this.secondFactorRepository.findActiveNonRecovery(record.userId);
    return {
      valid: true,
      requiresTwoFactor: activeFactor !== null,
      movesExistingAccount: record.staffInviteTenantId !== null,
    };
  }

  /**
   * Accept an invitation: set the password, and on the collision path move the
   * account into the inviting organization.
   *
   * ESTABLISHES NO SESSION, and that is a decision rather than an omission. The
   * invitee sets a password and then signs in through the ordinary login path,
   * which is what puts them through the lockout, the epoch fence and the 2FA
   * challenge seam like every other account. It is also what delivers the
   * role-appropriate landing for free, through the flag the login seam already
   * stamps. Consequently `session-epoch-captured` does not apply here:
   * reviewers should check that this mints no session, not that it stamps one.
   *
   * Each step is outside the transaction
   * for a reason: the token is validated before the Argon2 hash so a garbage
   * token cannot be replayed to burn hashing CPU, and the expired-row burn is
   * outside so a rollback cannot resurrect a live guessing target.
   */
  async accept(
    rawToken: string,
    newPassword: string,
    factorCode: string | undefined,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    await this.shared.enforceRateLimit(
      `staff-invite:${ip}`,
      STAFF_INVITE_ACCEPT_RATE_LIMIT,
      STAFF_INVITE_ACCEPT_RATE_WINDOW_SECONDS,
    );

    const hashedToken = sha256Hex(rawToken);
    const record = await this.findLiveToken(hashedToken, { burnExpired: true });
    if (record === null) {
      throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
    }

    await this.assertSecondFactor(record.userId, factorCode, ip);

    const passwordHash = await this.passwordService.hash(newPassword);
    const move = await this.runAcceptance(record, passwordHash);

    // AFTER the commit, and a failure here must surface rather than be
    // swallowed. The epoch bump inside the revocation IS the revocation, so the
    // residual window is a crash between commit and revoke, in which the stale
    // session carries the tenant the account just left. That tenant may no
    // longer exist, so the session fails empty rather than reading the target
    // organization, which is the safe direction but still not a state to leave sitting.
    await this.userService.revokeAuthState(record.userId);

    if (move !== null) {
      await this.auditService.log({
        action: AUDIT_ACTIONS.USER_TENANT_MOVED,
        userId: record.userId,
        targetType: 'User',
        targetId: record.userId,
        ipAddress: ip,
        userAgent,
        // Both ids AND both roles. The role half is the one easy to leave out:
        // this path sets the invited role directly, without passing through
        // updateRole, so omitting it would make "when did this person become an
        // admin" unanswerable in an application built for that question.
        before: { tenantId: move.fromTenantId, role: move.fromRole },
        after: { tenantId: move.toTenantId, role: move.toRole },
        metadata: { previousOrganizationDeleted: move.previousOrganizationDeleted },
      });
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.STAFF_INVITE_ACCEPTED,
      userId: record.userId,
      targetType: 'User',
      targetId: record.userId,
      ipAddress: ip,
      userAgent,
    });
  }

  /**
   * The acceptance transaction, SERIALIZABLE with a retry on P2034.
   *
   * Not the default isolation level, and the reason is specific rather than
   * general caution. At READ COMMITTED the emptiness counts and the tenant
   * delete are not atomic against a concurrent insert, and `Workspace.tenant` is
   * `onDelete: Cascade`. So an invitee still signed into their old organization in
   * another tab who creates a workspace while accepting could have that workspace
   * SILENTLY cascaded away: the count passes before the workspace commits, and the
   * delete then takes it. Workspace is the quiet one, which is exactly why
   * guessing at it is not good enough.
   */
  private async runAcceptance(
    record: ILiveInviteToken,
    passwordHash: string,
  ): Promise<IAcceptedMove | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prismaService.client.$transaction(
          async (tx) => this.acceptInTransaction(tx, record, passwordHash),
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        // P2034 is Postgres telling us this transaction lost a serialization
        // race, which is a retryable outcome by definition rather than a
        // failure: nothing was written. Bounded, because a retry loop that
        // never gives up on a genuinely contended row is an outage.
        if (attempt < ACCEPTANCE_SERIALIZATION_RETRIES && isSerializationFailure(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  private async acceptInTransaction(
    tx: Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0],
    record: ILiveInviteToken,
    passwordHash: string,
  ): Promise<IAcceptedMove | null> {
    const consumed = await this.tokenRepository.consumeById(record.id, tx);
    if (!consumed) {
      // A concurrent acceptance already took it. Single-use is enforced by the
      // delete winning, not by a flag anybody could forget to check.
      throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
    }

    // Unfiltered on purpose, and safe: both writes beneath it (`acceptInPlace`,
    // `acceptAndMove`) carry `deletedAt: null`, and a zero count throws
    // INVALID_TOKEN, so this read can never promote a soft-deleted row. Known
    // narrow edge: a soft-deleted account holding a live cross-tenant invite
    // reaches `isAbandonable` before `acceptAndMove`, and may get
    // ConflictError(ALREADY_EXISTS) instead of INVALID_TOKEN.
    const user = await tx.user.findUnique({
      where: { id: record.userId },
      select: { id: true, tenantId: true, role: true, membershipEndedAt: true },
    });
    if (user === null) {
      throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
    }

    // The invitation's terms come from server-side rows, never from the URL.
    // On the ordinary path the pending User row carries both; on the collision
    // path the token does, because there is no pending row.
    const targetTenantId = record.staffInviteTenantId ?? user.tenantId;
    if (targetTenantId === null) {
      throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
    }

    if (user.tenantId === targetTenantId) {
      const updated = await this.repository.acceptInPlace(
        tx,
        user.id,
        targetTenantId,
        passwordHash,
      );
      if (updated === 0) {
        // The account is gone, is not a staff account, or ALREADY has a
        // password. Same generic code either way: account state must not be
        // readable from an invitation link.
        throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
      }
      return null;
    }

    return this.moveIntoOrganization(
      tx,
      user,
      targetTenantId,
      record.staffInviteRole,
      passwordHash,
    );
  }

  /**
   * The collision branch: the account belongs to another organization and is moving.
   *
   * The `membershipEndedAt` case is separate from the abandonment case and is
   * not an optimization. Somebody REMOVED from an organization cannot log in, therefore
   * cannot self-delete, and their old organization is populated rather than abandoned.
   * Folding the two together would refuse them with a remedy they cannot perform
   * on an organization they do not own, leaving the account permanently unusable AND
   * unerasable under that address.
   */
  private async moveIntoOrganization(
    tx: Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0],
    user: { id: string; tenantId: string | null; role: string; membershipEndedAt: Date | null },
    targetTenantId: string,
    invitedRole: Role | null,
    passwordHash: string,
  ): Promise<IAcceptedMove> {
    const previousTenantId = user.tenantId;
    // The invitation's role, from the token. Falling back to the account's
    // current role would silently carry an ADMIN's privileges into an organization that
    // invited them as a USER.
    const role = invitedRole ?? ROLES.USER;

    let previousOrganizationDeleted = false;
    if (previousTenantId !== null && user.membershipEndedAt === null) {
      if (!(await this.isAbandonable(tx, previousTenantId))) {
        throw new ConflictError(
          AppErrorCode.ALREADY_EXISTS,
          'This account still belongs to an organization that has data or other people in it. Delete or hand over that organization before accepting this invitation.',
        );
      }
      previousOrganizationDeleted = true;
    }

    const updated = await this.repository.acceptAndMove(
      tx,
      user.id,
      targetTenantId,
      role,
      passwordHash,
    );
    if (updated === 0) {
      throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
    }

    // The move has to happen BEFORE the delete: `User.tenantId` is
    // `onDelete: Restrict`, so deleting the old organization while the account still
    // points at it fails on a foreign key.
    if (previousOrganizationDeleted && previousTenantId !== null) {
      await this.repository.deleteTenant(tx, previousTenantId);
    }

    return {
      fromTenantId: previousTenantId,
      toTenantId: targetTenantId,
      fromRole: user.role,
      toRole: role,
      previousOrganizationDeleted,
    };
  }

  /**
   * Whether an organization can be closed because the person leaving is all there was.
   *
   * Condition 1 counts EVERY User row rather than the live ones, and that is
   * load-bearing: `User.tenantId` is `onDelete: Restrict`, so a soft-deleted
   * former colleague still awaiting purge would abort the tenant delete with a
   * P2003 well after the caller was told this was fine. Counting every row makes
   * that organization simply not abandonable, which is the designed refusal.
   *
   * The counts run inside `requestContext.run` scoped to the OLD tenant, because
   * `workspace` is tenant-scoped, acceptance is
   * unauthenticated, and `requireScope` fails closed when the ALS carries no
   * tenantId. The `await` is INSIDE the scope on purpose: Prisma promises are
   * lazy, so one merely created inside would execute with an empty store.
   */
  private async isAbandonable(
    tx: Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0],
    tenantId: string,
  ): Promise<boolean> {
    if (!this.hasNoBillingRelationship()) return false;

    const users = await this.repository.countAllUsersInTenant(tx, tenantId);
    if (users !== 1) return false;

    return requestContext.run(
      { requestId: `staff-invite-accept-${tenantId}`, tenantId },
      async () => {
        // Every row, soft-deleted ones included, for the same reason
        // `countAllUsersInTenant` counts them: a tenant-owned row the delete
        // cannot take would make it fail with a P2003 well after this said the
        // organization was abandonable. This method is named in
        // SOFT_DELETE_ALLOW_IN_FUNCTIONS for this one call.
        const workspaces = await tx.workspace.count();
        return workspaces === 0;
      },
    );
  }

  /**
   * Whether the organization has any billing relationship that must outlive it.
   *
   * Nothing to read today, so this is `true` with a name. It is written now
   * rather than retrofitted because the acceptance transaction is the one place
   * in the product that both moves an account between tenants and DELETES a
   * tenant, and the moment to add a billing condition to that is not after it
   * has been running in production. When subscriptions, trials or a payment
   * provider's customer records exist, this is the single place they need to be
   * consulted before an organization can be closed.
   */
  private hasNoBillingRelationship(): boolean {
    return true;
  }

  /**
   * The caller's active organization, from the ALS, or a refusal.
   *
   * Resolved here rather than taken as a router argument, matching
   * `UserService.updateRole`: the tenant a mutation acts on and the rule that it
   * must exist belong in the same place, and a router that could pass one would
   * eventually pass the wrong one. Fails closed rather than falling back to
   * all-tenants. AdminMiddleware guarantees a session but not a tenant.
   */
  private requireTenant(): string {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError();
    }
    return tenantId;
  }

  /**
   * Whether the organization has room for another member.
   *
   * Always passes today: `SEAT_LIMIT` is null, because seats are not a product
   * decision anybody has made yet. It exists as a named call rather than as a
   * comment because there are THREE places a member arrives (a fresh invitation,
   * an accepted move, and a restore), and a seat rule discovered later would
   * otherwise have to find all three.
   */
  private async assertCanAddMember(tenantId: string, ip: string, userAgent: string): Promise<void> {
    if (SEAT_LIMIT === null) return;
    const members = await this.repository.countAllUsersInTenant(
      this.prismaService.client,
      tenantId,
    );
    if (members >= SEAT_LIMIT) {
      await this.auditInviteFailure(null, STAFF_INVITE_FAILURE_REASONS.NO_SEAT, ip, userAgent);
      throw new ConflictError(
        AppErrorCode.ALREADY_EXISTS,
        'This organization has no room for another member.',
      );
    }
  }

  /**
   * The second-factor gate, and the reason it is not optional.
   *
   * `resetPassword` refuses to change a password on mailbox proof alone when an
   * active factor exists, to close the mailbox-only lockout attack. Acceptance
   * does strictly MORE than a password reset on the collision path: it
   * overwrites the credential, moves the account between organizations and changes its
   * role. Without this, compromise of an invitee's mailbox would be full
   * takeover of a 2FA-protected account.
   *
   * Applied on both branches rather than only the collision one. A pending
   * account cannot have a factor, so on the ordinary path this costs one indexed
   * read and can never refuse; making it conditional would be an optimization
   * that turns into a hole the day pending accounts can enroll.
   */
  private async assertSecondFactor(
    userId: string,
    factorCode: string | undefined,
    ip: string,
  ): Promise<void> {
    await this.stepUpService.assertSecondFactor({
      userId,
      code: factorCode,
      ip,
      context: 'staff_invite_accept',
    });
  }

  /**
   * Look a token up by its hash, treating an expired one as absent.
   *
   * `burnExpired` deletes the dead row on the acceptance path only. It is useless
   * either way, but a live expired row is a guessing target, and the burn stays
   * OUTSIDE the acceptance transaction so a later rollback cannot resurrect it.
   * The pre-check does not burn, because a page load must not have side effects.
   */
  private async findLiveToken(
    hashedToken: string,
    options?: { burnExpired: boolean },
  ): Promise<ILiveInviteToken | null> {
    const record = await this.prismaService.client.token.findFirst({
      where: { token: hashedToken, type: STAFF_INVITE_TOKEN_TYPE },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        staffInviteTenantId: true,
        staffInviteRole: true,
      },
    });
    if (record === null) return null;
    if (record.expiresAt < now()) {
      if (options?.burnExpired) {
        await this.tokenRepository.deleteById(record.id);
      }
      return null;
    }
    return { ...record, staffInviteRole: asStaffRole(record.staffInviteRole) };
  }

  /**
   * Record a refusal against the account it was about.
   *
   * `targetId` is null only for the seat refusal, which is about the organization
   * rather than about any person.
   */
  private async auditInviteFailure(
    targetUserId: string | null,
    reason: StaffInviteFailureReason,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    await this.auditService.log({
      action: AUDIT_ACTIONS.STAFF_INVITE_FAILED,
      ...(targetUserId === null ? {} : { targetType: 'User', targetId: targetUserId }),
      success: false,
      ipAddress: ip,
      userAgent,
      metadata: { reason },
    });
  }
}

/** How many times a serialization failure is worth retrying before giving up. */
const ACCEPTANCE_SERIALIZATION_RETRIES = 3;

interface ILiveInviteToken {
  id: string;
  userId: string;
  expiresAt: Date;
  staffInviteTenantId: string | null;
  staffInviteRole: Role | null;
}

interface IAcceptedMove {
  fromTenantId: string | null;
  toTenantId: string;
  fromRole: string;
  toRole: string;
  previousOrganizationDeleted: boolean;
}

/**
 * The invited role, narrowed from the Prisma enum to the STAFF vocabulary.
 *
 * The column is typed `Role?` in Prisma, which is the full enum, and only the
 * staff pair is ever written here: the wire schema makes any other value
 * unrepresentable. Narrowing at the read boundary rather than casting means a
 * row that somehow held another role is read as an invitation with no role,
 * which the caller already treats as the least privileged one.
 */
function asStaffRole(role: string | null): Role | null {
  return role === ROLES.ADMIN || role === ROLES.USER ? role : null;
}

/** Postgres refused to serialize this transaction; nothing was written. */
function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034'
  );
}
