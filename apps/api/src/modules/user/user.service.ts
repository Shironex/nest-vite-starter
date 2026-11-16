import { Inject, Injectable, Logger } from '@nestjs/common';
import { isDisposableEmail } from 'disposable-email-domains-js';
import Redis from 'ioredis';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ALL_ROLES, ROLES, type Role } from '@repo/shared/permissions';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { ForbiddenError, NotFoundError } from '../../common/errors';
import { getTenantId } from '../../common/context/request-context';
import { now } from '../../common/clock';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { RedisKeys } from '../../common/redis/redis-keys';
import { UserRepository } from './user.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { storageOrphanCleanupFailuresTotal } from '../metrics/metrics.registry';
import { StorageService } from '../storage/storage.service';
import { SessionRevocationService } from '../events/session-revocation.service';
import { AuditService } from '../audit/audit.service';
import { NotificationEventsService } from '../notifications/notification-events.service';

export interface IUserProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
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
  /** When their membership ended, or null while they are still a member. */
  membershipEndedAt: Date | null;
  /** The person the organization was provisioned around, who cannot be demoted. */
  isOwner: boolean;
  /**
   * The two states the members list distinguishes, derived in the repository
   * so the client and the removal surfaces cannot disagree about them.
   *
   *   removed: was a member, no longer is. Restorable.
   *   active:  a member.
   */
  status: 'active' | 'removed';
}

/** One cursor page of the admin user list. `nextCursor` is null on the last page. */
export interface IAdminUserListPage {
  items: IAdminUserListItem[];
  nextCursor: string | null;
  /**
   * Staff accounts in the tenant, for the members footer's range summary.
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
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly storageService: StorageService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly auditService: AuditService,
    private readonly notificationEvents: NotificationEventsService,
    private readonly prismaService: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
   * by the auth/permission middleware, so a role change is otherwise frozen for
   * up to the session TTL (30 days). Deleting the user's sessions forces a fresh
   * login that re-reads the new role, making the change take effect immediately.
   * Order matters: the DB write must land BEFORE the sessions are dropped.
   *
   * PermissionMiddleware also caches the effective-permission list under
   * RedisKeys.permissions(userId, role) for 5 minutes. Order matters and is the
   * inverse of the obvious one: revoke the sessions FIRST, then clear the cache.
   * If we cleared the cache first, an in-flight request on the user's old,
   * still-valid session could rebuild it from the OLD role between the clear and
   * the revoke, repoisoning the entry and keeping the old privileges live for up
   * to the TTL. Revoking first shrinks that window to requests already in flight
   * (which cannot re-authenticate on a revoked session); keying the cache by role
   * closes it entirely (a new lower-privilege session reads a different key).
   *
   * Tenant containment: the `User` model is platform-global, so an admin in
   * organization A must not be able to flip a role on a user in organization B. The update is
   * scoped to the caller's active tenant (from the ALS); a cross-tenant
   * `userId` matches zero rows and throws NotFound BEFORE any session is
   * revoked, so it never changes or revokes anything. Fails closed: a missing
   * tenant in context throws Forbidden rather than falling back to all-tenants.
   *
   * AUDITED, like the neighboring adminDeleteUser. A privilege grant that
   * leaves no trace makes "who made this account an admin" unanswerable, in an
   * application whose whole audit apparatus exists for questions of exactly that
   * shape. The row carries the role VALUES in before/after (the
   * auth.email.changed shape): a role is not PII, and "the role field changed"
   * is not what an inspector is asking.
   *
   * Takes the ACTOR's id as well as the target's. It did not, and could not
   * express a self-target rule without it, which is the whole of the guard
   * below: an admin demoting themselves is how an organization loses its last admin,
   * and promotion requires an admin, so nobody is left who can undo it. The
   * neighboring adminDeleteUser has taken an actor id all along for the same
   * class of reason.
   */
  async updateRole(actorUserId: string, targetUserId: string, role: Role): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError();
    }

    // Refused before the tenant probe, because the answer does not depend on
    // it: whatever organization you are in, you may not change your own role. Self
    // PROMOTION is already impossible (the procedure is admin-gated, so the
    // caller is an ADMIN), which leaves self-demotion, and a sole ADMIN
    // demoting themselves strands the organization with no way back in.
    if (actorUserId === targetUserId) {
      throw new ForbiddenError();
    }

    // Read the OLD role before overwriting it: the update is a blind
    // `updateMany` returning a count, so this is the only moment the previous
    // value exists anywhere. Same tenant/STAFF fence as the write, so a
    // cross-tenant id is refused here rather than one statement later.
    const previous = await this.userRepository.findRoleScoped(targetUserId, tenantId);
    if (!previous) {
      throw new NotFoundError();
    }

    // The owner is the person the organization was provisioned around, and only they
    // may change their own role, which, combined with the self-target refusal
    // above, means nobody can. That is deliberate for now: handing an organization to
    // someone else is ownership TRANSFER, an audited operation of its own, and
    // until it exists the owner is simply not demotable.
    //
    // Without this a promoted ADMIN could demote the founder and then delete
    // them, two calls that each pass every other check in the system.
    //
    // A null owner is a real, permanent population (an organization whose only ADMIN
    // self-deleted keeps its Tenant row), so the rule simply does not apply
    // there rather than failing closed.
    const ownerId = await this.userRepository.findOwnerId(tenantId);
    if (ownerId !== null && ownerId === targetUserId && actorUserId !== ownerId) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'The organization owner cannot be demoted');
    }

    // A demotion is the only direction that can empty the admin set, so the
    // guarded path is entered only for one. Promotions and no-op writes take
    // the plain update and never pay for the lock.
    const isDemotion = previous.role === ROLES.ADMIN && role !== ROLES.ADMIN;

    const count = isDemotion
      ? await this.demoteKeepingOneAdmin(targetUserId, tenantId, role)
      : await this.userRepository.updateRoleScoped(targetUserId, tenantId, role);
    if (count === 0) {
      // Deleted or moved between the probe and the write.
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

    // A cross-tenant miss above never reaches here; see revokeAuthState for
    // why the revoke must run before the cache clear.
    await this.revokeAuthState(targetUserId);

    // Fail-soft broadcast to the OTHER admins who opted in (muted by
    // default): a role grant is the tenant's security posture changing.
    // `previous.email` rather than a second read: the probe above already
    // carries it, under the tenant fence, and the address cannot have changed
    // in between in any way this broadcast cares about.
    await this.notificationEvents.adminRoleChanged({ targetEmail: previous.email, role });
  }

  /**
   * End somebody's membership of the organization without deleting their account.
   *
   * The reversible alternative to deleting an account (nothing survives). The row keeps its
   * tenantId, so the removal stays VISIBLE on the members list and can be
   * undone; modeling it as `tenantId = null` was considered and rejected,
   * because a null-tenant user fails every fail-closed tenant-scoped operation
   * AND disappears from every admin list, which is worse than either end.
   *
   * Two refusals, and both close a door that would otherwise reopen the organization
   * takeover in a single call:
   *
   *   1. self. Removing yourself is not a thing an admin needs to do, and the
   *      last one doing it strands the organization exactly as a self-demotion would.
   *   2. an ADMIN target. Removing an admin has to go through demotion first,
   *      which is what routes it past the owner guard and the last-admin guard.
   *      The predicate is REPEATED inside the write, copying
   *      softDeleteScopedNonAdmin, so a target promoted between the probe and
   *      the write cannot be removed by a call authorized against their old role.
   *
   * Retryable. The flag commits before the session teardown, so a Redis blip in
   * revokeAuthState would otherwise strand the removed member's live sessions
   * with no way for the admin to try again: the retry would find nothing left to
   * flag and answer NotFound. Removing somebody already removed therefore
   * re-runs the (idempotent) teardown and succeeds, without a second
   * MEMBER_REMOVED row.
   */
  async removeMember(actorUserId: string, targetUserId: string): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError();
    }
    if (actorUserId === targetUserId) {
      throw new ForbiddenError(
        AppErrorCode.FORBIDDEN,
        'You cannot remove yourself from the organization',
      );
    }

    const target = await this.userRepository.findMemberScoped(targetUserId, tenantId);
    if (!target) {
      // A cross-tenant id resolves to nothing here and is indistinguishable
      // from a missing one.
      throw new NotFoundError();
    }
    if (target.role === ROLES.ADMIN) {
      throw new ForbiddenError(
        AppErrorCode.FORBIDDEN,
        'Demote this admin before removing them from the organization',
      );
    }

    if (target.membershipEndedAt !== null) {
      // Already removed, in THIS organization (the probe is tenant-scoped, so a
      // cross-tenant id still answers NotFound above): the retry after a failed
      // teardown. Nothing to flag and nothing new to audit.
      await this.revokeAuthState(targetUserId);
      return;
    }

    const count = await this.userRepository.endMembership(targetUserId, tenantId, now());
    if (count === 0) {
      // Promoted, deleted or already removed between the probe and the write.
      throw new NotFoundError();
    }

    // Audit BEFORE the teardown, for updateRole's reason: the row has already
    // moved, so writing after would make a Redis failure the difference between
    // an access removal with a trail and one without.
    await this.auditService.log({
      action: AUDIT_ACTIONS.MEMBER_REMOVED,
      targetType: 'User',
      targetId: targetUserId,
      metadata: { role: target.role },
    });

    // The removal is enforced wherever a NEW credential or session is handed
    // out: every session mint re-reads it in TwoFactorChallengeService (password
    // login passes through there, and also refuses it at its own door for the
    // audit reason), plus the DB-token side
    // door, password reset. Never in auth.middleware, which
    // reads the session blob and never touches the database, so this call is
    // what closes the sessions they already hold.
    await this.revokeAuthState(targetUserId);
  }

  /**
   * Put a removed member back.
   *
   * Records whether the restored member is an ADMIN, because re-admitting one
   * is a privilege grant that did not pass through user.role.changed and would
   * otherwise have no answer in the trail.
   */
  async restoreMember(targetUserId: string): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError();
    }

    const target = await this.userRepository.findMemberScoped(targetUserId, tenantId);
    if (!target || target.membershipEndedAt === null) {
      // Restoring somebody who never left is a no-op the surface must not be
      // able to report as a success.
      throw new NotFoundError();
    }

    const count = await this.userRepository.restoreMembership(targetUserId, tenantId);
    if (count === 0) {
      throw new NotFoundError();
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.MEMBER_RESTORED,
      targetType: 'User',
      targetId: targetUserId,
      metadata: { role: target.role, restoresAdmin: target.role === ROLES.ADMIN },
    });
  }

  /**
   * Refuse a self-service deletion that would strand colleagues.
   *
   * `deleteAccount` soft-deletes whatever role it is given, so the last ADMIN
   * of an organization can erase themselves and leave everyone else behind with no
   * admin, no owner, and no in-app way to appoint one: promotion requires an
   * admin. That is the same permanent lockout `updateRole` guards against,
   * through a door `updateRole` cannot see.
   *
   * Deliberately conditioned on OTHER members existing. A sole user deleting
   * their own account is the only case that exists today, it strands nobody,
   * and self-service deletion has to keep working for it.
   */
  async assertDeletionLeavesNobodyStranded(
    user: {
      id: string;
      // The raw Prisma role string, not the narrowed `Role`: this takes a raw
      // User row.
      role: string;
      tenantId: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (user.tenantId === null || user.role !== ROLES.ADMIN) {
      return;
    }

    const liveAdmins = await this.userRepository.countLiveAdmins(user.tenantId, tx);
    if (liveAdmins > 1) {
      return;
    }

    const others = await this.userRepository.countOtherLiveMembers(user.tenantId, user.id, tx);
    if (others > 0) {
      throw new ForbiddenError(
        AppErrorCode.FORBIDDEN,
        'This organization would be left with no admin. Promote a colleague, or remove them first.',
      );
    }
  }

  /**
   * Self-service deletion: the stranding guard and the soft delete as ONE
   * serialized act.
   *
   * A count followed by a write is not atomic, and this is the same class
   * `demoteKeepingOneAdmin` takes the per-tenant advisory lock for: two admins
   * of the same organization pressing "delete my account" in the same second both
   * count two live admins, both writes land, and the organization is left with zero
   * admins and stranded members. That is precisely the state the guard exists
   * to prevent, and it has no in-app remedy: an organization with no admin cannot
   * manage members, and promotion requires an admin.
   *
   * The lock is taken only when there is an invariant to protect. A non-admin,
   * or an account with no organization, cannot strand anyone, so serializing them
   * would put every deletion in the deployment behind a lock for nothing.
   *
   * Returns the affected count, and deliberately does not throw on zero: a
   * concurrent double-delete already achieved what the caller asked for, and
   * the caller still owns the teardown.
   */
  async softDeleteSelfKeepingOneAdmin(user: {
    id: string;
    role: string;
    tenantId: string | null;
  }): Promise<number> {
    if (user.tenantId === null || user.role !== ROLES.ADMIN) {
      return this.userRepository.softDelete(user.id);
    }

    const tenantId = user.tenantId;
    return this.prismaService.client.$transaction(async (tx) => {
      // BEFORE the count, never between the count and the write.
      await this.userRepository.lockTenantMembership(tenantId, tx);
      await this.assertDeletionLeavesNobodyStranded(user, tx);
      return this.userRepository.softDelete(user.id, tx);
    });
  }

  /**
   * Demote an ADMIN while guaranteeing the organization keeps one.
   *
   * The check and the write are one transaction under a per-tenant advisory
   * lock, because a count followed by an update is not atomic: two admins
   * demoting each other concurrently would both read a count of two, both
   * writes would land, and the organization would be left with none. That is exactly
   * the state this guard exists to prevent, so the guard without the lock is
   * decoration. The repo already treats this class seriously, repeating the
   * role predicate inside the write in `softDeleteScopedNonAdmin`.
   *
   * An organization with no admin cannot create workspaces, manage members, or
   * read its own audit log, and promotion requires an admin, so there is no
   * in-app way back.
   */
  private async demoteKeepingOneAdmin(
    targetUserId: string,
    tenantId: string,
    role: Role,
  ): Promise<number> {
    return this.prismaService.client.$transaction(async (tx) => {
      // BEFORE the count, never between the count and the write.
      await this.userRepository.lockTenantMembership(tenantId, tx);

      // OTHER live admins, not "all minus one": the target may already be out
      // of the live count (soft-deleted or removed).
      const otherLiveAdmins = await this.userRepository.countLiveAdmins(tenantId, tx, targetUserId);
      if (otherLiveAdmins === 0) {
        // Deliberately the generic FORBIDDEN app code, like the sibling
        // guards: they are one class ("this membership change is not
        // allowed") and the message carries the detail for the log and the
        // audit trail.
        throw new ForbiddenError(
          AppErrorCode.FORBIDDEN,
          'An organization must keep at least one admin',
        );
      }

      return this.userRepository.updateRoleScoped(targetUserId, tenantId, role, tx);
    });
  }

  /**
   * Tear down every server-side authorization artifact for a user: all Redis
   * sessions, all live websockets, and every role-keyed permission-cache
   * entry. Shared by role change (updateRole) and the account-deletion flows;
   * the DB write that motivates the teardown must land BEFORE this runs.
   *
   * Order matters and is the inverse of the obvious one: revoke the sessions
   * FIRST, then clear the cache. If the cache were cleared first, an in-flight
   * request on a still-valid session could rebuild it from the stale state
   * between the clear and the revoke, repoisoning the entry for up to its TTL.
   * The shared revocation step also drops live sockets: an already-connected
   * socket keeps its identity until it reconnects, so revoking Redis sessions
   * alone would leave the old privileges live on the websocket channel.
   */
  async revokeAuthState(userId: string): Promise<void> {
    await this.sessionRevocation.revokeAllAndDisconnect(userId);

    // Clear every role-keyed permission entry for the user (the cache is keyed
    // by userId:role) so no stale role's permission list survives. ALL_ROLES,
    // not a hand-picked subset: PermissionMiddleware caches under whatever role
    // string the session carries, and a sweep that missed a role would leave
    // that permission list live for its full TTL after a revocation.
    await this.redis.del(...ALL_ROLES.map((r) => RedisKeys.permissions(userId, r)));
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
   *   - Tenant containment: like updateRole, the target is resolved and
   *     deleted strictly inside the caller's active tenant; a cross-tenant id
   *     matches nothing and throws NotFound before any teardown.
   *   - No self-delete: deleting your own account requires the password-
   *     confirmed self-service flow (auth.deleteAccount), never the admin path.
   *   - No admin targets: an admin cannot delete another ADMIN (mirrors the
   *     spirit of updateUserRole, which only demotes via an explicit role
   *     change; deletion is a bigger hammer and gets the hard stop). The
   *     repository write repeats the role predicate so a concurrent promotion
   *     cannot slip through between the probe and the write.
   *
   * Teardown order copies updateRole: DB write first, then revokeAuthState
   * (sessions + sockets + permission cache). The audit row lands last; the
   * actor (admin) and request metadata come from the ALS context, the target
   * is explicit.
   */
  async adminDeleteUser(targetUserId: string, actorUserId: string): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError();
    }

    if (targetUserId === actorUserId) {
      throw new ForbiddenError();
    }

    const target = await this.userRepository.findRoleScoped(targetUserId, tenantId);
    if (!target) {
      throw new NotFoundError();
    }
    if (target.role === ROLES.ADMIN) {
      throw new ForbiddenError();
    }

    // Belt and braces. The owner is stamped ADMIN at provisioning and cannot be
    // demoted, so the check above already covers them today. It is stated
    // anyway because that reasoning is a chain of two other rules, and the day
    // either one changes this is the guard that should still be standing.
    const ownerId = await this.userRepository.findOwnerId(tenantId);
    if (ownerId === targetUserId) {
      throw new ForbiddenError(AppErrorCode.FORBIDDEN, 'The organization owner cannot be removed');
    }

    const count = await this.userRepository.softDeleteScopedNonAdmin(targetUserId, tenantId);
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

    // Fail-soft broadcast to the OTHER admins who opted in (muted by default).
    await this.notificationEvents.adminUserDeleted({ targetEmail: target.email });
  }

  /**
   * List one cursor page of the caller's tenant's non-deleted users with
   * admin-visible fields. Excludes sensitive fields: passwordHash,
   * failedAttempts, lockoutCount. `limit` is validated (1..100, default 50) by
   * the router input schema before it reaches here.
   *
   * Tenant containment: the `User` model is platform-global, so the list is
   * scoped to the caller's active tenant (from the ALS) so an admin in organization A
   * cannot read organization B's users. Fails closed: a missing tenant in context
   * throws Forbidden rather than returning every tenant's users.
   */
  async listUsers(params: IListUsersParams): Promise<IAdminUserListPage> {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError();
    }

    return this.userRepository.listUsers(tenantId, params);
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

  /**
   * The caller's organization identity, for the sidebar footer block.
   * `tenantId` comes from `getTenantId()` (the session-derived ALS), never
   * from a client-supplied id.
   *
   * Deliberately does NOT fail closed like the admin-scoped methods above: a
   * missing tenant is a real, if rare, state (pre-tenant seed data) and this
   * is a read for a piece of chrome, not a tenant-scoped write. Returning a
   * null name lets the caller render a sane fallback instead of an error
   * boundary over the whole sidebar.
   */
  async getTenantIdentity(): Promise<{ name: string | null }> {
    const tenantId = getTenantId();
    if (!tenantId) {
      return { name: null };
    }

    const name = await this.userRepository.getTenantName(tenantId);
    return { name };
  }

  /**
   * Update a user's avatar URL (S3 object key).
   *
   * Cleans up the previous object so changing or clearing an avatar doesn't
   * orphan storage. Ownership of the old key is claimed with a compare-and-
   * swap: a plain read-then-write would let two concurrent updates both claim
   * the same old key and one of them would delete an object the other still
   * references. Only the caller whose swap succeeded deletes the old object.
   * Best-effort: only our own stored keys (not external http(s) URLs), only
   * when the key actually changed, and a delete failure never blocks the
   * update.
   */
  async updateAvatar(userId: string, avatarUrl: string | null): Promise<void> {
    const current = await this.userRepository.getProfile(userId);
    if (!current) {
      throw new NotFoundError();
    }

    let oldKey = current.avatarUrl ?? null;
    let swapped = await this.userRepository.updateAvatarIfCurrent(userId, avatarUrl, oldKey);

    if (!swapped) {
      // Lost a concurrent swap: re-read the fresh key and retry once.
      const fresh = await this.userRepository.getProfile(userId);
      if (!fresh) {
        throw new NotFoundError();
      }
      oldKey = fresh.avatarUrl ?? null;
      swapped = await this.userRepository.updateAvatarIfCurrent(userId, avatarUrl, oldKey);
    }

    if (!swapped) {
      // Second race loss: land the caller's write (last write wins on the
      // value) but skip deletion, since this caller cannot prove ownership
      // of whichever key it would be overwriting.
      const count = await this.userRepository.updateAvatar(userId, avatarUrl);
      if (count === 0) {
        throw new NotFoundError();
      }
      // Audited like any other landed write. `before` is the key this caller
      // last read, which after two lost races is not necessarily what it
      // overwrote; `raced` says so rather than letting the row imply a
      // certainty the code does not have.
      await this.auditService.log({
        action: AUDIT_ACTIONS.USER_AVATAR_CHANGED,
        targetType: 'User',
        targetId: userId,
        before: { avatarUrl: oldKey },
        after: { avatarUrl },
        metadata: { raced: true },
      });
      return;
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.USER_AVATAR_CHANGED,
      targetType: 'User',
      targetId: userId,
      before: { avatarUrl: oldKey },
      after: { avatarUrl },
    });

    if (oldKey && oldKey !== avatarUrl && !/^https?:\/\//i.test(oldKey)) {
      try {
        await this.storageService.delete(oldKey);
      } catch (err) {
        // Best-effort: the object is now orphaned in S3. Counted so the leak
        // rate is observable, not just individually logged.
        storageOrphanCleanupFailuresTotal.inc();
        this.logger.warn('Failed to delete previous avatar object', err);
      }
    }
  }
}
