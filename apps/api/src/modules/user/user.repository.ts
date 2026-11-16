import { Injectable } from '@nestjs/common';
import { ROLES, type Role } from '@repo/shared/permissions';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { BaseRepository } from '../../common/database/base.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { now } from '../../common/clock';
import type { IUserProfile, IAdminUserListPage, IListUsersParams } from './user.service';
import { idCursorArgs, pageByIdCursor } from '../../common/utils/cursor-page';
import type { AvatarOwnerPort } from '../storage/avatar-owner.port';

// The `user.me` projection.
const PROFILE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  emailVerified: true,
  createdAt: true,
} as const;

// Default finder projection. Intentionally omits the credential and lockout
// counters (passwordHash, failedAttempts, lockoutCount) so a non-login read
// never loads them into memory. This is a `select` (allowlist) rather than an
// `omit` (denylist) on purpose: a future sensitive column added to the User
// model stays out of these results by default (fail closed) instead of
// silently leaking. The two credential-verifying flows use findCredential*
// below, which return the full row.
const CREDENTIAL_FREE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  emailVerified: true,
  lockedUntil: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ADMIN_LIST_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  emailVerified: true,
  lockedUntil: true,
  createdAt: true,
  membershipEndedAt: true,
} as const;

@Injectable()
export class UserRepository extends BaseRepository implements AvatarOwnerPort {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(id: string) {
    return this.client.user.findFirst({
      where: { id, ...this.notDeleted },
      select: CREDENTIAL_FREE_SELECT,
    });
  }

  async findByEmail(email: string) {
    return this.client.user.findFirst({
      where: { email, ...this.notDeleted },
      select: CREDENTIAL_FREE_SELECT,
    });
  }

  /**
   * Whether this account is allowed to be sent, or to use, a password-reset
   * link. Answers both refusals in one round trip on a flow that runs on the
   * unauthenticated hot path.
   *
   * `passwordHash` is read but never returned: the caller gets the boolean it
   * needs, so this stays consistent with CREDENTIAL_FREE_SELECT's rule that a
   * credential does not leave the repository.
   *
   * The refusal is silent at the call site because the reset flow returns a
   * generic answer either way: a removed member keeps their address and their
   * account, and a reset would hand them a working credential whose only
   * remaining barrier is the login check.
   */
  async findPasswordResetEligibility(userId: string): Promise<{ membershipEnded: boolean } | null> {
    const user = await this.client.user.findFirst({
      where: { id: userId, ...this.notDeleted },
      select: { membershipEndedAt: true },
    });
    if (!user) return null;
    return { membershipEnded: user.membershipEndedAt !== null };
  }

  /**
   * Find a user by ID returning the FULL row, including passwordHash. Use ONLY
   * in the credential-verifying password-change flow. Every other caller should
   * use findById, which omits the credential fields.
   */
  async findCredentialById(id: string) {
    return this.client.user.findFirst({
      where: { id, ...this.notDeleted },
    });
  }

  /**
   * Find a user by email returning the FULL row, including passwordHash. Use
   * ONLY in the credential-verifying login flow. Every other caller should use
   * findByEmail, which omits the credential fields.
   */
  async findCredentialByEmail(email: string) {
    return this.client.user.findFirst({
      where: { email, ...this.notDeleted },
    });
  }

  /**
   * Accepts an optional transaction client so the password write can commit
   * atomically with the PASSWORD_RESET token revoke that must land with it.
   *
   * Guarded by the soft-delete filter (a bare `{ id }` update would mutate a
   * soft-deleted user that every read already excludes). Returns the affected
   * count so the service can throw NotFound on zero rows.
   */
  async updatePassword(
    userId: string,
    passwordHash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.client).user.updateMany({
      where: { id: userId, ...this.notDeleted },
      data: { passwordHash },
    });
    return result.count;
  }

  /**
   * Mark the user's email verified. Accepts an optional transaction client so
   * the flip can commit atomically with the verification-token consume.
   *
   * Guarded by the soft-delete filter; returns the affected count so the
   * service can throw NotFound on zero rows (which rolls the consume back).
   */
  async verifyEmail(userId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.client).user.updateMany({
      where: { id: userId, ...this.notDeleted },
      data: { emailVerified: true },
    });
    return result.count;
  }

  /**
   * Tenant-scoped role change. The `User` model is platform-global (the tenant
   * Prisma extension only scopes `workspace`), so the tenant filter is EXPLICIT
   * here. `tenantId` is non-optional on purpose: an `undefined` would be dropped
   * from the Prisma where-clause and match the target across all tenants, which
   * is the exact cross-tenant write we are closing. The caller (service) must
   * resolve and assert a concrete tenant from the ALS before calling this.
   *
   * Returns the affected-row count so the service can throw NotFound when a
   * cross-tenant `userId` matches zero rows.
   */
  async updateRoleScoped(
    userId: string,
    tenantId: string,
    role: Role,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.client).user.updateMany({
      // Live rows only: the admin surface that offers a role change lists staff
      // through `listStaff`, which is itself `notDeleted`-filtered, so a
      // soft-deleted id can only arrive by a crafted request. Zero rows is the
      // right answer for it and the service turns that into NotFound, rather
      // than promoting an erased account.
      where: { id: userId, tenantId, ...this.notDeleted },
      data: { role },
    });
    return result.count;
  }

  /**
   * Who owns this organization, or null when nobody does.
   *
   * Null is a real and permanent answer, not a missing row: nothing deletes an
   * orphan Tenant, so an organization whose only ADMIN self-deleted keeps its row with
   * no owner to name. Callers must read null as "the owner rule does not apply
   * here" rather than as an error.
   */
  async findOwnerId(tenantId: string): Promise<string | null> {
    const tenant = await this.client.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerId: true },
    });
    return tenant?.ownerId ?? null;
  }

  /**
   * The organization's display name, for the sidebar identity block. Null only when
   * the tenant row itself is gone, which nothing in the app currently does;
   * the caller (service) already treats a tenant-less session the same way.
   */
  async getTenantName(tenantId: string): Promise<string | null> {
    const tenant = await this.client.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name ?? null;
  }

  /**
   * How many other people are still working in this organization.
   *
   * Same liveness predicate as `countLiveAdmins`, and for the same reasons:
   * neither a soft-deleted nor a removed row is somebody who would be stranded.
   */
  async countOtherLiveMembers(
    tenantId: string,
    excludeUserId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    return (tx ?? this.client).user.count({
      where: {
        tenantId,
        id: { not: excludeUserId },
        deletedAt: null,
        membershipEndedAt: null,
      },
    });
  }

  /**
   * Serialize every membership decision inside one organization.
   *
   * The last-admin rule is a count followed by a write, and those are not
   * atomic on their own: two admins demoting each other concurrently both read
   * a count of two, both writes land, and the organization is left with none. That is
   * the exact state the rule exists to prevent, so the rule without this lock
   * is decoration.
   *
   * Advisory and xact-scoped: it
   * releases on commit OR rollback with no unlock path to forget, and it is
   * keyed by tenant so two organizations never wait on each other. Role changes are
   * rare, so serializing them within one organization costs nothing measurable.
   *
   * TAKE THIS BEFORE THE COUNT, never between the count and the write: a lock
   * acquired after the aggregate protects nothing, because the stale number is
   * already in hand.
   *
   * `$executeRaw`, NOT `$queryRaw`: pg_advisory_xact_lock() returns void and
   * Prisma cannot deserialize a void column, so `$queryRaw` fails with P2010 on
   * every call. Unit tests here mock Prisma and cannot see that, which is why
   * the integration spec exercises it against a real engine.
   */
  async lockTenantMembership(tenantId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tenant-membership:${tenantId}`}::text))`;
  }

  /**
   * How many admins this organization would still have if nothing changed.
   *
   * The predicate is the whole point and every clause is load-bearing.
   * `deletedAt` because a soft-deleted admin is on their way out and cannot
   * administer anything. `membershipEndedAt` because a removed member cannot
   * log in at all, and counting them would let the guard approve demoting the
   * last admin who actually can.
   *
   * `excludeUserId` asks "how many OTHER admins", which is the question a
   * demotion needs.
   */
  async countLiveAdmins(
    tenantId: string,
    tx?: Prisma.TransactionClient,
    excludeUserId?: string,
  ): Promise<number> {
    return (tx ?? this.client).user.count({
      where: {
        tenantId,
        ...(excludeUserId === undefined ? {} : { id: { not: excludeUserId } }),
        role: ROLES.ADMIN,
        deletedAt: null,
        membershipEndedAt: null,
      },
    });
  }

  /**
   * Guarded by the soft-delete filter; returns the affected count so the
   * service can throw NotFound on zero rows.
   */
  async updateAvatar(userId: string, avatarUrl: string | null): Promise<number> {
    const result = await this.client.user.updateMany({
      where: { id: userId, ...this.notDeleted },
      data: { avatarUrl },
    });
    return result.count;
  }

  /**
   * Compare-and-swap avatar write: updates only when the stored avatarUrl
   * still equals `expectedCurrent` (soft-delete guarded). Ownership of the
   * old S3 key transfers to the caller only when this returns true, so two
   * concurrent updates can never both claim (and delete) the same old object.
   */
  async updateAvatarIfCurrent(
    userId: string,
    avatarUrl: string | null,
    expectedCurrent: string | null,
  ): Promise<boolean> {
    const result = await this.client.user.updateMany({
      where: { id: userId, avatarUrl: expectedCurrent, ...this.notDeleted },
      data: { avatarUrl },
    });
    return result.count > 0;
  }

  /**
   * AvatarOwnerPort: drop the avatar reference when the object behind it was
   * deleted. The same compare-and-swap as above with a null target, so a
   * profile that has moved on to a newer avatar keeps it.
   */
  async clearAvatarIfCurrent(userId: string, key: string): Promise<boolean> {
    return this.updateAvatarIfCurrent(userId, null, key);
  }

  /**
   * Soft delete: stamp deletedAt so every notDeleted-guarded read and write
   * excludes the row from now on. The guard doubles as the idempotency check:
   * an already-deleted (or missing) user matches zero rows, and the returned
   * count lets the caller decide between success-idempotent and NotFound.
   * The row itself survives until the user-purge sweep hard-deletes it after
   * the grace window.
   */
  async softDelete(userId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.client).user.updateMany({
      where: { id: userId, ...this.notDeleted },
      data: { deletedAt: now() },
    });
    return result.count;
  }

  /**
   * Tenant-scoped role probe for the admin delete path. Like updateRoleScoped,
   * `tenantId` is non-optional on purpose: an `undefined` would be dropped
   * from the where-clause and read the target across all tenants. Returns the
   * minimal projection the guard needs (never credential fields).
   */
  async findRoleScoped(
    userId: string,
    tenantId: string,
  ): Promise<{ id: string; role: string; email: string } | null> {
    return this.client.user.findFirst({
      // Live rows only, matching listUsers: this probe backs the admin delete
      // surface.
      where: { id: userId, tenantId, ...this.notDeleted },
      // email rides along for the admin-actions broadcast: the row is gone
      // (soft-deleted) by the time the notification copy is built.
      select: { id: true, role: true, email: true },
    });
  }

  /**
   * Tenant-scoped soft delete for the admin path. The `role: { not: ADMIN }`
   * predicate repeats the service-level admin-target guard INSIDE the write so
   * a target promoted to ADMIN between the service's probe and this update
   * still cannot be deleted (no TOCTOU). Returns the affected count so the
   * service can throw NotFound on zero rows.
   */
  async softDeleteScopedNonAdmin(userId: string, tenantId: string): Promise<number> {
    const result = await this.client.user.updateMany({
      where: {
        id: userId,
        tenantId,
        role: { not: ROLES.ADMIN },
        ...this.notDeleted,
      },
      data: { deletedAt: now() },
    });
    return result.count;
  }

  async getProfile(userId: string): Promise<IUserProfile | null> {
    return this.client.user.findFirst({
      where: { id: userId, ...this.notDeleted },
      select: PROFILE_SELECT,
    });
  }

  /**
   * List one cursor page of non-deleted users for the given tenant. The `User`
   * model is platform-global (the tenant Prisma extension only scopes `workspace`),
   * so the `tenantId` filter is EXPLICIT here. `tenantId` is non-optional on
   * purpose: an `undefined` would be dropped from the Prisma where-clause and
   * leak every tenant's users. The caller (service) must resolve and assert a
   * concrete tenant from the ALS before calling this.
   *
   * Pagination: keyset on the unique `id` (Prisma `cursor` + `skip: 1` to
   * exclude the cursor row itself), ordered by `createdAt desc` with `id desc`
   * as the deterministic tiebreak. Fetches `limit + 1` rows so the presence of
   * a next page is known without a COUNT; `nextCursor` is the last returned
   * row's id, or null on the final page.
   *
   * The COUNT the settings footer states ("z 312") rides alongside on the FIRST
   * page, built from the SAME `where` binding (`pageWithTotal`, which owns the
   * count-only-without-a-cursor rule). Reusing the object rather than restating
   * it is what carries the explicit `tenantId` into the count: `User` is
   * platform-global and outside the tenant-scope extension, so a hand-written
   * count `where` that forgot it would report every organization's staff headcount as
   * this tenant's. A cursored page returns `total: null` and the panel carries
   * the first page's answer forward.
   *
   * Cheap by construction. The filter is served by
   * `(tenantId, deletedAt, createdAt desc, id desc)`, and the population is one
   * organization's own staff accounts: tens of rows, not a growing ledger.
   */
  /**
   * Resolve a member of the caller's organization by id, for the removal surfaces.
   *
   * Tenant containment lives here rather than in the service: a cross-tenant id
   * resolves to nothing and is indistinguishable from a missing one, which is
   * the same arrangement `UserRepository.findRoleScoped` uses.
   */
  async findMemberScoped(
    userId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    role: string;
    passwordHash: string | null;
    membershipEndedAt: Date | null;
  } | null> {
    return this.client.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true, role: true, passwordHash: true, membershipEndedAt: true },
    });
  }

  /**
   * End somebody's membership without deleting their account.
   *
   * The role predicate is REPEATED here rather than only probed in the service,
   * copying `softDeleteScopedNonAdmin`: an admin promoted between the probe and
   * this write must not be removable by a call that was authorized against
   * their old role. Removing an ADMIN has to go through demotion first, which
   * is what routes it past the owner and last-admin guards.
   */
  async endMembership(userId: string, tenantId: string, at: Date): Promise<number> {
    const result = await this.client.user.updateMany({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
        role: { not: ROLES.ADMIN },
        membershipEndedAt: null,
      },
      data: { membershipEndedAt: at },
    });
    return result.count;
  }

  /**
   * Put a removed member back.
   *
   * `membershipEndedAt: { not: null }` makes restoring an active member a
   * zero-row no-op rather than a silent success, so the surface cannot report
   * having restored somebody who never left.
   */
  async restoreMembership(userId: string, tenantId: string): Promise<number> {
    const result = await this.client.user.updateMany({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
        membershipEndedAt: { not: null },
      },
      data: { membershipEndedAt: null },
    });
    return result.count;
  }

  async listUsers(tenantId: string, params: IListUsersParams): Promise<IAdminUserListPage> {
    const { cursor, limit } = params;
    const where = { tenantId, ...this.notDeleted };
    const { rows, total } = await this.pageWithTotal(
      this.client.user.findMany({
        where,
        select: ADMIN_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...idCursorArgs(cursor),
      }),
      () => this.client.user.count({ where }),
      cursor,
    );

    const { rows: page, nextCursor } = pageByIdCursor(rows, limit);

    // Derive `twoFactorEnabled` for the whole page in ONE batched query (never
    // N+1): a user is 2FA-enabled iff an ACTIVE, non-recovery SecondFactor row
    // EXISTS for them. `SecondFactor` is user-scoped credential data (absent
    // from TENANT_SCOPED_MODELS), so `this.client` passes the query through
    // untouched. `distinct` collapses a user's multiple factors to a single id.
    const pageIds = page.map((user) => user.id);
    const enabledFactors =
      pageIds.length > 0
        ? await this.client.secondFactor.findMany({
            where: {
              userId: { in: pageIds },
              status: 'ACTIVE',
              type: { not: 'RECOVERY_CODE' },
            },
            select: { userId: true },
            distinct: ['userId'],
          })
        : [];
    const enabledUserIds = new Set(enabledFactors.map((factor) => factor.userId));

    // Who owns the organization, for the members list's owner badge. One indexed read
    // per page rather than per row, and null is a real answer: an organization whose
    // only ADMIN self-deleted keeps its Tenant row with no owner to name.
    const ownerId = await this.findOwnerId(tenantId);

    const items = page.map((user) => ({
      ...user,
      twoFactorEnabled: enabledUserIds.has(user.id),
      isOwner: ownerId !== null && ownerId === user.id,
      // Derived here rather than on the client, because it is the distinction
      // the removal surfaces branch on and two implementations of it would
      // eventually disagree.
      status: (user.membershipEndedAt !== null ? 'removed' : 'active') as 'active' | 'removed',
    }));
    return { items, nextCursor, total };
  }
}
