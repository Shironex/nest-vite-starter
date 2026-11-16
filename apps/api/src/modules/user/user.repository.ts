import { Injectable } from '@nestjs/common';
import { ROLES, type Role } from '@repo/shared/permissions';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { BaseRepository } from '../../common/database/base.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { now } from '../../common/clock';
import type { IUserProfile, IAdminUserListPage, IListUsersParams } from './user.service';
import { idCursorArgs, pageByIdCursor } from '../../common/utils/cursor-page';

// The `user.me` projection.
const PROFILE_SELECT = {
  id: true,
  email: true,
  displayName: true,
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
  disabledAt: true,
} as const;

@Injectable()
export class UserRepository extends BaseRepository {
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
   * The refusal is silent at the call site because the reset flow returns a
   * generic answer either way: a disabled account keeps its address, and a
   * reset would hand it a working credential whose only remaining barrier is
   * the login check.
   */
  async findPasswordResetEligibility(userId: string): Promise<{ disabled: boolean } | null> {
    const user = await this.client.user.findFirst({
      where: { id: userId, ...this.notDeleted },
      select: { disabledAt: true },
    });
    if (!user) return null;
    return { disabled: user.disabledAt !== null };
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
   * Role change on a live row. A soft-deleted id can only arrive by a crafted
   * request (the admin list is `notDeleted`-filtered), and zero rows is the
   * right answer for it: the service turns that into NotFound rather than
   * promoting an erased account.
   */
  async updateRole(userId: string, role: Role, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.client).user.updateMany({
      where: { id: userId, ...this.notDeleted },
      data: { role },
    });
    return result.count;
  }

  /**
   * How many other people still use the app.
   *
   * Same liveness predicate as `countLiveAdmins`, and for the same reasons:
   * neither a soft-deleted nor a disabled row is somebody who would be
   * stranded.
   */
  async countOtherLiveUsers(excludeUserId: string, tx?: Prisma.TransactionClient): Promise<number> {
    return (tx ?? this.client).user.count({
      where: { id: { not: excludeUserId }, deletedAt: null, disabledAt: null },
    });
  }

  /**
   * Serialize every decision that can shrink the admin set.
   *
   * The last-admin rule is a count followed by a write, and those are not
   * atomic on their own: two admins demoting each other concurrently both read
   * a count of two, both writes land, and the app is left with none. That is
   * the exact state the rule exists to prevent, so the rule without this lock
   * is decoration.
   *
   * Advisory and xact-scoped: it releases on commit OR rollback with no unlock
   * path to forget. Role changes are rare, so serializing them costs nothing
   * measurable.
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
  async lockAdminSet(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'admin-set'}::text))`;
  }

  /**
   * How many admins the app would still have if nothing changed.
   *
   * The predicate is the whole point and every clause is load-bearing.
   * `deletedAt` because a soft-deleted admin is on their way out and cannot
   * administer anything. `disabledAt` because a disabled account cannot log in
   * at all, and counting it would let the guard approve demoting the last
   * admin who actually can.
   *
   * `excludeUserId` asks "how many OTHER admins", which is the question a
   * demotion needs.
   */
  async countLiveAdmins(tx?: Prisma.TransactionClient, excludeUserId?: string): Promise<number> {
    return (tx ?? this.client).user.count({
      where: {
        ...(excludeUserId === undefined ? {} : { id: { not: excludeUserId } }),
        role: ROLES.ADMIN,
        deletedAt: null,
        disabledAt: null,
      },
    });
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
   * Role probe for the admin role-change and delete paths. Returns the
   * minimal projection the guards need (never credential fields).
   */
  async findRole(userId: string): Promise<{ id: string; role: string } | null> {
    return this.client.user.findFirst({
      // Live rows only, matching listUsers: this probe backs the admin surface.
      where: { id: userId, ...this.notDeleted },
      select: { id: true, role: true },
    });
  }

  /**
   * Soft delete for the admin path. The `role: { not: ADMIN }` predicate
   * repeats the service-level admin-target guard INSIDE the write so a target
   * promoted to ADMIN between the service's probe and this update still cannot
   * be deleted (no TOCTOU). Returns the affected count so the service can
   * throw NotFound on zero rows.
   */
  async softDeleteNonAdmin(userId: string): Promise<number> {
    const result = await this.client.user.updateMany({
      where: { id: userId, role: { not: ROLES.ADMIN }, ...this.notDeleted },
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

  /** Resolve a live account by id, for the disable and enable surfaces. */
  async findForDisable(
    userId: string,
  ): Promise<{ id: string; role: string; disabledAt: Date | null } | null> {
    return this.client.user.findFirst({
      where: { id: userId, ...this.notDeleted },
      select: { id: true, role: true, disabledAt: true },
    });
  }

  /**
   * Disable an account without deleting it.
   *
   * The role predicate is REPEATED here rather than only probed in the service,
   * copying `softDeleteNonAdmin`: an admin promoted between the probe and this
   * write must not be disabled by a call that was authorized against their old
   * role. Disabling an ADMIN has to go through demotion first, which is what
   * routes it past the last-admin guard.
   */
  async disable(userId: string, at: Date): Promise<number> {
    const result = await this.client.user.updateMany({
      where: { id: userId, ...this.notDeleted, role: { not: ROLES.ADMIN }, disabledAt: null },
      data: { disabledAt: at },
    });
    return result.count;
  }

  /**
   * Enable a disabled account.
   *
   * `disabledAt: { not: null }` makes enabling an active account a zero-row
   * no-op rather than a silent success, so the surface cannot report having
   * enabled somebody who was never disabled.
   */
  async enable(userId: string): Promise<number> {
    const result = await this.client.user.updateMany({
      where: { id: userId, ...this.notDeleted, disabledAt: { not: null } },
      data: { disabledAt: null },
    });
    return result.count;
  }

  /**
   * List one cursor page of non-deleted users. The router is admin-gated.
   *
   * Pagination: keyset on the unique `id` (Prisma `cursor` + `skip: 1` to
   * exclude the cursor row itself), ordered by `createdAt desc` with `id desc`
   * as the deterministic tiebreak. Fetches `limit + 1` rows so the presence of
   * a next page is known without a COUNT; `nextCursor` is the last returned
   * row's id, or null on the final page.
   *
   * The COUNT the footer states rides alongside on the FIRST page, built from
   * the SAME `where` binding (`pageWithTotal`, which owns the
   * count-only-without-a-cursor rule). A cursored page returns `total: null`
   * and the panel carries the first page's answer forward. The filter and
   * order are served by `(deletedAt, createdAt desc, id desc)`.
   */
  async listUsers(params: IListUsersParams): Promise<IAdminUserListPage> {
    const { cursor, limit } = params;
    const where = { ...this.notDeleted };
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
    // EXISTS for them. `distinct` collapses a user's multiple factors to a
    // single id.
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

    const items = page.map((user) => ({
      ...user,
      twoFactorEnabled: enabledUserIds.has(user.id),
      // Derived here rather than on the client, because it is the distinction
      // the disable surfaces branch on and two implementations of it would
      // eventually disagree.
      status: (user.disabledAt !== null ? 'disabled' : 'active') as 'active' | 'disabled',
    }));
    return { items, nextCursor, total };
  }
}
