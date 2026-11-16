import { z } from 'zod';

/**
 * `user.me` output: the safe profile projection `UserService.getProfile`
 * returns. Set as the procedure `output:` so the server zod-strips the wire
 * response to exactly these fields and the client infers a concrete type
 * instead of `any`. Never carries passwordHash or the lockout counters (the
 * service projection omits them, and this strict schema would strip them
 * anyway). `createdAt` stays a `Date` over the wire via superjson.
 */
export const userProfileOutput = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.date(),
});

export type UserProfileOutput = z.infer<typeof userProfileOutput>;

/**
 * One row of the admin user list: the admin-visible projection (includes lock
 * status, never passwordHash or the lockout counters). `twoFactorEnabled` is
 * DERIVED, not a stored column: true iff the user has an ACTIVE, non-recovery
 * SecondFactor row (see UserRepository.listUsers).
 */
const adminUserListItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.string(),
  emailVerified: z.boolean(),
  lockedUntil: z.date().nullable(),
  createdAt: z.date(),
  twoFactorEnabled: z.boolean(),
  /** When an admin disabled the account, or null while it is active. */
  disabledAt: z.date().nullable(),
  /**
   * DERIVED server-side, from `disabledAt`. It is the same distinction the
   * disable and enable procedures branch on, so deriving it twice would
   * eventually mean two answers.
   */
  status: z.enum(['active', 'disabled']),
});

/**
 * `user.listUsers` output: one cursor page of the admin user list.
 * `nextCursor` feeds the next call's `cursor` input and is null on the last
 * page.
 */
export const adminUserListPageOutput = z.object({
  items: z.array(adminUserListItemSchema),
  nextCursor: z.string().nullable(),
  /**
   * FIRST PAGE ONLY, and null on every cursored page. Every live account,
   * ignoring `cursor` and `limit`: the same population the
   * page is cut from (non-deleted).
   *
   * A COUNT on the same predicate answers the same number for every page of one
   * traversal, so re-running it per page paid for a footer that had not changed.
   * It is computed once, on the request that carries no `cursor`, and the client
   * carries it forward for as long as the filter set holds; a filter, sort, tab
   * or search change resets to page one, which is the request that recounts.
   *
   * Null rather than absent, and null rather than a stale echo the client hands
   * back: a client that forgets to carry it renders a footer with no total
   * instead of one the server cannot vouch for.
   *
   * Counted on the same connection and the same `where` binding as the page read
   * (see `BaseRepository.pageWithTotal`), so the range summary and the rows can
   * never describe different populations.
   */
  total: z.number().int().nonnegative().nullable(),
});

export type AdminUserListPageOutput = z.infer<typeof adminUserListPageOutput>;

/**
 * Disable an account, or enable a disabled one.
 *
 * Disabling is NOT deletion and the two are separate procedures on purpose:
 * this one is reversible, stamps `disabledAt`, and leaves the account and its
 * audit trail standing. `adminDeleteUser` remains the destructive one.
 */
export const memberActionSchema = z.object({
  userId: z.string().min(1, 'User is required'),
});

export type MemberActionInput = z.infer<typeof memberActionSchema>;
