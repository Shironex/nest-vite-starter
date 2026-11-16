import {
  isPrismaUniqueConstraintError,
  uniqueConstraintTargetText,
} from './prisma-unique-error.util';

describe('prisma-unique-error.util', () => {
  it('recognizes a duck-typed P2002 and nothing else', () => {
    expect(isPrismaUniqueConstraintError(Object.assign(new Error('x'), { code: 'P2002' }))).toBe(
      true,
    );
    expect(isPrismaUniqueConstraintError({ code: 'P2002' })).toBe(true);
    expect(isPrismaUniqueConstraintError(Object.assign(new Error('x'), { code: 'P2025' }))).toBe(
      false,
    );
    expect(isPrismaUniqueConstraintError(new Error('x'))).toBe(false);
    expect(isPrismaUniqueConstraintError(null)).toBe(false);
    expect(isPrismaUniqueConstraintError('P2002')).toBe(false);
  });

  it('lowercases both driver shapes of meta.target (column array and constraint string)', () => {
    expect(uniqueConstraintTargetText({ meta: { target: ['Email'] } })).toBe('email');
    expect(
      uniqueConstraintTargetText({ meta: { target: ['provider', 'providerAccountId'] } }),
    ).toBe('provider,provideraccountid');
    expect(uniqueConstraintTargetText({ meta: { target: 'User_email_key' } })).toBe(
      'user_email_key',
    );
  });

  it('returns undefined when the driver reports no target', () => {
    expect(uniqueConstraintTargetText({})).toBeUndefined();
    expect(uniqueConstraintTargetText({ meta: {} })).toBeUndefined();
    expect(uniqueConstraintTargetText({ meta: { target: 42 } })).toBeUndefined();
    expect(uniqueConstraintTargetText(null)).toBeUndefined();
  });
});
