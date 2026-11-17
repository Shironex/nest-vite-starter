# Auth

The authentication in this starter is **interim**. It works and is tested, but it carries two
known issues (below) and I plan to replace it with `@noctcore/auth` once that package reaches 1.0.
Do not run it in production before then. This page describes what exists today and what the swap
changes.

## Flows

All of them are procedures on the `auth`, `twoFactor` and `sessions` routers
(`apps/api/src/modules/auth`), each a thin call into one service in `services/`.

- **Sign up.** Email and password (Argon2id), a Turnstile token, a per-IP rate limit. The account
  is a plain `USER`. A verification mail with a purpose-bound, single-use token goes out, and the
  token is stored only as its SHA-256.
- **Sign in.** Rate limit, Turnstile, then the credential check. An unknown email pays the same
  hashing cost as a known one so response time does not reveal it. Five failures lock the account
  for 5 minutes, the next lockouts for 15 minutes and an hour, and the fourth is permanent until
  an admin clears it. The result is a union: signed in, `twofa_required`, or signed in with the email still
  unverified.
- **Second factor (opt-in).** TOTP with ten one-time recovery codes and "remember this browser"
  (30 days, at most five browsers). Enrolling, disabling and regenerating codes need the password
  and a code. Secrets are encrypted at rest with `ENCRYPTION_KEY`. A code cannot be replayed inside
  its window, and a pending challenge allows five attempts. A user who loses the app and the codes
  follows [runbooks/2fa-lockout.md](runbooks/2fa-lockout.md).
- **Password reset.** A mailed token. For an account with 2FA the reset also needs a code, so a
  mailbox alone cannot take the account. Completing a reset revokes every session and never signs
  anyone in.
- **Password change, email change.** Changing the password revokes the other sessions and re-issues
  the caller's. Changing the email needs a recent password confirmation, a code when 2FA is on,
  and a confirmation link sent to the new address, with a notice to the old one.
- **Sessions.** List, revoke one, revoke all others, sign out everywhere.
- **Account deletion.** Soft delete behind the password, then a purge cron hard-deletes the
  account after `USER_PURGE_GRACE_DAYS` and scrubs its audit rows.
- **Admin.** An admin can change roles (with self and last-admin guards), disable and enable
  accounts, clear a lockout, revoke a user's sessions, delete an account and reset a user's second
  factor. Each writes an audit row. The first admin comes from the seed or `user:promote`.

Cookies are `__Host-` prefixed in production, `Secure`, `HttpOnly` and `SameSite=Lax`. A CSRF
double-submit token is checked on every mutating request and rotated whenever a session is minted.

## The single session seam

Every sign-in ends in one method, `AuthSharedService.establishSession`, which creates the Redis
session, sets the cookie and rotates the CSRF token. In front of it sits
`TwoFactorChallengeService.beginOrEstablish`, the chokepoint that re-reads whether the account is
deleted, locked or disabled and decides between a session and a 2FA challenge. Three `pnpm
lint:meta` rules keep that shape:

- `establish-session-callers`: only the listed files may call `establishSession`, so a new sign-in
  path cannot skip the challenge.
- `session-epoch-captured`: a sign-in reads the session epoch before it checks the credential.
- `session-landing-declared`: every file that mints a session says where it leaves the caller.

Routers stay thin and keep no auth logic, which is what makes the swap a module replacement. If you
add a sign-in method, route it through `beginOrEstablish` and register it in
`tools/lint-meta/registry.ts`. [invariants/sessions.md](invariants/sessions.md) and
[invariants/account-lifecycle.md](invariants/account-lifecycle.md) say what must hold.

## Known issues

These stay until the swap:

1. **Account existence oracle.** A login against a locked account answers `ACCOUNT_LOCKED`, which
   tells anyone that the email has an account. Unknown emails and wrong passwords are
   indistinguishable, but a locked account is not.
2. **Victim lockout.** The lockout counts failures per account, so anyone who knows an email can
   lock its owner out for as long as they keep failing. The per-IP rate limit on login (10 a
   minute) slows this down, it does not stop a distributed attempt.

Also worth knowing: sign-up still answers `EMAIL_IN_USE` for a registered address.

## What changes at the swap

- The hand-rolled services, repositories and their specs under `modules/auth` are replaced by thin
  routers over the package's flows, using its Zod schemas. The api's auth code shrinks from
  thousands of lines to the routers and the wiring.
- The token scheme is the same (32 random bytes in the cookie, a SHA-256 key in Redis), so sessions
  carry over. Production cookies may be renamed, which signs users out once.
- Sign-up gets the uniform answer ("check your email") in place of `EMAIL_IN_USE`, and both known
  issues are fixed in the package.
- The web keeps its screens. Procedure names and result shapes change; the structure of the web
  feature does not.
- The Prisma auth tables come from the package's schema, so the initial migration is regenerated
  rather than patched. A fork with real data needs a proper migration for that step.
