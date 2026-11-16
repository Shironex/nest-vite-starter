# Decision record: one tenant per user, or memberships

**Date:** 2026-09-22
**Status:** one tenant per user today; a `Membership` join table is the recorded upgrade path
**Touches:** `packages/database/prisma/schema/identity.prisma` (`User.tenantId`,
`User.membershipEndedAt`), the baseline migration, the session and the web client's query cache
**Reopens when:** a product built on the starter needs one person to work in two tenants, or
before its first production deployment if that need is already known.

## Decision

- The starter ships `User.tenantId` as one nullable foreign key and no tenant switcher. A user
  belongs to exactly one tenant.
- The shape to move to when multi-membership is needed is `User` ->
  `Membership (userId, tenantId, role, endedAt)` -> `Tenant`, with the active tenant carried in
  the session. A user with one membership then behaves exactly as today; a user with two can
  switch.

## Why record it now

Retrofitting memberships after a product's baseline migration is expensive, so the cost is
written down while it is still cheap to pay:

- **Data:** every `User.tenantId` becomes a `Membership` row, `role` and `membershipEndedAt`
  move off `User` onto it, and the unique and foreign-key constraints are rebuilt around it.
- **Every guard:** each check that reads `user.tenantId` or `user.role` today must read the
  active membership instead: the auth middleware, the session blob, the admin guards, the
  last-admin and self guards, the invitation flows and the removed-member checks at login.
- **The client:** switching tenants safely means canceling in-flight queries, resetting
  non-session data and `me`, removing inactive queries, then refetching active queries
  excluding the old tenant's keys. Socket rooms need the same care. None of that exists until
  the table does.

While the starter still has a single baseline migration, adding the table is a schema edit and
a regenerated baseline. A product that knows it needs multi-membership should do it before its
first deployment, which makes a one-membership product free (it never creates a second row) and
a many-membership product a feature rather than a migration.

## What this does not decide

The removed-member rule (`User.membershipEndedAt`, enforced at login) would move onto the
membership row as `Membership.endedAt`. The switcher UI, and whether a switch re-issues the
session or only changes its active tenant, are decided when someone builds them.
