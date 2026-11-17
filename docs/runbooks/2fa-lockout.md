# Runbook: a user is locked out of their second factor

For a user who lost their authenticator app and every recovery code. Try the rungs in order and
stop at the first one that works.

## The ladder

1. **Recovery code (self-serve).** At the login challenge the user enters one of their 16-character
   recovery codes instead of a TOTP. No operator involved. Each code works once.
2. **Admin reset.** Another admin opens the admin area (`/admin`), finds the user in the users table
   and chooses **Reset two-factor** (the procedure is `twoFactor.resetUserTwoFactor`). An admin
   cannot target themselves; self-removal is `twoFactor.disable`, which needs the password and a
   code. The reset wipes the user's factors, trusted devices and pending challenges, revokes every
   session, writes an `auth.2fa.admin_reset` audit row and emails the user. The user then signs in
   with the password alone and can enrol again from settings.
3. **Operator reset.** Only when no other admin exists (the locked-out user is the sole admin). The
   cheapest route is still rung 2: promote a second account you control, then use it.

   ```bash
   pnpm --filter @repo/api user:promote <other-account-email>
   ```

   The other account signs in again (its sessions were revoked), then runs the admin reset above.
   Demote it afterwards if you do not want a second admin.

If even that is not possible, do the reset by hand. Treat it as the last resort, because it strips
the strongest protection the account has:

1. Confirm who is asking, through a channel you recorded before the request (not one supplied in
   the request). A wrong call here hands the account to an attacker.
2. Delete the user's `SecondFactor` rows (the TOTP factor and its recovery codes). The account
   counts as having 2FA only while an active TOTP row exists.
3. Clear the user's Redis records, so nothing opened under the old factor survives:
   `trusted_devices:<userId>` and each `trusted_device:<id>` it lists, `twofa_pending_user:<userId>`
   and each `twofa_pending:<id>` it lists, then the user's sessions (`user_sessions:<userId>` and
   each `session:<id>` it lists). Increment `session_epoch:<userId>` last (`INCR`), so a sign-in that
   was already in flight loses its race.
4. Have the user run the normal password reset, since the account may be compromised.
5. Insert one `AuditLog` row by hand: action `auth.2fa.admin_reset`, `targetType` `User`,
   `targetId` the user's id, and the reason and who acted in `metadata`. Do not skip it.

## There is no email-code fallback

Email is not a second factor and not a recovery channel anywhere in this app. There is no
one-time-code-to-email path around the ladder, on purpose: it would make the mailbox the weakest
link of an account that chose 2FA to avoid exactly that. Do not build one.

## Related

- `docs/auth.md` for how the second factor, trusted devices and the session seam fit together.
- `apps/api/src/modules/auth/services/two-factor-admin-reset.service.ts` for what rung 2 does,
  which is the checklist the manual path above mirrors.
