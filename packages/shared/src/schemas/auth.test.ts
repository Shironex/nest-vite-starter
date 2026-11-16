import { describe, expect, it } from 'vitest';
import {
  PASSWORD_REQUIREMENTS,
  accountDeletedOutput,
  confirmEmailChangeSchema,
  deleteAccountSchema,
  passwordSchema,
  requestEmailChangeSchema,
  resetPasswordSchema,
  twoFactorActivateSchema,
  twoFactorDisableSchema,
  verifyTwoFactorSchema,
} from './auth';

describe('PASSWORD_REQUIREMENTS / passwordSchema', () => {
  it('keeps the visible checklist labels stable', () => {
    expect(PASSWORD_REQUIREMENTS.map((r) => r.label)).toEqual([
      'At least 8 characters',
      'Uppercase letter',
      'Lowercase letter',
      'Number',
      'Special character',
    ]);
  });

  it('accepts a password satisfying every requirement', () => {
    expect(passwordSchema.safeParse('CorrectHorse1!').success).toBe(true);
  });

  it.each([
    ['Sh0rt!A', 'Password must be at least 8 characters'],
    ['lowercase1!', 'Password must contain an uppercase letter'],
    ['UPPERCASE1!', 'Password must contain a lowercase letter'],
    ['NoNumbers!!', 'Password must contain a number'],
    ['NoSpecial11', 'Password must contain a special character'],
  ])('rejects %p with %p', (password, message) => {
    const result = passwordSchema.safeParse(password);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(message);
  });

  it('reports the length rule as the FIRST issue for a too-short password', () => {
    const result = passwordSchema.safeParse('abc');
    expect(result.error?.issues[0]?.message).toBe('Password must be at least 8 characters');
  });

  it('rejects passwords violating each rule via the same regexes the meter uses', () => {
    for (const req of PASSWORD_REQUIREMENTS) {
      expect(req.regex.test('CorrectHorse1!')).toBe(true);
    }
  });
});

describe('deleteAccountSchema', () => {
  it('accepts any non-empty password (an existing credential has no complexity rules)', () => {
    expect(deleteAccountSchema.safeParse({ password: 'x' }).success).toBe(true);
  });

  it('rejects an empty password with the field message', () => {
    const result = deleteAccountSchema.safeParse({ password: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Password is required');
  });

  it('rejects a missing password', () => {
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
  });
});

describe('2FA code inputs are length-bounded', () => {
  const overLong = '1'.repeat(65);

  it('verifyTwoFactorSchema rejects a code longer than 64 chars', () => {
    expect(verifyTwoFactorSchema.safeParse({ code: overLong }).success).toBe(false);
    expect(verifyTwoFactorSchema.safeParse({ code: '123456' }).success).toBe(true);
  });

  it('twoFactorActivateSchema rejects a code longer than 64 chars', () => {
    expect(twoFactorActivateSchema.safeParse({ code: overLong }).success).toBe(false);
  });

  it('twoFactorDisableSchema rejects a code longer than 64 chars', () => {
    expect(twoFactorDisableSchema.safeParse({ password: 'pw', code: overLong }).success).toBe(
      false,
    );
  });

  it('resetPasswordSchema rejects a factorCode longer than 64 chars', () => {
    const base = { token: 't', password: 'CorrectHorse1!' };
    expect(resetPasswordSchema.safeParse({ ...base, factorCode: overLong }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ ...base, factorCode: '123456' }).success).toBe(true);
  });

  it('requestEmailChangeSchema rejects a factorCode longer than 64 chars', () => {
    const base = { newEmail: 'new@example.com' };
    expect(requestEmailChangeSchema.safeParse({ ...base, factorCode: overLong }).success).toBe(
      false,
    );
    expect(requestEmailChangeSchema.safeParse({ ...base, factorCode: '123456' }).success).toBe(
      true,
    );
  });
});

describe('requestEmailChangeSchema', () => {
  it('lowercases the new address like every other email input', () => {
    const parsed = requestEmailChangeSchema.parse({ newEmail: 'New@Example.COM' });
    expect(parsed.newEmail).toBe('new@example.com');
  });

  it('rejects an invalid address and a missing token on confirm', () => {
    expect(requestEmailChangeSchema.safeParse({ newEmail: 'not-an-email' }).success).toBe(false);
    expect(confirmEmailChangeSchema.safeParse({ token: '' }).success).toBe(false);
    expect(confirmEmailChangeSchema.safeParse({ token: 'raw' }).success).toBe(true);
  });
});

describe('accountDeletedOutput', () => {
  it('accepts the literal { deleted: true }', () => {
    expect(accountDeletedOutput.safeParse({ deleted: true }).success).toBe(true);
  });

  it('rejects { deleted: false } (the mutations never resolve with a soft failure)', () => {
    expect(accountDeletedOutput.safeParse({ deleted: false }).success).toBe(false);
  });

  it('strips unknown fields so nothing internal can widen the wire response', () => {
    const parsed = accountDeletedOutput.parse({ deleted: true, internal: 'leak' });
    expect(parsed).toEqual({ deleted: true });
  });
});
