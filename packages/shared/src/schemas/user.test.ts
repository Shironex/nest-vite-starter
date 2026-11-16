import { describe, expect, it } from 'vitest';
import { userProfileOutput } from './user';

const profile = {
  id: 'user-1',
  email: 'a@example.com',
  displayName: null,
  role: 'USER',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

/**
 * The `user.me` wire shape. The output schema is an allowlist: whatever the
 * repository hands it, only these fields reach the client.
 */
describe('userProfileOutput', () => {
  it('accepts a complete profile', () => {
    expect(userProfileOutput.safeParse(profile).success).toBe(true);
  });

  it('refuses a profile missing a required field', () => {
    const { emailVerified: _omitted, ...partial } = profile;
    expect(userProfileOutput.safeParse(partial).success).toBe(false);
  });

  it('strips a credential column a careless select would carry', () => {
    const parsed = userProfileOutput.parse({ ...profile, passwordHash: 'argon2id$...' });
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});
