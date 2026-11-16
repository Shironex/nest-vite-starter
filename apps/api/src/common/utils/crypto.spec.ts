import { isOpaqueTokenShape, mintOpaqueToken, sha256Hex } from './crypto';
import { TOKEN_ENTROPY_BYTES } from '../../modules/auth/auth.constants';

describe('sha256Hex', () => {
  it('is the standard digest, so a stored hash is reproducible outside this repo', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('mintOpaqueToken', () => {
  it('produces lowercase hex of the configured entropy, two chars per byte', () => {
    expect(mintOpaqueToken()).toMatch(new RegExp(`^[0-9a-f]{${TOKEN_ENTROPY_BYTES * 2}}$`, 'u'));
  });

  it('does not repeat itself', () => {
    // Not a statistical claim, just proof it reads the CSPRNG per call rather
    // than caching a value the way a constant would.
    const minted = new Set(Array.from({ length: 100 }, () => mintOpaqueToken()));
    expect(minted.size).toBe(100);
  });

  it('is accepted by the shape check that guards every redemption path', () => {
    expect(isOpaqueTokenShape(mintOpaqueToken())).toBe(true);
  });
});

describe('isOpaqueTokenShape', () => {
  it.each([
    ['an empty string', ''],
    ['a short token', 'a'.repeat(TOKEN_ENTROPY_BYTES * 2 - 1)],
    ['a long token', 'a'.repeat(TOKEN_ENTROPY_BYTES * 2 + 1)],
    ['uppercase hex', 'A'.repeat(TOKEN_ENTROPY_BYTES * 2)],
    ['non-hex characters', 'z'.repeat(TOKEN_ENTROPY_BYTES * 2)],
    ['a redis glob', '*'.repeat(TOKEN_ENTROPY_BYTES * 2)],
  ])('refuses %s', (_label, value) => {
    // The point is to keep key-shaped junk out of the keyspace before a lookup
    // is ever attempted; it is a pre-filter, never an authorization check.
    expect(isOpaqueTokenShape(value)).toBe(false);
  });

  it('refuses a well-formed token with a newline glued on', () => {
    expect(isOpaqueTokenShape(`${mintOpaqueToken()}\n`)).toBe(false);
  });
});
