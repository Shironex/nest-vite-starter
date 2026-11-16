import { Injectable, Logger } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// Argon2id algorithm = 2 (use numeric value to avoid const enum import issues)
const ARGON2ID = 2;

/**
 * Single source of truth for Argon2id tuning (OWASP-recommended parameters).
 * The timing-equalization dummy hash in login.service.ts must encode the same
 * m/t/p values, or the unknown-email branch stops paying the same verify cost
 * as a real credential check; login.service.spec.ts asserts they stay in sync.
 */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // 19 MiB (OWASP minimum recommendation)
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * Hash a password using Argon2id with OWASP-recommended parameters.
   * Always async to avoid blocking the event loop.
   */
  async hash(password: string): Promise<string> {
    // Normalize to NFC so the same visual password produces the same hash
    // regardless of input source (iOS often emits NFD, desktop NFC).
    return hash(password.normalize('NFC'), ARGON2_OPTIONS);
  }

  /**
   * Verify a password against an Argon2id hash.
   * Returns false on any error (e.g., invalid hash format).
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await verify(hash, password.normalize('NFC'));
    } catch (error) {
      // A throw here means the STORED HASH is malformed (bad import or
      // migration), not a wrong password: without the log those users fail
      // login forever, indistinguishably from typos, and lock themselves out.
      // The argon2 error carries no secret material.
      this.logger.error('argon2 verify threw (malformed stored hash?)', error);
      return false;
    }
  }
}
