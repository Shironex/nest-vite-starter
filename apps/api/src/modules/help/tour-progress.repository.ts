import { Injectable } from '@nestjs/common';
import type { Prisma, TourProgress } from '@repo/database' with { 'resolution-mode': 'import' };
import { BaseRepository } from '../../common/database/base.repository';
import { PrismaService } from '../../common/database/prisma.service';

/**
 * TourProgress persistence.
 *
 * Uses `this.client` (the tenant-scope-extended client) exactly like
 * NotificationsRepository does for NotificationPreference: TourProgress is
 * user-scoped config, not a tenant-scoped model, so the extension passes it
 * through untouched and every query here is EXPLICITLY keyed by userId. That
 * is deliberate rather than incidental: there is no tenant dimension to this
 * row at all.
 */
@Injectable()
export class TourProgressRepository extends BaseRepository {
  /*
   * Redeclared even though it only forwards, exactly as NotificationsRepository
   * does. A subclass with no constructor of its own emits no `design:paramtypes`,
   * so Nest constructs it with NO arguments and `this.prisma` is undefined:
   * a runtime 500 on the first read that no unit test sees, because a unit test
   * hands the service a fake repository.
   */
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * Serialize every save for one person on an advisory lock held to the end of
   * the transaction.
   *
   * `saveForUser` reads the whole map, merges one entry in memory and writes the
   * map back, and READ COMMITTED lets two of those interleave: two tabs
   * finishing two different tours in the same second each read `{}`, each write
   * their own single entry, and the last commit forgets the other tour, which
   * is then auto-offered again. A per-key merge is exactly the read-modify-write
   * a row lock exists for.
   *
   * Advisory rather than `SELECT ... FOR UPDATE` because the row may not exist
   * yet on a first save, and a lock on a row that is about to be INSERTED locks
   * nothing. Keying on the userId instead covers the create race too, so the
   * P2002 the caller still maps is now genuinely unreachable rather than merely
   * rare. Same primitive as `UserRepository.lockTenantMembership`.
   */
  async lockForUser(userId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tour-progress:${userId}`}::text))`;
  }

  /** The caller's row, if a tour has ever been recorded for them. */
  find(userId: string, tx?: Prisma.TransactionClient): Promise<TourProgress | null> {
    return (tx ?? this.client).tourProgress.findUnique({ where: { userId } });
  }

  create(
    userId: string,
    tours: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<TourProgress> {
    return (tx ?? this.client).tourProgress.create({ data: { userId, tours } });
  }

  update(
    id: string,
    tours: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<TourProgress> {
    return (tx ?? this.client).tourProgress.update({ where: { id }, data: { tours } });
  }
}
