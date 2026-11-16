import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { parseSecretKey } from './secret-key';
import { InvariantError } from '../errors/invariant-error';

/**
 * Symmetric encryption-at-rest for reversibly-stored secrets.
 *
 * The template otherwise has only one-way primitives (argon2 for passwords,
 * sha256 for opaque tokens). Some secrets must be decryptable to be used again,
 * for example a TOTP secret or a third-party API key that has to be handed
 * back verbatim. This service is the generic reversible-secret
 * primitive for that: encrypt/decrypt arbitrary strings. It is deliberately
 * not coupled to any one feature; a consumer injects it and stores the
 * resulting wire-format string in a column.
 *
 * Algorithm: AES-256-GCM. A fresh random 12-byte IV is generated per call
 * (the NIST-recommended GCM nonce size); the 16-byte auth tag is produced on
 * encrypt and verified on decrypt, so any tampering with the ciphertext or
 * tag makes decrypt throw rather than return garbage (fail closed).
 *
 * Wire format, a self-describing, versioned string:
 *
 *   v1.<base64url(iv)>.<base64url(authTag)>.<base64url(ciphertext)>
 *
 * The v1 prefix lets the format evolve without ambiguity. Key rotation is
 * future work and would ride on this same version prefix: a v2 could carry a
 * key id or a re-keyed payload, and decrypt would dispatch on the version to
 * select the right key. For v1 there is a single key from ENCRYPTION_KEY.
 *
 * The master key is read once at boot from the ENCRYPTION_KEY env var and
 * validated to be exactly 32 bytes (AES-256). It is accepted as either a
 * base64 or hex string. Boot fails fast with a clear message if it is missing
 * or the wrong length. The key is never logged and never leaves this service.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  /** AES-256-GCM. 256-bit key, 96-bit IV, 128-bit auth tag. */
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_BYTES = 12;
  private static readonly AUTH_TAG_BYTES = 16;
  /** Current wire-format version. Bump alongside a rotation strategy. */
  private static readonly VERSION = 'v1';

  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Resolve and validate the master key once at startup. Fail fast (throw, so
   * the Nest bootstrap aborts) on a missing or wrong-length key rather than
   * limping along and exploding on the first encrypt/decrypt.
   */
  onModuleInit(): void {
    const raw = this.configService.get<string>('ENCRYPTION_KEY');
    if (!raw) {
      throw new InvariantError(
        'ENCRYPTION_KEY is required. Generate one with `openssl rand -base64 32`.',
      );
    }
    this.key = EncryptionService.parseKey(raw);
  }

  /**
   * Decode and validate the master key. The decode, the 32-byte length check and
   * the byte-diversity gate live in `parseSecretKey`, shared by every 32-byte
   * secret, so they all fail identically. Never includes the key material in
   * the error.
   */
  private static parseKey(raw: string): Buffer {
    return parseSecretKey(raw, 'ENCRYPTION_KEY');
  }

  /**
   * Encrypt a UTF-8 string. Returns the versioned wire-format string. A fresh
   * random IV per call guarantees two encryptions of the same plaintext yield
   * different ciphertexts (no IV reuse, which is critical for GCM security).
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(EncryptionService.IV_BYTES);
    const cipher = createCipheriv(EncryptionService.ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      EncryptionService.VERSION,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Decrypt a wire-format string back to the original UTF-8 plaintext. Rejects
   * unknown versions and malformed payloads, and lets the GCM auth-tag check
   * throw on any tampering (Node's decipher.final() raises if the tag does not
   * verify). Never returns partial or garbage plaintext on failure.
   */
  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4) {
      throw new InvariantError('Malformed ciphertext: expected version.iv.authTag.ciphertext.');
    }

    const [version, ivB64, authTagB64, ciphertextB64] = parts as [string, string, string, string];
    if (version !== EncryptionService.VERSION) {
      throw new InvariantError('Unsupported ciphertext version.');
    }

    const iv = Buffer.from(ivB64, 'base64url');
    const authTag = Buffer.from(authTagB64, 'base64url');
    const ciphertext = Buffer.from(ciphertextB64, 'base64url');
    if (
      iv.length !== EncryptionService.IV_BYTES ||
      authTag.length !== EncryptionService.AUTH_TAG_BYTES
    ) {
      throw new InvariantError('Malformed ciphertext: invalid IV or auth tag length.');
    }

    const decipher = createDecipheriv(EncryptionService.ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
