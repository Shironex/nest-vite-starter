import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { PASSWORD_RESET_TOKEN_TTL_MS, VERIFICATION_TOKEN_TTL_MS } from '@repo/shared/constants';
import { TokenRepository } from '../repositories/token.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { sha256Hex } from '../../../common/utils/crypto';
import { now, nowMs } from '../../../common/clock';
import { TOKEN_ENTROPY_BYTES } from '../auth.constants';

// Token type values. Declared locally (not imported from @repo/database) on
// purpose: @repo/database is ESM-only and apps/api compiles to CJS, so importing
// the Prisma enum as a *value* here would cross the ESM/CJS boundary. These
// string literals are the Prisma TokenType enum members.
const TokenType = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

type TokenType = (typeof TokenType)[keyof typeof TokenType];

@Injectable()
export class TokenService {
  constructor(
    private readonly tokenRepository: TokenRepository,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Hash a raw token with SHA-256 for secure storage.
   * Raw token is sent via email; only the hash is stored in the database.
   */
  private hashToken(token: string): string {
    return sha256Hex(token);
  }

  /**
   * Create an email verification token.
   * Deletes any existing verification tokens for this user first (one at a time).
   * Returns the raw token (for inclusion in email verification link).
   *
   * Delete-then-create must run in ONE transaction: outside it, concurrent
   * requests can interleave so both deletes run before either create, leaving
   * two live single-use tokens for the same user. A caller that already runs
   * inside a `$transaction` (e.g. registration) passes its `tx` client so the
   * token commits (or rolls back) with the surrounding writes; otherwise a
   * dedicated transaction is opened here.
   */
  async createVerificationToken(userId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const rawToken = randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');
    const hashedToken = this.hashToken(rawToken);
    const expiresAt = new Date(nowMs() + VERIFICATION_TOKEN_TTL_MS);

    const write = async (client: Prisma.TransactionClient): Promise<void> => {
      await this.tokenRepository.deleteUserTokensByType(
        userId,
        TokenType.EMAIL_VERIFICATION,
        client,
      );
      await this.tokenRepository.create(
        {
          userId,
          type: TokenType.EMAIL_VERIFICATION,
          token: hashedToken,
          expiresAt,
        },
        client,
      );
    };

    if (tx) {
      await write(tx);
    } else {
      await this.prismaService.client.$transaction(write);
    }

    return rawToken;
  }

  /**
   * Create a password reset token.
   * Deletes any existing reset tokens for this user first.
   * Returns the raw token (for inclusion in password reset link).
   */
  async createPasswordResetToken(userId: string): Promise<string> {
    const rawToken = randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');
    const hashedToken = this.hashToken(rawToken);
    const expiresAt = new Date(nowMs() + PASSWORD_RESET_TOKEN_TTL_MS);

    // Delete-then-create in ONE transaction (see createVerificationToken).
    await this.prismaService.client.$transaction(async (tx) => {
      await this.tokenRepository.deleteUserTokensByType(userId, TokenType.PASSWORD_RESET, tx);
      await this.tokenRepository.create(
        {
          userId,
          type: TokenType.PASSWORD_RESET,
          token: hashedToken,
          expiresAt,
        },
        tx,
      );
    });

    return rawToken;
  }

  /**
   * Validate a raw token of a given type.
   * Hashes the token, looks it up in the database, checks expiration.
   * If valid, deletes the token (one-time use) and returns the userId.
   * If expired, deletes and returns null.
   *
   * When called inside a `$transaction`, pass the `tx` client so the
   * single-use consume commits (or rolls back) together with the side effect
   * it guards; without it a crash after the consume burns the token with the
   * effect never applied.
   */
  async validateToken(
    rawToken: string,
    type: TokenType,
    tx?: Prisma.TransactionClient,
  ): Promise<{ userId: string } | null> {
    const hashedToken = this.hashToken(rawToken);

    const tokenRecord = await this.tokenRepository.findByHashedToken(hashedToken, type);

    if (!tokenRecord) {
      return null;
    }

    // Atomic single-use gate: only the caller that actually deletes the row
    // wins. A concurrent redemption of the same token deletes 0 rows and is
    // rejected here, so the token can never be consumed twice.
    const consumed = await this.tokenRepository.consumeById(tokenRecord.id, tx);
    if (!consumed) {
      return null;
    }

    // Check if expired (token already deleted above: one-time use either way)
    if (tokenRecord.expiresAt < now()) {
      return null;
    }

    return { userId: tokenRecord.userId };
  }

  /**
   * Invalidate all of a user's tokens of a given type. Used e.g. on password
   * change to revoke any outstanding PASSWORD_RESET token (account-takeover
   * vector) and any pending EMAIL_VERIFICATION token.
   *
   * When called inside a `$transaction`, pass the `tx` client so the revoke
   * commits (or rolls back) together with the write it guards.
   */
  async invalidateUserTokens(
    userId: string,
    type: TokenType,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.tokenRepository.deleteUserTokensByType(userId, type, tx);
  }
}

export { TokenType };
