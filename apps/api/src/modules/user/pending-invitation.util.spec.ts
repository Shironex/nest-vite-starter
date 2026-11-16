import { PENDING_INVITATION_WHERE, isPendingInvitation } from './pending-invitation.util';

describe('pending invitation predicate', () => {
  it('is the pair, and only the pair', () => {
    // Negated as `NOT: PENDING_INVITATION_WHERE` in the admin count, so a fence
    // clause added here would be negated along with it.
    expect(PENDING_INVITATION_WHERE).toEqual({ passwordHash: null, emailVerified: false });
  });

  it.each([
    [true, { passwordHash: null, emailVerified: false }],
    // A Google signup (the organization owner included): a member, not an invitation.
    [false, { passwordHash: null, emailVerified: true }],
    [false, { passwordHash: 'argon2', emailVerified: true }],
    // A password with an unverified address is a member who has not clicked a
    // verification link, not an open invitation.
    [false, { passwordHash: 'argon2', emailVerified: false }],
  ])('reads %p for %j', (expected, row) => {
    expect(isPendingInvitation(row)).toBe(expected);
  });
});
