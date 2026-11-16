import { InvariantError } from '../errors/invariant-error';
/**
 * Shared parsing and validation for the app's 32-byte symmetric secrets
 * (ENCRYPTION_KEY for EncryptionService, and any further key a service adds).
 *
 * Every such key has exactly the same operator-facing contract (32 raw bytes,
 * supplied as base64 or hex, generated with `openssl rand -base64 32`) and
 * exactly the same failure modes, so the decode and the entropy gate live here
 * once instead of once per service. The env var name is passed in purely so the
 * thrown message names the variable the operator actually has to fix.
 *
 * Key material is never included in a thrown error.
 */

/** Every secret parsed here is a 256-bit key. */
const KEY_BYTES = 32;

/**
 * Minimum number of DISTINCT byte values a 32-byte key must contain to clear
 * the entropy gate. A real `openssl rand -base64 32` key has ~28 distinct bytes
 * on average; a placeholder or fat-fingered key (all-zero, a repeated word, a
 * short pattern padded out) has far fewer. 16 is an intentionally low bar: we
 * guard against operator mistakes, not cryptanalysis.
 */
const MIN_UNIQUE_KEY_BYTES = 16;

/**
 * Decode a base64 (or hex) 32-byte key and reject weak ones. Tries base64 first
 * (the documented format), then hex, and requires the decoded length to be
 * exactly 32 bytes.
 *
 * @param raw The raw env value.
 * @param envName The variable name, used only to make the error actionable.
 */
export function parseSecretKey(raw: string, envName: string): Buffer {
  const candidates: Buffer[] = [];
  const base64 = Buffer.from(raw, 'base64');
  if (base64.length > 0) candidates.push(base64);
  if (/^[0-9a-fA-F]+$/.test(raw)) candidates.push(Buffer.from(raw, 'hex'));

  const key = candidates.find((c) => c.length === KEY_BYTES);
  if (!key) {
    throw new InvariantError(
      `${envName} must decode to exactly ${KEY_BYTES} bytes ` +
        '(a base64 or hex 32-byte key). Generate one with `openssl rand -base64 32`.',
    );
  }

  // Reject low-diversity keys: a real randomly-generated 32-byte key has many
  // distinct byte values (~28 on average), while a placeholder or doc-example
  // key (all-zero "AAAA...A=", a repeated word, a short pattern padded out) has
  // very few. Requiring at least MIN_UNIQUE_KEY_BYTES distinct bytes catches
  // those without rejecting any genuinely random key.
  const uniqueBytes = new Set(key);
  if (uniqueBytes.size < MIN_UNIQUE_KEY_BYTES) {
    throw new InvariantError(
      `${envName} is too weak: insufficient byte diversity. ` +
        'Generate a strong key with `openssl rand -base64 32`.',
    );
  }

  return key;
}
