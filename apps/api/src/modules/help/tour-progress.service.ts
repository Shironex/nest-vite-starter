import { Injectable } from '@nestjs/common';
import { TOUR_PROGRESS_MAX_ENTRIES, tourProgressMapSchema } from '@repo/shared/schemas';
import type {
  TourProgressMap,
  TourProgressOutput,
  TourProgressSaveInput,
} from '@repo/shared/schemas';
import type { TourProgress } from '@repo/database' with { 'resolution-mode': 'import' };
import { PrismaService } from '../../common/database/prisma.service';
import { PRISMA_ERROR, isPrismaErrorCode } from '../../common/database/prisma-error';
import { ConflictError } from '../../common/errors/domain-error';
import { nowIso } from '../../common/clock';
import { TourProgressRepository } from './tour-progress.repository';
import { AppErrorCode } from '@repo/shared/errors';

/**
 * Per-user guided-tour progress: which tours a person has already been shown.
 *
 * Shaped after NotificationPreferencesService, which is this repo's proven
 * pattern for user-scoped zod-validated Json config: one row per user, created
 * lazily on the first write, defaults when absent, and every read resolved
 * through ONE static seam (`resolveTours`). Nothing here was invented.
 *
 * Two things it does differently, both forced by what a tour is:
 *
 *   - A save carries ONE tour, not the whole map. Finishing two different tours
 *     in two tabs is ordinary, and a whole-map write would silently erase the
 *     other tab's. Merging one entry makes concurrent writes commutative.
 *   - There is no audit row. NotificationPreference logs because "who muted
 *     what" is the question asked when a reminder never arrived; "who read the
 *     help" answers nothing, happens on every screen for every user, and would
 *     dilute the audit trail it shares a table with.
 */
@Injectable()
export class TourProgressService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly repository: TourProgressRepository,
  ) {}

  async getForUser(userId: string): Promise<TourProgressOutput> {
    const row = await this.repository.find(userId);
    if (!row) return { tours: {}, updatedAt: null };
    return TourProgressService.toOutput(row);
  }

  /**
   * Record one tour's outcome, merging it into whatever is already stored.
   *
   * `completedAt` is stamped SERVER-SIDE. A client clock is the wrong authority
   * for a timestamp the settings list shows back to the user, and it is the
   * only field a caller has no reason to choose.
   */
  async saveForUser(userId: string, input: TourProgressSaveInput): Promise<TourProgressOutput> {
    const entry = { completedAt: nowIso(), version: input.version, dismissed: input.dismissed };

    let saved: TourProgress;
    try {
      saved = await this.prismaService.client.$transaction(async (tx) => {
        // BEFORE the read. Merging one entry into a map read without a lock is a
        // lost update: two tabs finishing two different tours in the same second
        // each read `{}`, each write one entry, and the second commit forgets
        // the first tour, which is then offered again.
        await this.repository.lockForUser(userId, tx);
        const existing = await this.repository.find(userId, tx);
        const merged = TourProgressService.capEntries({
          ...TourProgressService.resolveTours(existing?.tours ?? null),
          [input.tourId]: entry,
        });
        if (existing) return this.repository.update(existing.id, merged, tx);
        return this.repository.create(userId, merged, tx);
      });
    } catch (error) {
      // Kept as a backstop now that the advisory lock above serializes the
      // create race it was written for: `userId @unique` would still reject a
      // loser if the lock were ever removed, and the honest answer to that is a
      // retryable conflict, not a 500. Same shape as
      // NotificationPreferencesService.updateForUser.
      if (isPrismaErrorCode(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        throw new ConflictError(
          AppErrorCode.CONFLICT,
          'Tour progress was changed concurrently; reload and retry.',
        );
      }
      throw error;
    }

    return TourProgressService.toOutput(saved);
  }

  /**
   * Forget every tour, so all of them are offered again. The "Show them all
   * again" control in the settings list.
   *
   * Writes an empty map rather than deleting the row: the row is cheap, and
   * keeping it means the reset path is the same single UPDATE as any other save
   * instead of a delete that has to tolerate not finding anything.
   */
  async resetForUser(userId: string): Promise<TourProgressOutput> {
    const existing = await this.repository.find(userId);
    if (!existing) return { tours: {}, updatedAt: null };
    return TourProgressService.toOutput(await this.repository.update(existing.id, {}));
  }

  /**
   * The effective tour map for a (possibly absent, possibly stale) stored Json
   * blob. PUBLIC and static on purpose, mirroring
   * `NotificationPreferencesService.resolveChannels`: every path that touches
   * stored progress resolves through this same seam.
   *
   * THE TOLERANT READ LIVES HERE. `tourProgressMapSchema` drops any entry it
   * cannot parse instead of rejecting the map, so a value written by an older
   * version can never 500 somebody's read. Note what it does NOT do: an entry
   * for a tour that was renamed or removed is perfectly well formed and
   * survives, because the server has no registry to check it against. The
   * client ignores ids it no longer knows, which is where that half belongs.
   */
  static resolveTours(stored: unknown): TourProgressMap {
    return tourProgressMapSchema.parse(stored);
  }

  /**
   * Bound the blob. Not a product limit; the guard that stops a buggy or
   * hostile client turning a Json column into unbounded storage. Oldest
   * entries go first, so the recent answers to "should this auto-start" (the
   * ones that still matter) are the ones kept.
   */
  private static capEntries(tours: TourProgressMap): TourProgressMap {
    const entries = Object.entries(tours);
    if (entries.length <= TOUR_PROGRESS_MAX_ENTRIES) return tours;
    return Object.fromEntries(
      entries
        .sort(([, a], [, b]) => b.completedAt.localeCompare(a.completedAt))
        .slice(0, TOUR_PROGRESS_MAX_ENTRIES),
    );
  }

  private static toOutput(row: TourProgress): TourProgressOutput {
    return {
      tours: TourProgressService.resolveTours(row.tours),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
