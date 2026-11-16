import { Injectable } from '@nestjs/common';
import type { Prisma, TokenType } from '@repo/database' with { 'resolution-mode': 'import' };
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../common/database/prisma.service';

@Injectable()
export class TokenRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * Accepts an optional transaction client so the create can commit atomically
   * with the delete-previous-tokens step that precedes it.
   */
  async create(
    data: { userId: string; type: TokenType; token: string; expiresAt: Date },
    tx?: Prisma.TransactionClient,
  ) {
    return (tx ?? this.client).token.create({ data });
  }

  async findByHashedToken(hashedToken: string, type: TokenType) {
    return this.client.token.findFirst({
      where: { token: hashedToken, type },
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.client.token.delete({ where: { id } });
  }

  /**
   * Delete a token by id, returning true only if THIS call removed it. Used as
   * an atomic single-use gate: under concurrent redemption of the same token,
   * only one caller sees `true`; the loser sees `false` and is rejected.
   *
   * Accepts an optional transaction client so the consume can be made atomic
   * with the side effect it guards (e.g. emailVerified flip): pass the `tx`
   * from a surrounding `$transaction` and the delete rolls back with it.
   */
  async consumeById(id: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const { count } = await (tx ?? this.client).token.deleteMany({ where: { id } });
    return count > 0;
  }

  /**
   * Accepts an optional transaction client so the revoke can commit atomically
   * with the write it guards (e.g. the password update that must land together
   * with the PASSWORD_RESET token revoke).
   */
  async deleteUserTokensByType(
    userId: string,
    type: TokenType,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await (tx ?? this.client).token.deleteMany({
      where: { userId, type },
    });
  }

  /**
   * Delete every expired token (any type) in one filtered statement. Idempotent
   * by predicate (`expiresAt < asOf`), so the scheduled sweep races safely
   * across replicas. Returns the number of rows removed.
   */
  async deleteExpired(asOf: Date): Promise<number> {
    const { count } = await this.client.token.deleteMany({
      where: { expiresAt: { lt: asOf } },
    });
    return count;
  }
}
