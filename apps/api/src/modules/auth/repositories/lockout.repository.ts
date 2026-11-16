import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { now } from '../../../common/clock';

@Injectable()
export class LockoutRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * Guarded by the soft-delete filter (a bare `{ id }` read would resolve a
   * soft-deleted user that every other read excludes). Returns null when the
   * user does not exist or is soft-deleted; the service throws NotFound.
   */
  async getLockoutState(userId: string): Promise<{ lockedUntil: Date | null } | null> {
    return this.client.user.findFirst({
      where: { id: userId, ...this.notDeleted },
      select: { lockedUntil: true },
    });
  }

  /**
   * Guarded increment: the updateMany carries the soft-delete filter, so a
   * soft-deleted user is never mutated. updateMany cannot return the row, so
   * the post-increment counters are re-read on the same transaction. Returns
   * null when zero rows matched; the service throws NotFound.
   */
  async incrementFailedAttempts(
    userId: string,
  ): Promise<{ failedAttempts: number; lockoutCount: number } | null> {
    return this.client.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, ...this.notDeleted },
        data: { failedAttempts: { increment: 1 } },
      });
      if (count === 0) {
        return null;
      }
      return tx.user.findFirst({
        where: { id: userId, ...this.notDeleted },
        select: { failedAttempts: true, lockoutCount: true },
      });
    });
  }

  async applyLockout(userId: string, lockedUntil: Date): Promise<void> {
    // Guarded update: only apply when the account is not already locked. Under
    // a concurrent burst of failed logins, several callers can cross the
    // threshold at once: without this guard each would increment lockoutCount
    // and skip a progressive tier. With it, only the first writer matches; the
    // rest update zero rows.
    //
    // Soft-delete filtered like every other lockout write: this is only ever
    // reached after `incrementFailedAttempts` (already filtered) matched a live
    // row, so the filter changes no reachable outcome; it closes the window
    // where the account is erased between the increment and the lockout, which
    // would otherwise arm a lockout on a row nothing can ever unlock.
    await this.client.user.updateMany({
      where: {
        id: userId,
        ...this.notDeleted,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now() } }],
      },
      data: {
        lockedUntil,
        lockoutCount: { increment: 1 },
        failedAttempts: 0,
      },
    });
  }

  async resetAttempts(userId: string): Promise<void> {
    // Guarded reset: this runs on EVERY successful login, and the common case
    // (clean record, nothing to reset) must not pay a row write + WAL churn.
    // The predicate matches only when there is actually something to clear, so
    // the happy path updates zero rows.
    //
    // Soft-delete filtered for the same reason as `applyLockout`: this runs on a
    // successful login, and every read that resolves the account for one is
    // already `notDeleted`-guarded, so a deleted row cannot reach here through
    // any live path.
    await this.client.user.updateMany({
      where: {
        id: userId,
        ...this.notDeleted,
        OR: [{ failedAttempts: { gt: 0 } }, { lockedUntil: { not: null } }],
      },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }

  /**
   * The lockout state an admin unlock is about to erase, under the SAME
   * predicate as `fullReset`.
   *
   * Separate from `getLockoutState` because the two answer different questions:
   * that one asks "is this account locked right now" on the login path and
   * selects the one column that decides it. This one is the audit `before`
   * snapshot, and `failedAttempts` / `lockoutCount` exist nowhere else once the
   * reset overwrites them: an `updateMany` cannot return what it replaced.
   *
   * Soft-delete filtered, and it MUST stay in step with `fullReset`: the row the
   * snapshot describes has to be the row the unlock touches, so the two
   * predicates are the same predicate. A soft-deleted account is not unlockable
   * (nothing can authenticate as it, and the staff list that offers the action
   * is itself `notDeleted`-filtered), so both now resolve nothing for one and
   * the service answers NotFound rather than writing an audit row claiming an
   * erased account was released.
   */
  async getAdminUnlockState(
    userId: string,
  ): Promise<{ failedAttempts: number; lockoutCount: number; lockedUntil: Date | null } | null> {
    return this.client.user.findFirst({
      where: { id: userId, ...this.notDeleted },
      select: { failedAttempts: true, lockoutCount: true, lockedUntil: true },
    });
  }

  /**
   * Admin unlock: resets all lockout state for the target. Returns the
   * affected-row count so the service can throw NotFound on zero rows.
   */
  async fullReset(userId: string): Promise<number> {
    const result = await this.client.user.updateMany({
      // Soft-delete filtered in step with `getAdminUnlockState`; see the note
      // there for why the two predicates are one predicate.
      where: { id: userId, ...this.notDeleted },
      data: { failedAttempts: 0, lockoutCount: 0, lockedUntil: null },
    });
    return result.count;
  }
}
