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
  avatarUrl: z.string().nullable(),
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
  /** When their membership ended, or null while they are still a member. */
  membershipEndedAt: z.date().nullable(),
  /**
   * The person the organization was provisioned around. Carried so the list can mark
   * them and disable the actions that would be refused anyway: an owner cannot
   * be demoted or removed, and a button that always errors is worse than none.
   */
  isOwner: z.boolean(),
  /**
   * DERIVED server-side, from `passwordHash` and `membershipEndedAt`, neither of
   * which crosses the wire. It is the same three-way distinction the removal
   * procedures branch on, so deriving it twice would eventually mean two
   * answers.
   */
  status: z.enum(['active', 'pending', 'removed']),
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
   * FIRST PAGE ONLY, and null on every cursored page. Staff accounts in the
   * caller's tenant, ignoring `cursor` and `limit`: the same population the
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
 * `user.tenant` output: the caller's organization identity, for the sidebar footer
 * block. `name` is `Tenant.name`, resolved server-side from the session's
 * tenant, never a client-supplied id. Null only for a tenant-less
 * account (`User.tenantId` is nullable for pre-tenant seed data); self-signup
 * always provisions an organization, so this is the defensive branch, not the common
 * one, and the caller renders a sane fallback rather than crashing on it.
 */
export const userTenantOutput = z.object({
  name: z.string().nullable(),
});

export type UserTenantOutput = z.infer<typeof userTenantOutput>;
