import { Injectable } from '@nestjs/common';
import type { Prisma, SecondFactor } from '@repo/database' with { 'resolution-mode': 'import' };
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../common/database/prisma.service';

/**
 * Local runtime mirrors of the Prisma enums. `@repo/database` is ESM-only and
 * the api compiles to CJS, so the generated enum objects cannot be imported as
 * runtime values; these `as const` maps carry the string values while the
 * Prisma-generated union (via the schema) supplies the compile-time type. Same
 * pattern TokenService uses for TokenType.
 */
export const SecondFactorType = {
  TOTP: 'TOTP',
  RECOVERY_CODE: 'RECOVERY_CODE',
  WEBAUTHN: 'WEBAUTHN',
} as const;
export type SecondFactorTypeValue = (typeof SecondFactorType)[keyof typeof SecondFactorType];

export const SecondFactorStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
} as const;
export type SecondFactorStatusValue = (typeof SecondFactorStatus)[keyof typeof SecondFactorStatus];

/**
 * SecondFactor data access. This model is USER-scoped credential data (like
 * Token), deliberately absent from TENANT_SCOPED_MODELS, so `this.client`
 * passes its queries through untouched (no tenant context required), which is
 * exactly what the pre-session login challenge needs. The repository lives in
 * the auth module by design so that unscoped access stays contained here.
 */
@Injectable()
export class SecondFactorRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * The user's ACTIVE non-recovery factor, if any. Backs the "2FA enabled"
   * derivation and the login-time challenge decision (one indexed query).
   */
  findActiveNonRecovery(userId: string): Promise<SecondFactor | null> {
    return this.client.secondFactor.findFirst({
      where: {
        userId,
        status: SecondFactorStatus.ACTIVE,
        type: { not: SecondFactorType.RECOVERY_CODE },
      },
    });
  }

  /**
   * The user's ACTIVE factor of ANY type, recovery codes included. Backs the
   * OAuth auto-link zero-factors gate: auto-linking is refused while
   * anything ACTIVE exists, and that gate is stricter than the challenge
   * decision (findActiveNonRecovery) on purpose: a recovery-only account is
   * still a 2FA-protected account for linking purposes.
   */
  findAnyActive(userId: string): Promise<SecondFactor | null> {
    return this.client.secondFactor.findFirst({
      where: { userId, status: SecondFactorStatus.ACTIVE },
    });
  }

  /** The user's ACTIVE TOTP factor, if any (verify/decrypt + enroll refusal). */
  findActiveTotp(userId: string): Promise<SecondFactor | null> {
    return this.client.secondFactor.findFirst({
      where: { userId, type: SecondFactorType.TOTP, status: SecondFactorStatus.ACTIVE },
    });
  }

  /** The user's PENDING TOTP row (enrollment confirm / activate). */
  findPendingTotp(userId: string): Promise<SecondFactor | null> {
    return this.client.secondFactor.findFirst({
      where: { userId, type: SecondFactorType.TOTP, status: SecondFactorStatus.PENDING },
    });
  }

  /** Replace any existing PENDING TOTP row on a fresh begin-enrollment. */
  async deletePendingTotp(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.client).secondFactor.deleteMany({
      where: { userId, type: SecondFactorType.TOTP, status: SecondFactorStatus.PENDING },
    });
  }

  createPendingTotp(
    data: { userId: string; totpSecretEnc: string },
    tx?: Prisma.TransactionClient,
  ): Promise<SecondFactor> {
    return (tx ?? this.client).secondFactor.create({
      data: {
        userId: data.userId,
        type: SecondFactorType.TOTP,
        status: SecondFactorStatus.PENDING,
        totpSecretEnc: data.totpSecretEnc,
      },
    });
  }

  /**
   * Flip a PENDING TOTP row to ACTIVE (inside the activate transaction). The
   * `status: PENDING` predicate makes this a compare-and-set: a concurrent
   * second activate of the same row sees count 0 and the caller aborts, so the
   * recovery-code batch is never minted twice. Returns the rows updated (0 or 1).
   */
  async activateTotp(id: string, activatedAt: Date, tx: Prisma.TransactionClient): Promise<number> {
    const { count } = await tx.secondFactor.updateMany({
      where: { id, status: SecondFactorStatus.PENDING },
      data: { status: SecondFactorStatus.ACTIVE, activatedAt, lastUsedAt: activatedAt },
    });
    return count;
  }

  /** Insert freshly generated recovery-code rows (inside a transaction). */
  createRecoveryCodes(userId: string, codeHashes: readonly string[], tx: Prisma.TransactionClient) {
    return tx.secondFactor.createMany({
      data: codeHashes.map((codeHash) => ({
        userId,
        type: SecondFactorType.RECOVERY_CODE,
        status: SecondFactorStatus.ACTIVE,
        codeHash,
      })),
    });
  }

  /** Delete every recovery-code row for a user (regeneration replace-all). */
  deleteRecoveryCodes(userId: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.client).secondFactor.deleteMany({
      where: { userId, type: SecondFactorType.RECOVERY_CODE },
    });
  }

  /** Hard-delete EVERY factor row for a user (disable / admin reset). */
  deleteAllForUser(userId: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.client).secondFactor.deleteMany({ where: { userId } });
  }

  /** Count of unused recovery codes (status card + low-codes nag). */
  countUnusedRecoveryCodes(userId: string): Promise<number> {
    return this.client.secondFactor.count({
      where: { userId, type: SecondFactorType.RECOVERY_CODE, usedAt: null },
    });
  }

  /**
   * Atomically redeem a recovery code. The `usedAt: null` predicate INSIDE the
   * update is the single-use lock: returns true only if THIS call flipped the
   * row (count 1); a concurrent duplicate redemption sees count 0.
   */
  async redeemRecoveryCode(
    userId: string,
    codeHash: string,
    usedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await (tx ?? this.client).secondFactor.updateMany({
      where: { userId, type: SecondFactorType.RECOVERY_CODE, codeHash, usedAt: null },
      data: { usedAt },
    });
    return count === 1;
  }

  /** Record the last-used timestamp on a factor after a successful challenge. */
  async touchLastUsed(id: string, lastUsedAt: Date): Promise<void> {
    await this.client.secondFactor.update({ where: { id }, data: { lastUsedAt } });
  }
}
