import { randomBytes } from 'node:crypto';
import { RECOVERY_CODE_LENGTH, TOTP_DIGITS } from './auth.constants';

/**
 * Crockford base32 alphabet (excludes I, L, O, U to remove visual ambiguity).
 * 32 symbols, and 256 is an exact multiple of 32 (8 per symbol), so `byte % 32`
 * is unbiased: no rejection sampling needed to get a uniform symbol.
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate one recovery code: RECOVERY_CODE_LENGTH (16) Crockford-base32 chars
 * = 80 bits of entropy. 80 bits (not fewer) is what keeps unsalted sha256
 * storage sound against a leaked-hash GPU attack; it is the deliberate trade of
 * a few extra typed characters for a fast-lookup point-hash design.
 */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += CROCKFORD_ALPHABET.charAt(byte % CROCKFORD_ALPHABET.length);
  }
  return code;
}

/**
 * Normalize a user-typed recovery code before hashing or comparing: uppercase,
 * strip separators/whitespace, and fold the Crockford visual aliases
 * (O -> 0, I/L -> 1) so a slightly mistyped code still matches its stored hash.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Group a normalized code into XXXX-XXXX-XXXX-XXXX for display only. */
export function formatRecoveryCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * Strip all whitespace from a candidate TOTP code. Authenticators commonly copy
 * a 6-digit code as "123 456", so the internal space must be removed before both
 * the shape test and the actual verify, or a legitimate paste burns an attempt.
 */
export function normalizeTotpCode(input: string): string {
  return input.replace(/\s/g, '');
}

/** A submitted code is TOTP-shaped when it is exactly TOTP_DIGITS digits. */
export function isTotpCodeShape(input: string): boolean {
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalizeTotpCode(input));
}

/**
 * A submitted code is recovery-shaped when it normalizes to exactly the recovery
 * code length. Classification is by shape so one input field serves both the
 * TOTP and backup-code variants of the challenge.
 */
export function isRecoveryCodeShape(input: string): boolean {
  return normalizeRecoveryCode(input).length === RECOVERY_CODE_LENGTH;
}
