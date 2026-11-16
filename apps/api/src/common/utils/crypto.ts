import { createHash, randomBytes } from 'node:crypto';

import { TOKEN_ENTROPY_BYTES } from '../../modules/auth/auth.constants';

/**
 * SHA-256 hex digest of a value. Used to derive at-rest identifiers from raw
 * secrets (email-verification / password-reset tokens, session tokens): the raw
 * value travels to the client, only the hash is stored, so a leaked store can't
 * be replayed. Shared by TokenService and SessionService so the hashing scheme
 * stays in exactly one place.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Mint one opaque bearer secret: `TOKEN_ENTROPY_BYTES` from the CSPRNG, hex.
 *
 * Deliberately paired with `sha256Hex` in the same file, because "mint a raw
 * hex token, hand it to the client, store only its digest" is the api's ONE
 * token discipline and was being written out inline at a dozen call sites:
 * sessions, one-time links, trusted devices, staff invites,
 * download tickets, staged uploads. Inline, each site is one typo (`randomBytes(8)`,
 * `'base64'`) away from a weaker or differently-shaped secret than the checker
 * that later validates it, and nothing would fail: a short token still works.
 *
 * The entropy count comes from `auth.constants` rather than being restated
 * here, so the mint, the shape check below and the session/token services all
 * agree by construction.
 */
export function mintOpaqueToken(): string {
  return randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');
}

/** Exactly what `mintOpaqueToken` produces: lowercase hex, two chars per byte. */
const OPAQUE_TOKEN_PATTERN = new RegExp(`^[0-9a-f]{${TOKEN_ENTROPY_BYTES * 2}}$`, 'u');

/**
 * Whether a caller-supplied string could have come from `mintOpaqueToken`.
 *
 * A CHEAP PRE-FILTER, NOT AN AUTHORIZATION CHECK. It exists so a malformed or
 * hostile value is refused before it is ever used to build a Redis key, which
 * keeps key-shaped junk (`*`, a newline, a 4 kB blob) out of the keyspace and
 * makes the lookup that follows the only thing that can grant anything. Callers
 * still have to treat a well-formed token as unproven until the store confirms
 * it.
 */
export function isOpaqueTokenShape(value: string): boolean {
  return OPAQUE_TOKEN_PATTERN.test(value);
}
