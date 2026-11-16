---
subsystem: Session establishment
globs:
  - apps/api/src/modules/auth/services/*.ts
  - apps/api/src/modules/auth/middleware/*.ts
  - apps/api/src/modules/auth/*.router.ts
---

# Session establishment

A session is a Redis blob plus a cookie. Everything the request is later allowed to do is read back
out of that blob, so the properties that matter are all about the moment it is minted: who may mint,
what the blob must say, and what the response must tell the client.

The characteristic bug here is a new door that forgets a field the other doors set, which is why the
seam carries lint-meta rules rather than a paragraph in a README.

## Entry points

- `auth-shared.service.ts` - `establishSession`, the one place a session comes into existence.
- `two-factor-challenge.service.ts` - `beginOrEstablish`, the post-credential chokepoint in front
  of it, and the live re-read of account state.
- `login.service.ts`, `register.service.ts`, `password-change.service.ts`,
  `password-reset.service.ts`, `session-management.service.ts` - the staff doors.
- `middleware/auth.middleware.ts` - where the blob is read back.

## Risks

- `AuthMiddleware` trusts what the blob says for the life of the session. A field a door forgot to
  write is read back as its default, not as an error.
- A door that mints without capturing the session epoch first leaves the whole credential check
  (an Argon2 verify) outside the fence.
- Every new authentication flow is a new door, and the doors are not obviously enumerable from any
  single file.

## Invariants

### Only the allowlisted flows may call `establishSession`

**Enforced by:** `lint-meta:establish-session-callers`

A new login entry point must route through `beginOrEstablish`, or it bypasses the 2FA
challenge. The allowlist is the enumeration of doors that legitimately mint without one.

### Every door captures the session epoch before reading the credential

**Enforced by:** `lint-meta:session-epoch-captured`, `file:apps/api/src/modules/auth/services/session-epoch-fence.spec.ts`

Register and password change are outside the rule by construction: register has no prior state, and
password change revokes first and re-issues after.

### Every tRPC procedure declares a guard and an output

**Enforced by:** `lint-meta:procedures-require-guard`, `lint-meta:procedure-requires-output`

## Review checklist

- [ ] Does the change add a path that ends in a session? If so, does it go through
      `beginOrEstablish` rather than `establishSession`?
- [ ] Is the epoch read BEFORE the credential, and passed into the seam?
- [ ] Does the minted blob carry every field the other doors write?
