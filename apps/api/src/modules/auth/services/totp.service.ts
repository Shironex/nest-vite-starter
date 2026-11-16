import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import * as OTPAuth from 'otpauth';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { nowMs } from '../../../common/clock';
import { EncryptionService } from '../../../common/security/encryption.service';
import {
  TOTP_ALGORITHM,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_REPLAY_GUARD_TTL_SECONDS,
  TOTP_SECRET_BYTES,
  TOTP_VALIDATION_WINDOW,
} from '../auth.constants';

export interface IGeneratedTotpSecret {
  /** Plaintext base32 secret, shown once for manual entry in the authenticator. */
  secretBase32: string;
  /** otpauth:// URI the client renders as a QR code. Embeds the secret; NEVER log it. */
  otpauthUri: string;
}

/**
 * TOTP generation and verification: the single home for the `otpauth` library.
 * Keeps the locked algorithm parameters (SHA1 / 6 digits / 30 s / window 1) in
 * one place, confines secret DECRYPTION to the verify path (T02), and applies
 * the Redis replay guard uniformly to enrollment activation, challenge verify,
 * and disable.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly issuer: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    // Shown in the authenticator app as the label before the account email.
    this.issuer =
      this.configService.get<string>('TOTP_ISSUER') ||
      this.configService.get<string>('APP_NAME') ||
      'Account';
  }

  private build(secretBase32: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: this.issuer,
      label,
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
  }

  /** Provision a fresh secret + otpauth URI for enrollment. */
  generateSecret(label: string): IGeneratedTotpSecret {
    const secret = new OTPAuth.Secret({ size: TOTP_SECRET_BYTES });
    const totp = this.build(secret.base32, label);
    return { secretBase32: secret.base32, otpauthUri: totp.toString() };
  }

  /** Encrypt a base32 secret for at-rest storage (v1 AES-256-GCM wire format). */
  encryptSecret(secretBase32: string): string {
    return this.encryptionService.encrypt(secretBase32);
  }

  /**
   * Verify a submitted TOTP code against an ENCRYPTED secret, applying the
   * replay guard. Fails closed on a decrypt failure. On a valid code it
   * SETNX-claims the validated counter slot for 90 s so the same code cannot be
   * replayed inside its window; a replayed code returns false.
   */
  async verify(userId: string, totpSecretEnc: string, code: string): Promise<boolean> {
    let secretBase32: string;
    try {
      secretBase32 = this.encryptionService.decrypt(totpSecretEnc);
    } catch {
      // A tampered or undecryptable secret must never validate: fail closed.
      // Warned separately because a run of these means the ENCRYPTION_KEY
      // rotated; never log the ciphertext, the secret, or the submitted code.
      this.logger.warn('TOTP secret decryption failed (possible ENCRYPTION_KEY rotation)', {
        userId,
      });
      return false;
    }

    const totp = this.build(secretBase32, userId);
    const delta = totp.validate({ token: code.trim(), window: TOTP_VALIDATION_WINDOW });
    if (delta === null) {
      return false;
    }

    // The validated counter is the current step plus the accepted delta. Claim
    // it atomically; a second submit of the same code sees the claim and fails.
    const counter = Math.floor(nowMs() / 1000 / TOTP_PERIOD_SECONDS) + delta;
    const claimed = await this.redis.set(
      RedisKeys.twoFactorUsed(userId, counter),
      '1',
      'EX',
      TOTP_REPLAY_GUARD_TTL_SECONDS,
      'NX',
    );
    return claimed !== null;
  }
}
