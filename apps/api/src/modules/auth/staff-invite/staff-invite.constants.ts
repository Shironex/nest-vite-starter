/**
 * The STAFF_INVITE TokenType, mirrored as a local literal for the same reason
 * TokenService mirrors the others: `@repo/database` is ESM-only and apps/api
 * compiles to CJS, so the Prisma enum cannot cross that seam as a VALUE.
 */
export const STAFF_INVITE_TOKEN_TYPE = 'STAFF_INVITE' as const;

/**
 * Per-IP budget for invite acceptance and its pre-check, the two unauthenticated
 * paths this feature adds. Both are token-gated password-set endpoints with no
 * captcha, so the limit exists to bound guessing
 * and hashing cost rather than to shape normal use, and one person accepting one
 * invitation makes at most a handful of calls.
 */
export const STAFF_INVITE_ACCEPT_RATE_LIMIT = 10;
export const STAFF_INVITE_ACCEPT_RATE_WINDOW_SECONDS = 60;

/**
 * Why an invitation was refused, for the audit row.
 *
 * Refusals are audited because "we never invited them" and "the invitation was refused" are different answers to the same
 * question, and only one of them is innocent. The reason never reaches the
 * caller in this shape, because several of these would be enumeration oracles.
 */
export const STAFF_INVITE_FAILURE_REASONS = {
  /** The address belongs to a soft-deleted account still holding it until purge. */
  DELETED_ADDRESS: 'deleted_address',
  /** Already an active member of this organization. */
  ALREADY_A_MEMBER: 'already_a_member',
  /** A former member of this organization; the action wanted is restore, not invite. */
  REMOVED_MEMBER: 'removed_member',
  /** The organization has no room for another member (MU-08). */
  NO_SEAT: 'no_seat',
} as const;

export type StaffInviteFailureReason =
  (typeof STAFF_INVITE_FAILURE_REASONS)[keyof typeof STAFF_INVITE_FAILURE_REASONS];
