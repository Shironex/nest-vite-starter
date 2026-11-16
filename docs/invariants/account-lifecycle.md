---
subsystem: Account lifecycle
globs:
  - apps/api/src/modules/auth/services/login.service.ts
  - apps/api/src/modules/auth/services/two-factor-challenge.service.ts
  - apps/api/src/modules/auth/services/password-reset.service.ts
  - apps/api/src/modules/auth/services/account-deletion.service.ts
  - apps/api/src/modules/auth/oauth/*.ts
  - apps/api/src/modules/auth/staff-invite/*.ts
  - apps/api/src/modules/user/*.ts
---

# Account lifecycle

Three states forbid a new session: the account is soft-deleted (`deletedAt`), locked
(`lockedUntil`), or its membership of the organization has ended (`membershipEndedAt`). This subsystem is
listed separately from sessions because the failure it exists for is not "the check is wrong" but
"the check is missing from one door".

The shape to guard against: removal is enforced at login and at password reset, and the OAuth
resolver keeps letting a removed staff member back in, because every door reads the same three
fields and one door reads only two of them.

## Entry points

- `login.service.ts` - the password door.
- `oauth/oauth-account.service.ts` - the Google door, on both the linked and the auto-link branch.
- `password-reset.service.ts` - a door that mints after a mailed token.
- `two-factor-challenge.service.ts` - `findIneligibleReason`, the live re-read in the chokepoint.
- `staff-invite/staff-invite.service.ts` - re-entry: an invite clears `membershipEndedAt`.
- `user/user-purge.service.ts` and `account-deletion.service.ts` - the deletion half.

## Risks

- Each door reads a snapshot. A state change that lands mid-login is invisible to the door that
  already read it.
- A new door is easy to write by copying a neighbor that predates a field.
- Deletion is soft, so "the row is missing" and "the row is deleted" must end the same way, and a
  query that forgets `deletedAt: null` resurrects the account.
- Re-entry is a real flow (a returning staff member), so the checks cannot simply be permanent.

## Invariants

### A new session is refused for a deleted, locked or removed account

**Enforced by:** `lint-meta:establish-session-callers`, `file:apps/api/src/modules/auth/services/two-factor-challenge.service.ts`, `file:apps/api/security-spec/oauth-removed-member.security-spec.ts`

The structural answer, which is stronger than asking every door to remember: the chokepoint every
door must route through re-reads all three fields immediately before anything is minted, and again
before the post-challenge mint. A door that forgets one still ends without a session.

### The Google door refuses a removed member on both branches

**Enforced by:** `file:apps/api/security-spec/oauth-removed-member.security-spec.ts`, `file:apps/api/src/modules/auth/oauth/oauth-removed-member.isolation.spec.ts`

Linked and auto-link are two branches of one call, and a fix that covers only one of them looks
complete in a review. The finding is recorded as `proven` in `security-spec/findings.json`, so the case is
reconciled by name and cannot quietly disappear.

### A password account never gains a Google link from a login

**Enforced by:** `file:apps/api/security-spec/account-pre-hijack.security-spec.ts`, `file:apps/api/src/modules/auth/account-pre-hijack.isolation.spec.ts`

### An open invitation is the same pending pair everywhere

**Enforced by:** `file:apps/api/security-spec/pending-invite-predicate.security-spec.ts`, `file:apps/api/src/modules/auth/staff-invite/pending-invite-predicate.isolation.spec.ts`

A Google-signup owner listed as a pending invite could be hard-deleted through "withdraw
invitation", and the last-admin guard counted pending invitees as admins. One predicate, used by
both.

### A soft-deletable table is always read with its `deletedAt` filter

**Enforced by:** `eslint:noctcore-prisma/soft-deletable-tables-require-deleted-at`

### Deletion removes the derived data too

**Enforced by:** `unenforced`, follow-up in `docs/invariants/README.md#unenforced-invariants`

`user-purge.service.ts` and the retention sweeps do this today. Nothing requires a new table that
hangs off `User` to be added to the purge, so the first thing a reviewer should ask about a new
user-owned model is what deletes it.

## Review checklist

- [ ] Does the change add a path that authenticates a user? Does it reach `beginOrEstablish`, and
      therefore `findIneligibleReason`?
- [ ] If it reads `User` directly, does the `where` carry `deletedAt: null`?
- [ ] If it adds a branch to an existing door (linked vs auto-link, invited vs returning), is the
      new branch covered by a case, or only the old one?
- [ ] If it adds a table hanging off `User`, what deletes those rows when the account goes?
- [ ] Does a refusal audit a reason, or fail silently?
