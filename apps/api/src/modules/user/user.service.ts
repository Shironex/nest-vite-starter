import { Injectable } from '@nestjs/common';
import { isDisposableEmail } from 'disposable-email-domains-js';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ROLES, type Role } from '@repo/shared/permissions';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { ForbiddenError, NotFoundError } from '../../common/errors';
import { now } from '../../common/clock';
import { UserRepository } from './user.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { SessionService } from '../auth/services/session.service';
import { AuditService } from '../audit/audit.service';

export interface IUserProfile {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: Date;
}

export interface IAdminUserListItem {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  emailVerified: boolean;
  lockedUntil: Date | null;
  createdAt: Date;
  /**
   * Derived (not a stored column): true iff the user has an ACTIVE, non-recovery
   * SecondFactor row. Batched over the page in UserRepository.listUsers.
   */
  twoFactorEnabled: boolean;
  /** When an admin disabled the account, or null while it is active. */
  disabledAt: Date | null;
  /**
   * The two states the user list distinguishes, derived in the repository so
   * the client and the disable surfaces cannot disagree about them.
   *
   *   disabled: cannot sign in. Reversible.
   *   active:   can sign in.
   */
  status: 'active' | 'disabled';
}

/** One cursor page of the admin user list. `nextCursor` is null on the last page. */
export interface IAdminUserListPage {
  items: IAdminUserListItem[];
  nextCursor: string | null;
  /**
   * Live accounts, for the user list footer's range summary.
   * Counted on the FIRST page only; null on a page cut from a cursor, and the
   * panel carries the first page's answer forward. See `pageWithTotal`.
   */
  total: number | null;
}

/** Cursor-pagination params for the admin user list (validated at the router). */
export interface IListUsersParams {
  /** Id of the last item of the previous page; omit for the first page. */
  cursor?: string | undefined;
  limit: number;
}

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Normalize email to lowercase and trim whitespace.
   * Does NOT strip dots (other providers use dots meaningfully).
   */
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Check if an email address uses a disposable/temporary email domain.
   */
  async isDisposableEmail(email: string): Promise<boolean> {
    return isDisposableEmail(email);
  }

  /**
   * Find a user by email (normalized), excluding soft-deleted users.
   */
  async findByEmail(email: string) {
    const normalized = this.normalizeEmail(email);
    return this.userRepository.findByEmail(normalized);
  }

  /**
   * Find a user by ID, excluding soft-deleted users.
   */
  async findById(id: string) {
    return this.userRepository.findById(id);
  }

  /**
   * Whether this account may be sent, or may use, a password-reset link.
   * Returns null when there is no such live account.
   */
  async findPasswordResetEligibility(userId: string) {
    return this.userRepository.findPasswordResetEligibility(userId);
  }

  /**
   * Find a user by email (normalized) INCLUDING credential fields (passwordHash).
   * Use ONLY in the login flow; the default findByEmail omits credentials so a
   * non-login read never loads the password hash into memory.
   */
  async findCredentialByEmail(email: string) {
    const normalized = this.normalizeEmail(email);
    return this.userRepository.findCredentialByEmail(normalized);
  }

  /**
   * Find a user by ID INCLUDING credential fields (passwordHash). Use ONLY in
   * the password-change flow; the default findById omits credentials.
   */
  async findCredentialById(id: string) {
    return this.userRepository.findCredentialById(id);
  }

  /**
   * Update a user's password hash. Pass the surrounding `$transaction` client
   * to make the write atomic with the token revoke that must land with it.
   * Throws NotFound when the user does not exist or is soft-deleted.
   */
  async updatePassword(
    userId: string,
    passwordHash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const count = await this.userRepository.updatePassword(userId, passwordHash, tx);
    if (count === 0) {
      throw new NotFoundError();
    }
  }

  /**
   * Mark a user's email as verified. Pass the surrounding `$transaction`
   * client to make the flip atomic with the token consume that gates it.
   * Throws NotFound when the user does not exist or is soft-deleted.
   */
  async verifyEmail(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const count = await this.userRepository.verifyEmail(userId, tx);
    if (count === 0) {
      throw new NotFoundError();
    }
  }

  /**
   * Change a user's role, then revoke all of their sessions.
   *
   * The role is snapshotted into the Redis session at login and read from there
   * by the auth and role middleware, so a role change is otherwise frozen for
   * up to the session TTL (30 days). Deleting the user's sessions forces a fresh
   * login that re-reads the new role, making the change take effect immediately.
   * Order matters: the DB write must land BEFORE the sessions are dropped.
   *
   * AUDITED, like the neighboring adminDeleteUser. A privilege grant that
   * leaves no trace makes "who made this account an admin" unanswerable. The
   * row carries the role VALUES in before/after (the auth.email.changed
   * shape): a role is not PII, and "the role field changed" is not what an
   * inspector is asking.
   *
   * Takes the ACTOR's id as well as the target's, for the self-target rule
   * below: an admin demoting themselves is how the app loses its last admin,
   * and promotion requires an admin, so nobody is left who can undo it.
   */
  async updateRole(actorUserId: string, targetUserId: string, role: Role): Promise<void> {
    // Self PROMOTION is already impossible (the procedure is admin-gated, so
    // the caller is an ADMIN), which leaves self-demotion, and a sole ADMIN
    // demoting themselves strands the app with no way back in.
    if (actorUserId === targetUserId) {
      throw new ForbiddenError();
    }

    // Read the OLD role before overwriting it: the update is a blind
    // `updateMany` returning a count, so this is the only moment the previous
    // value exists anywhere.
    const previous = await this.userRepository.findRole(targetUserId);
    if (!previous) {
      throw new NotFoundError();
    }

    // A demotion is the only direction that can empty the admin set, so the
    // guarded path is entered only for one. Promotions and no-op writes take
    // the plain update and never pay for the lock.
    const isDemotion = previous.role === ROLES.ADMIN && role !== ROLES.ADMIN;

    const count = isDemotion
      ? await this.demoteKeepingOneAdmin(targetUserId, role)
      : await this.userRepository.updateRole(targetUserId, role);
    if (count === 0) {
      // Deleted between the probe and the write.
      throw new NotFoundError();
    }

    // BEFORE the teardown, not after it like adminDeleteUser: the DB row has
    // already moved by this point, so if revokeAuthState throws (Redis down)
    // the ordering here is the difference between a privilege change with a
    // trail and one without. The actor comes from the ALS, which the target's
    // revocation cannot touch, so nothing is lost by writing early.
    await this.auditService.log({
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      targetType: 'User',
      targetId: targetUserId,
      before: { role: previous.role },
      after: { role },
    });

    await this.revokeAuthState(targetUserId);
  }

  /**
   * Disable an account without deleting it.
   *
   * The reversible alternative to deleting an account (nothing survives).
   *
   * Two refusals, and both close a door that would otherwise strand the app
   * with no admin in a single call:
   *
   *   1. self. Disabling yourself is not a thing an admin needs to do, and the
   *      last one doing it strands the app exactly as a self-demotion would.
   *   2. an ADMIN target. Disabling an admin has to go through demotion first,
   *      which is what routes it past the last-admin guard. The predicate is
   *      REPEATED inside the write, copying softDeleteNonAdmin, so a target
   *      promoted between the probe and the write cannot be disabled by a call
   *      authorized against their old role.
   *
   * Retryable. The flag commits before the session teardown, so a Redis blip in
   * revokeAuthState would otherwise strand the disabled account's live sessions
   * with no way for the admin to try again: the retry would find nothing left
   * to flag and answer NotFound. Disabling an already disabled account
   * therefore re-runs the (idempotent) teardown and succeeds, without a second
   * USER_DISABLED row.
   */
  async disableUser(actorUserId: string, targetUserId: string): Promise<void> {
    if (actorUserId === targetUserId) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'You cannot disable your own account');
    }

    const target = await this.userRepository.findForDisable(targetUserId);
    if (!target) {
      throw new NotFoundError();
    }
    if (target.role === ROLES.ADMIN) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'Demote this admin before disabling them');
    }

    if (target.disabledAt !== null) {
      // Already disabled: the retry after a failed teardown. Nothing to flag
      // and nothing new to audit.
      await this.revokeAuthState(targetUserId);
      return;
    }

    const count = await this.userRepository.disable(targetUserId, now());
    if (count === 0) {
      // Promoted, deleted or already disabled between the probe and the write.
      throw new NotFoundError();
    }

    // Audit BEFORE the teardown, for updateRole's reason: the row has already
    // moved, so writing after would make a Redis failure the difference between
    // an access removal with a trail and one without.
    await this.auditService.log({
      action: AUDIT_ACTIONS.USER_DISABLED,
      targetType: 'User',
      targetId: targetUserId,
      metadata: { role: target.role },
    });

    // The flag is enforced wherever a NEW credential or session is handed out:
    // every session mint re-reads it in TwoFactorChallengeService (password
    // login passes through there, and also refuses it at its own door for the
    // audit reason), plus the DB-token side door, password reset. Never in
    // auth.middleware, which reads the session blob and never touches the
    // database, so this call is what closes the sessions it already holds.
    await this.revokeAuthState(targetUserId);
  }

  /**
   * Enable a disabled account.
   *
   * Records whether the account is an ADMIN, because re-admitting one is a
   * privilege grant that did not pass through user.role.changed and would
   * otherwise have no answer in the trail.
   */
  async enableUser(targetUserId: string): Promise<void> {
    const target = await this.userRepository.findForDisable(targetUserId);
    if (!target || target.disabledAt === null) {
      // Enabling somebody who was never disabled is a no-op the surface must
      // not be able to report as a success.
      throw new NotFoundError();
    }

    const count = await this.userRepository.enable(targetUserId);
    if (count === 0) {
      throw new NotFoundError();
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.USER_ENABLED,
      targetType: 'User',
      targetId: targetUserId,
      metadata: { role: target.role, restoresAdmin: target.role === ROLES.ADMIN },
    });
  }

  /**
   * Refuse a self-service deletion that would strand everyone else.
   *
   * `deleteAccount` soft-deletes whatever role it is given, so the last ADMIN
   * can erase themselves and leave everyone else behind with no admin and no
   * in-app way to appoint one: promotion requires an admin. That is the same
   * permanent lockout `updateRole` guards against, through a door `updateRole`
   * cannot see.
   *
   * Deliberately conditioned on OTHER users existing. A sole user deleting
   * their own account strands nobody, and self-service deletion has to keep
   * working for it.
   */
  async assertDeletionLeavesNobodyStranded(
    user: {
      id: string;
      // The raw Prisma role string, not the narrowed `Role`: this takes a raw
      // User row.
      role: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (user.role !== ROLES.ADMIN) {
      return;
    }

    const liveAdmins = await this.userRepository.countLiveAdmins(tx);
    if (liveAdmins > 1) {
      return;
    }

    const others = await this.userRepository.countOtherLiveUsers(user.id, tx);
    if (others > 0) {
      throw new ForbiddenError(
        AppErrorCode.FORBIDDEN,
        'The app would be left with no admin. Promote another user first.',
      );
    }
  }

  /**
   * Self-service deletion: the stranding guard and the soft delete as ONE
   * serialized act.
   *
   * A count followed by a write is not atomic, and this is the same class
   * `demoteKeepingOneAdmin` takes the admin-set advisory lock for: two admins
   * pressing "delete my account" in the same second both count two live
   * admins, both writes land, and the app is left with zero admins and
   * stranded users. That is precisely the state the guard exists to prevent.
   *
   * The lock is taken only when there is an invariant to protect. A non-admin
   * cannot strand anyone, so serializing them would put every deletion behind
   * a lock for nothing.
   *
   * Returns the affected count, and deliberately does not throw on zero: a
   * concurrent double-delete already achieved what the caller asked for, and
   * the caller still owns the teardown.
   */
  async softDeleteSelfKeepingOneAdmin(user: { id: string; role: string }): Promise<number> {
    if (user.role !== ROLES.ADMIN) {
      return this.userRepository.softDelete(user.id);
    }

    return this.prismaService.client.$transaction(async (tx) => {
      // BEFORE the count, never between the count and the write.
      await this.userRepository.lockAdminSet(tx);
      await this.assertDeletionLeavesNobodyStranded(user, tx);
      return this.userRepository.softDelete(user.id, tx);
    });
  }

  /**
   * Demote an ADMIN while guaranteeing the app keeps one.
   *
   * The check and the write are one transaction under the admin-set advisory
   * lock, because a count followed by an update is not atomic: two admins
   * demoting each other concurrently would both read a count of two, both
   * writes would land, and the app would be left with none. That is exactly
   * the state this guard exists to prevent, so the guard without the lock is
   * decoration.
   */
  private async demoteKeepingOneAdmin(targetUserId: string, role: Role): Promise<number> {
    return this.prismaService.client.$transaction(async (tx) => {
      // BEFORE the count, never between the count and the write.
      await this.userRepository.lockAdminSet(tx);

      // OTHER live admins, not "all minus one": the target may already be out
      // of the live count (soft-deleted or disabled).
      const otherLiveAdmins = await this.userRepository.countLiveAdmins(tx, targetUserId);
      if (otherLiveAdmins === 0) {
        // Deliberately the generic FORBIDDEN app code, like the sibling
        // guards: the message carries the detail for the log and the audit
        // trail.
        throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'The app must keep at least one admin');
      }

      return this.userRepository.updateRole(targetUserId, role, tx);
    });
  }

  /**
   * Tear down every server-side authorization artifact for a user: all Redis
   * sessions. Shared by role change (updateRole) and the account-deletion flows;
   * the DB write that motivates the teardown must land BEFORE this runs.
   */
  async revokeAuthState(userId: string): Promise<void> {
    await this.sessionService.deleteAllUserSessions(userId);
  }

  /**
   * Soft delete a user by id (guarded by the notDeleted filter) and return the
   * affected count. Deliberately does NOT throw on zero rows: the self-service
   * flow (AccountDeletionService) treats a concurrent double-delete as
   * idempotent success and still runs the session teardown. Callers own the
   * audit write and the revokeAuthState ordering.
   */
  async softDeleteById(userId: string): Promise<number> {
    return this.userRepository.softDelete(userId);
  }

  /**
   * Soft delete another user's account (admin only). The row survives until
   * the user-purge sweep hard-deletes it after the grace window.
   *
   * Guards, all fail closed:
   *   - No self-delete: deleting your own account requires the password-
   *     confirmed self-service flow (auth.deleteAccount), never the admin path.
   *   - No admin targets: an admin cannot delete another ADMIN (deletion is a
   *     bigger hammer than a role change and gets the hard stop). The
   *     repository write repeats the role predicate so a concurrent promotion
   *     cannot slip through between the probe and the write.
   *
   * Teardown order copies updateRole: DB write first, then revokeAuthState
   * (sessions). The audit row lands last; the actor (admin) and request
   * metadata come from the ALS context, the target is explicit.
   */
  async adminDeleteUser(targetUserId: string, actorUserId: string): Promise<void> {
    if (targetUserId === actorUserId) {
      throw new ForbiddenError();
    }

    const target = await this.userRepository.findRole(targetUserId);
    if (!target) {
      throw new NotFoundError();
    }
    if (target.role === ROLES.ADMIN) {
      throw new ForbiddenError();
    }

    const count = await this.userRepository.softDeleteNonAdmin(targetUserId);
    if (count === 0) {
      // Concurrently deleted or promoted between the probe and the write.
      throw new NotFoundError();
    }

    await this.revokeAuthState(targetUserId);

    await this.auditService.log({
      action: AUDIT_ACTIONS.USER_ACCOUNT_ADMIN_DELETED,
      targetType: 'User',
      targetId: targetUserId,
    });
  }

  /**
   * List one cursor page of non-deleted users with admin-visible fields.
   * Excludes sensitive fields: passwordHash, failedAttempts, lockoutCount.
   * `limit` is validated (1..100, default 50) by the router input schema
   * before it reaches here. The router is admin-gated.
   */
  async listUsers(params: IListUsersParams): Promise<IAdminUserListPage> {
    return this.userRepository.listUsers(params);
  }

  /**
   * Get a user's public profile (excludes sensitive fields).
   * Returns: id, email, displayName, role, emailVerified, createdAt.
   */
  async getProfile(userId: string): Promise<IUserProfile> {
    const user = await this.userRepository.getProfile(userId);

    if (!user) {
      throw new NotFoundError();
    }

    return user;
  }
}
