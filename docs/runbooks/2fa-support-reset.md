# Runbook: platform support reset of a user's two-factor authentication

Applies to the last rung of the 2FA reset ladder: a user who has lost their
authenticator app AND their recovery codes AND cannot be helped by an Organization
admin reset (for example, they are the sole admin of their Organization, or the Organization
admin has themselves lost their factor). This is a manual, operator-run process
performed by platform support. It is not a self-service action and not a
tenant-admin action.

Do not use this document for the earlier rungs. If the user still holds any
recovery code, or an Organization admin can reach `twoFactor.resetMemberTwoFactor` on
their behalf, that is the correct path and this runbook does not apply.

## The reset ladder

There are exactly three rungs, tried in order:

1. **Recovery code (self-serve).** At the login challenge the user submits a
   16-character recovery code instead of a TOTP. No operator involvement. This
   is the primary lost-authenticator path.
2. **Organization admin reset.** A tenant admin calls `twoFactor.resetMemberTwoFactor`
   for a member of their own Organization (ALS-scoped, cannot cross tenants, cannot
   target self). Wipes the member's factors and forces re-enrollment.
3. **Platform support reset (this runbook).** Only when rungs 1 and 2 are both
   exhausted.

There is deliberately no email-OTP rung anywhere in the ladder (see the closing
section).

## Current state: manual, no endpoint yet

Read this before anything else. The support reset is a documented process, but
the tooling to execute it is **not built**. What exists in the codebase today:

- The contest-notice email. `sendTwoFactorSupportResetContestEmail(to,
ticketRef, contestUntil)` in `apps/api/src/modules/mail/mail.service.ts` is
  wired end to end (queue job, processor, zod payload schema, and the
  `two-factor-support-reset-contest.tsx` template in `packages/email`).
- The audit action. `AUTH_2FA_SUPPORT_RESET` (`auth.2fa.support_reset`) is
  defined in `packages/shared/src/audit/index.ts` with its documented metadata
  shape `{ ticketRef, verificationMethod, operatorId }`.

What does **not** exist: any code that calls either of them. Grep-confirmed at
time of writing, `sendTwoFactorSupportResetContestEmail` has zero callers
outside the mail module, and `AUTH_2FA_SUPPORT_RESET` has zero `.log()` call
sites. There is no support-reset tRPC procedure, no service method, and no admin
UI. Until that endpoint is built, an operator performs every step below by hand
against the database and Redis, and writes the audit row manually.

Treat the manual steps as a stopgap. The correct long-term fix is a
platform-operator procedure that performs the reset transactionally and emits
the contest email and audit row for you; the manual sequence here is only to
unblock a genuinely locked-out user in the meantime.

## When to use it

Only after both self-serve recovery codes and the Organization-admin reset are
genuinely unavailable. Concretely, all of the following hold:

1. The user has lost access to their authenticator app (the active TOTP
   factor).
2. The user has no remaining unused recovery code.
3. No Organization admin can perform `twoFactor.resetMemberTwoFactor` for them (single
   admin who is themselves locked out, or the admin's own factor is lost).

If any earlier rung is still reachable, use it instead. A support reset is the
highest-privilege account action in the system: it strips the account's second
factor and forces a password reset, so it must be the last resort, not a
convenience.

## Identity verification (three-part, out of band)

Before touching anything, all three checks MUST pass. This is a manual,
out-of-band verification against data the platform already holds; it is not an
in-app flow.

1. **Registration data.** Confirm the requester against what is on file for the
   account: the registration email, and any other durable registration
   attributes the deployment records. The requester must produce these without
   being prompted with the answers.
2. **On-file callback.** Reach the account owner through a contact channel that
   was recorded before the request (a phone number or secondary contact on
   file), not one supplied in the request itself. A request that only supplies
   new contact details fails this check.
3. **Written request.** A written, attributable support request that names the
   ticket reference. This is what `ticketRef` in the audit row points back to.

If any of the three cannot be satisfied, STOP. Do not proceed on two of three.
Record the specific verification method used (which channels, which data) so it
can be entered as `verificationMethod` in the audit row.

## The 24-hour contest window

After identity verification passes, and BEFORE applying the reset, open a
24-hour contest window so the real account owner can stop an
impersonation-driven reset.

1. Compute `contestUntil = now + 24h`.
2. Send the contest notice to the account owner's on-file email immediately:
   `sendTwoFactorSupportResetContestEmail(ownerEmail, ticketRef, contestUntil)`.
   The template tells the owner that a support reset was requested, that no
   action is needed if they asked for it, and that they must contact support
   before the deadline to stop it. The producer dedupes on `ticketRef`, so a
   repeated send for the same ticket collapses to one email.
3. Wait out the full window. Do not apply the reset early.
4. If the owner contests within the window, STOP and treat the request as
   suspected account takeover. Do not reset.

The window plus the immediate notification is the compensating control for a
manual, human identity check: even if verification was fooled, the genuine owner
gets a chance to intervene before their second factor is removed.

## Applying the reset (after the window)

Once the contest window has elapsed with no objection, apply **admin-reset
semantics PLUS a forced password reset**. The semantic template is
`TwoFactorPolicyService.resetMemberTwoFactor`
(`apps/api/src/modules/auth/services/two-factor-policy.service.ts`), minus its
tenant scoping: support operates across tenants, so the tenant-membership check
that method enforces does not apply here.

The admin-reset semantics, in order:

1. **Wipe factors.** Delete every `SecondFactor` row for the user (the active
   TOTP row and all recovery-code rows). This is what
   `SecondFactorRepository.deleteAllForUser` does; the row's FK is
   `onDelete: Cascade` from `User`, and the derived "2FA enabled" state flips to
   false the moment the active non-recovery factor is gone.
2. **Revoke trusted devices.** Clear the user's `trusted_devices:<userId>` set
   and every `trusted_device:<id>` blob in Redis (the
   `TrustedDeviceService.revokeAll` walk). A remembered browser must not survive
   the reset.
3. **Revoke pending challenges.** Delete any in-flight
   `twofa_pending:<id>` records and the `twofa_pending_user:<userId>` set in
   Redis, so a mid-flight challenge cannot be completed against the old factor.
4. **Revoke sessions.** Drop every Redis session and force-disconnect live
   sockets for the user (`SessionRevocationService.revokeAllAndDisconnect`).

Then, the additional step that an Organization admin reset does not perform:

5. **Force a password reset.** A support reset assumes the account may be
   compromised, so a fresh factor alone is not enough. Drive the account through
   the standard password-reset flow. Because the factors were wiped in step 1,
   the reset-completion 2FA gate (`resetPassword` requiring a current TOTP or
   recovery code when a factor is active) no longer applies, so the owner can
   complete the reset from their mailbox. The password-reset flow already
   revokes all sessions and never auto-logs-in, which is why layering it on top
   closes the mailbox-only lockout attack rather than reopening it.

After this, the account has no second factor, no trusted devices, no live
sessions, and a pending password reset. If the user's Organization requires 2FA, they
re-enter enrollment grace and are prompted to re-enroll at next login, exactly
like the admin-reset path (grace does not restart for them individually).

## Audit requirements

Write exactly one audit row for the completed reset:

- Action: `AUTH_2FA_SUPPORT_RESET` (`auth.2fa.support_reset`).
- Metadata: `{ ticketRef, verificationMethod, operatorId }` where `ticketRef`
  is the written-request reference from identity verification,
  `verificationMethod` records which of the three channels/data were used, and
  `operatorId` identifies the platform operator who performed the reset.
- `targetType: 'User'`, `targetId: <the reset user's id>`.

The `AuditLog` trail is append-only and immutable by policy; this row is the
permanent record that a highest-privilege manual action happened, who did it,
and against what ticket. Until the endpoint exists to write it automatically,
the operator inserts this row by hand as part of the procedure. Do not skip it.

## There is no email-OTP fallback

State this plainly to any user or operator who asks. Email is not a second
factor and not a recovery channel anywhere in this system. There is no
one-time-code-to-email path that bypasses the ladder, by explicit product
decision. A user who has exhausted recovery codes and cannot
reach an Organization admin has exactly one remaining path: this operator-run support
reset, gated by out-of-band identity verification and the 24-hour contest
window. Anyone offering an "email us a code" shortcut is describing a flow that
does not exist and must not be built as one.

## Related

- The 2FA feature page in `apps/docs` (Backend, "Two-Factor Authentication")
  for the enrollment, challenge, trusted-device, and enforcement mechanics this
  reset unwinds.
- `docs/migration-playbook.md` for the general "prefer a reviewable script over
  hand-run SQL" guidance that applies once this is scripted.
