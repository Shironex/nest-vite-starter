import {
  formatRecoveryCode,
  generateRecoveryCode,
  isRecoveryCodeShape,
  isTotpCodeShape,
  normalizeRecoveryCode,
  normalizeTotpCode,
} from './two-factor.util';

describe('two-factor.util', () => {
  describe('generateRecoveryCode', () => {
    it('returns 16 Crockford-base32 chars (no I, L, O, U)', () => {
      for (let i = 0; i < 100; i += 1) {
        const code = generateRecoveryCode();
        expect(code).toHaveLength(16);
        // Crockford alphabet: 0-9 A-H J K M N P-T V-Z (excludes I, L, O, U).
        expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
      }
    });

    it('is effectively unique across many calls (80 bits of entropy)', () => {
      const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
      expect(codes.size).toBe(200);
    });
  });

  describe('normalizeRecoveryCode', () => {
    it('uppercases, strips whitespace and hyphens, folds O->0 and I/L->1', () => {
      expect(normalizeRecoveryCode('il-oi lo')).toBe('110110');
    });

    it('is idempotent on an already-normalized code', () => {
      const code = generateRecoveryCode();
      expect(normalizeRecoveryCode(code)).toBe(normalizeRecoveryCode(normalizeRecoveryCode(code)));
    });
  });

  describe('formatRecoveryCode', () => {
    it('groups 16 chars as XXXX-XXXX-XXXX-XXXX with no trailing dash', () => {
      expect(formatRecoveryCode('ABCDEFGH01234567')).toBe('ABCD-EFGH-0123-4567');
    });

    it('round-trips through normalize back to the raw code', () => {
      const raw = generateRecoveryCode();
      expect(normalizeRecoveryCode(formatRecoveryCode(raw))).toBe(raw);
    });
  });

  describe('normalizeTotpCode', () => {
    it('strips internal and surrounding whitespace to bare digits', () => {
      expect(normalizeTotpCode('123 456')).toBe('123456');
      expect(normalizeTotpCode(' 123456 ')).toBe('123456');
      expect(normalizeTotpCode('12\t34\n56')).toBe('123456');
    });
  });

  describe('isTotpCodeShape', () => {
    it.each([
      ['123456', true],
      [' 123456 ', true],
      // Authenticators commonly copy a code as "123 456": the internal space
      // must not make it fail the shape check (and later burn a verify attempt).
      ['123 456', true],
      ['12345', false],
      ['1234567', false],
      ['12345a', false],
      ['ABCDEF', false],
    ])('%s -> %s', (input, expected) => {
      expect(isTotpCodeShape(input)).toBe(expected);
    });
  });

  describe('isRecoveryCodeShape', () => {
    it('accepts a normalized-length code and a grouped code, rejects a TOTP code', () => {
      const raw = generateRecoveryCode();
      expect(isRecoveryCodeShape(raw)).toBe(true);
      expect(isRecoveryCodeShape(formatRecoveryCode(raw))).toBe(true);
      expect(isRecoveryCodeShape('123456')).toBe(false);
    });
  });
});
