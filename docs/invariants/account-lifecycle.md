---
subsystem: Account lifecycle
globs:
  - apps/api/src/modules/auth/services/login.service.ts
  - apps/api/src/modules/auth/services/two-factor-challenge.service.ts
  - apps/api/src/modules/auth/services/password-reset.service.ts
  - apps/api/src/modules/auth/services/account-deletion.service.ts
  - apps/api/src/modules/user/*.ts
---

# Account lifecycle

Three states forbid a new session: the account is soft-deleted (`deletedAt`), locked
(`lockedUntil`), or an admin has disabled it (`disabledAt`). This subsystem is
listed separately from sessions because the failure it exists for is not "the check is wrong" but
"the check is missing from one door".

The shape to guard against: disabling is enforced at login, and a newly added door (password reset,
a second-factor finish, a future provider sign-in) keeps letting a disabled account back in, because
every door reads the same three fields and one door reads only two of them.

## Entry points

- `login.service.ts` - the password door.
- `password-reset.service.ts` - a door that mints after a mailed token.
- `two-factor-challenge.service.ts` - `findIneligibleReason`, the live re-read in the chokepoint.
- `user/user-purge.service.ts` and `account-deletion.service.ts` - the deletion half.

## Risks

- Each door reads a snapshot. A state change that lands mid-login is invisible to the door that
  already read it.
- A new door is easy to write by copying a neighbor that predates a field.
- Deletion is soft, so "the row is missing" and "the row is deleted" must end the same way, and a
  query that forgets `deletedAt: null` resurrects the account.
- Enabling a disabled account is a real flow, so the checks cannot simply be permanent.

## Invariants

### A new session is refused for a deleted, locked or disabled account

**Enforced by:** `lint-meta:establish-session-callers`, `file:apps/api/src/modules/auth/services/two-factor-challenge.service.ts`, `file:apps/api/src/modules/auth/services/two-factor-challenge.service.spec.ts`

The structural answer, which is stronger than asking every door to remember: the chokepoint every
door must route through re-reads all three fields immediately before anything is minted, and again
before the post-challenge mint. A door that forgets one still ends without a session.

### Verifying an email ends every session opened before the verification

**Enforced by:** `file:apps/api/src/modules/auth/account-pre-hijack.isolation.spec.ts`

Somebody who registers the victim's address with their own password keeps the session registration
opened. The verification is the moment ownership is proven, so every earlier session goes.

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
- [ ] If it adds a branch to an existing door, is the new branch covered by a case, or only the
      old one?
- [ ] If it adds a table hanging off `User`, what deletes those rows when the account goes?
- [ ] Does a refusal audit a reason, or fail silently?
