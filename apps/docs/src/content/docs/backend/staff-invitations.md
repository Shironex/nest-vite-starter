---
title: Staff Invitations
description: How a second person joins an existing organization, the collision case that moves an account between tenants, the membership guards, and the three states a member row can be in.
sidebar:
  order: 17
---

Self-service registration provisions a **new** organization (tenant) through `ProvisioningService`. Staff invitations are the one path by which a second person joins an existing one.

## The shape of it

An ADMIN invites a colleague by email address. The invitee gets a link, sets a password, and then **signs in normally**. Acceptance establishes no session: the new credential goes through the ordinary login path, which is what puts it through lockout, the session-epoch fence and the 2FA challenge seam like every other account.

The invitation rides the existing `Token` table with a fourth `TokenType`, `STAFF_INVITE`. That is deliberate: the single-use consume, the hashed-at-rest storage and the hourly expired-token sweep are already implemented there, and a second table would be a second place for each of those to be got wrong. Its lifetime is `STAFF_INVITE_TOKEN_TTL_MS` (7 days), its own constant rather than a reuse of another token's TTL, so it can change without touching the others.

| Procedure                | Guards                    | Notes                                      |
| ------------------------ | ------------------------- | ------------------------------------------ |
| `staffInvite.send`       | Auth, Admin, Idempotency  | Tenant comes from the ALS, never the input |
| `staffInvite.revoke`     | Auth, Admin, Idempotency  | Refuses once a password is set             |
| `auth.acceptStaffInvite` | none, per-IP rate limited | The token is the authorization             |
| `auth.staffInviteState`  | none, per-IP rate limited | Pre-check; does not consume the token      |
| `user.removeMember`      | Auth, Admin, Idempotency  | Reversible                                 |
| `user.restoreMember`     | Auth, Admin, Idempotency  | Undoes the above                           |

## The collision case

`User.email` is unique across the entire product, so an address invited into an organization may already belong to somebody running their own. This is the hard half of the feature and almost every unusual decision in `StaffInviteService` follows from it.

The invite path **never reports that an address exists elsewhere** and never inspects whether that other organization is empty. Both would be enumeration surfaces, and the emptiness answer would be stale by acceptance anyway. A fresh address, a re-invite and a collision all return the same response shape.

The token for a collision carries `staffInviteTenantId` and `staffInviteRole`, because there is no pending `User` row to carry the invitation's terms. On the ordinary path both columns stay null and acceptance reads the pending row instead. Writing the role on the ordinary path too was rejected: an admin may re-grade a pending member through the ordinary role surface, and a token that also remembered a role would silently undo that at acceptance.

Accepting on this path:

1. requires a **valid TOTP or recovery code** when the account carries an active second factor. `resetPassword` refuses to change a password on mailbox proof alone in that case; acceptance does strictly more (it overwrites the credential, moves the account between organizations and changes its role), so without this gate a compromised mailbox would be full takeover of a 2FA-protected account;
2. runs in one **`Serializable`** transaction with a bounded retry on `P2034`;
3. moves the account, takes the invited role and clears `membershipEndedAt`;
4. deletes the old organization **only if it is abandonable**;
5. writes `user.tenant.moved` carrying both tenant ids **and both roles**.

### Why Serializable

At READ COMMITTED the emptiness counts and the tenant delete are not atomic against a concurrent insert, and `Workspace.tenant` is `onDelete: Cascade`. An invitee still signed into their old organization in another tab who creates a workspace while accepting could have that workspace **silently cascaded away**: the count passes before the workspace commits, and the delete then takes it. A child table on `onDelete: Restrict` would abort loudly; workspace is the quiet one. `staff-invite-acceptance.isolation.spec.ts` proves both schema facts against the live database.

### `isAbandonable`

True only when the old organization holds **exactly one `User` row in total**, no workspaces, no domain records, and no billing relationship.

"In total" is load-bearing. `User.tenantId` is `onDelete: Restrict`, so a soft-deleted former colleague still awaiting purge would pass a live-rows-only check and the tenant delete would then fail with a `P2003`, long after the caller was told the organization could be closed. Counting every row makes that organization simply not abandonable, which is the designed refusal.

The billing condition has nothing to read today and its implementation is `return true` with a comment naming why it exists. It was written now rather than retrofitted because the acceptance transaction is the one place in the product that both moves an account between tenants and deletes a tenant.

Those counts run inside `requestContext.run` scoped to the **old** tenant, because the counted models (`workspace` among them) are tenant-scoped, acceptance is unauthenticated, and `requireScope` fails closed when the ALS carries no tenantId. The `await` stays inside the scope.

### A removed member is not an abandoning one

Somebody **removed** from an organization cannot log in, therefore cannot self-delete, and their old organization is populated rather than abandoned. They move without it being deleted. Folding the two cases together would refuse them with a remedy they cannot perform on an organization they do not own, leaving the account permanently unusable and unerasable under that address.

## Three states, three different actions

`user.listUsers` derives a `status` server-side, from `passwordHash` and `membershipEndedAt`, neither of which crosses the wire. It is the same three-way distinction the removal procedures branch on, so deriving it twice would eventually mean two answers.

| Action                        | Effect                                              | Reversible          |
| ----------------------------- | --------------------------------------------------- | ------------------- |
| Withdraw a pending invitation | delete the token, hard-delete the row               | no, nothing existed |
| Remove a member               | stamp `membershipEndedAt`, revoke auth state        | **yes**, restore    |
| Delete the account            | existing `adminDeleteUser`: soft delete, then purge | no                  |

Removal is modeled as `membershipEndedAt` rather than `tenantId = null`. A null-tenant user fails every fail-closed tenant-scoped operation **and** is invisible to every admin list, which is a worse state than either alternative. Keeping `tenantId` intact makes the removal visible and reversible.

Withdrawing hard-deletes the pending row, which is safe precisely because an account that never had a password was never an actor on anything. The `staff.invite.revoked` audit row is the only surviving trace that the invitation existed.

### Where removal is enforced

`membershipEndedAt` is checked at **login** and in **password reset** (both when minting a link and in the guarded write). It is deliberately **not** checked in `auth.middleware`, which reads the session blob and never touches the database: putting it there would add a per-request DB read to the hottest path in the app. The sessions a removed member already holds are closed by `revokeAuthState` at removal time.

`forgotPassword` also refuses a **pending invitee**. Otherwise the reset flow sets a password without flipping `emailVerified` and without touching the invitation token, and login establishes a session for unverified users, producing a member who joined without ever accepting, with no `staff.invite.accepted` row and a live invitation still pointed at an active account. Both refusals return the same generic response as an unknown address.

## Ownership and the membership guards

`Tenant.ownerId` names the user an organization was provisioned around. It is a column rather than a fifth `Role` value: it is read by three guards and nothing else, and folding it into `role` would make "promote to owner" a type-correct operation that nothing should offer. It is nullable, and that is a **permanent** population rather than a migration artifact: nothing deletes an orphan `Tenant`, so an organization whose only ADMIN self-deleted keeps its row and backfills to NULL. Every guard treats a null owner as "the owner rule does not apply here".

Four doors lead to an ownerless or admin-less organization, and all four are closed:

- `updateRole` refuses a **self-target**, refuses demoting the **owner**, and refuses demoting the **last live admin**. The last-admin check is atomic under a per-tenant advisory lock taken _before_ the count, because a count followed by a write is a TOCTOU: two admins demoting each other concurrently would both see a count of two.
- `adminDeleteUser` refuses ADMIN targets and the owner.
- `user.removeMember` refuses a self-target and refuses ADMIN targets, with the role predicate **repeated inside the write** (copying `softDeleteScopedNonAdmin`) so a target promoted between the probe and the write cannot be removed by a call authorized against their old role. Removing an admin has to go through demotion, which routes it past the other two guards.
- `auth.deleteAccount` refuses the last live admin of a **populated** organization. A sole user in an empty organization is unaffected, which keeps self-service deletion working for the only case that existed before invitations.

A **live ADMIN** means `role = ADMIN AND deletedAt IS NULL AND membershipEndedAt IS NULL`. Omitting the last clause would let a removed-but-not-deleted admin satisfy the count, and the guard would then permit demoting the last one who can actually sign in.

## Mail

Two templates, sharing one delivery shape: a URL-hash job id so a re-invite mints a new id while a double-submit collapses, the CRITICAL delivery class, and expiry prose derived from the real TTL.

`sendStaffInviteEmail` routes on `movesExistingAccount`. The collision template is a **requirement, not a nicety**: accepting on that path moves the reader's account into another organization and closes the organization they are in today, and an invitation that changes account ownership without saying so is a phishing template. The warning sits above the button and in the subject line, because a consequence disclosed after the call to action is not disclosed.

`emailSent` is reported truthfully. An account that exists with no mail sent is a re-invitable state, not a broken one, and the admin has to be told: the invitee cannot ask for another link.

## Audit vocabulary

```
staff.invite.sent       metadata: { role, outcome, movesExistingAccount, emailSent }
staff.invite.failed     metadata: { reason }
staff.invite.revoked
staff.invite.accepted
staff.member.removed    metadata: { role }
staff.member.restored   metadata: { role, restoresAdmin }
user.tenant.moved       before/after: { tenantId, role }
```

`staff.*` is its own domain rather than more `user.*` actions: those rows are about an account, these are about **membership of an organization**, and the audit filter dropdown groups by exactly that distinction. `user.tenant.moved` stays under `user.*` because the account is what moved.

It carries both roles, not just both tenant ids. The collision path sets the invited role directly, without passing through `updateRole`, so omitting the roles would leave "when did this person become an admin" unanswerable in an application built for exactly that question.

## What a plain USER may do

Two staff roles, `USER` and `ADMIN`. Invitations are how a `USER` comes to exist: self-service registration always creates the tenant's first `ADMIN`.

Its capability line was **never designed**: it is the residue of which routers happened to get `AdminMiddleware` as they were written, and it was ratified as-is rather than redesigned. `user-role-capability.spec.ts` pins the per-router ADMIN gating so widening a `USER`'s reach is an explicit edit to a number, reviewed on its own terms, rather than a side effect of forgetting a decorator on a new procedure.

The one part that _is_ designed: every access **grant** (`staffInvite`) is admin-only on every procedure, and the same spec asserts that separately.

## Deliberately not built

Per-user workspace assignment, seat enforcement beyond one always-passing `assertCanAddMember`, a third staff role, the `AdminMiddleware` to `PermissionMiddleware` migration, ownership transfer (which `deleteAccount`'s refusal copy points at, and which is the natural next effort), cross-organization users, and a vendor-side product-owner panel across tenants.
