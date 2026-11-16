import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };

/**
 * What an OPEN staff invitation is, as a `where` fragment: no password AND an
 * address nobody has vouched for.
 *
 * BOTH halves, never `passwordHash: null` alone. A Google signup provisions the
 * organization owner with no password and a provider-verified address, so a
 * null-password-only test reads the owner as an unaccepted invitation: the
 * members list labeled them "pending", offered "withdraw invitation" (a hard
 * delete), and the last-admin guard would have dropped them from its count had
 * it used the same test. `emailVerified: false` is what the invitation row is
 * created with and what acceptance flips, so the pair is the invitation's
 * whole lifecycle and nothing else has it.
 *
 * Deliberately only the pair. The callers already fence `deletedAt: null` and
 * the tenant, and keeping those out is what lets this be negated
 * (`NOT: PENDING_INVITATION_WHERE`) without negating the fence too.
 */
export const PENDING_INVITATION_WHERE = {
  passwordHash: null,
  emailVerified: false,
} as const satisfies Prisma.UserWhereInput;

/** The same test for a row already in memory, for projections that cannot filter. */
export function isPendingInvitation(row: {
  passwordHash: string | null;
  emailVerified: boolean;
}): boolean {
  return row.passwordHash === null && !row.emailVerified;
}
