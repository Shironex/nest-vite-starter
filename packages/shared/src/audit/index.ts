import piiRegistry from './pii-fields.json';

/**
 * Canonical audit-action names. Kept here in `@repo/shared` so server (writes)
 * and any future client/admin UI (reads/filters) share the same vocabulary.
 *
 * Naming convention: `<domain>.<event>[.<outcome>]`, dotted, lowercase,
 * past-tense verbs where natural. Failures use `.failure`, special cases
 * (e.g. lockout) get their own suffix.
 *
 * When adding new actions: extend the const, add to the union, and use the
 * type at every `auditService.log({ action })` call site so misspellings are
 * caught at compile time.
 */
export const AUDIT_ACTIONS = {
  // auth.register
  AUTH_REGISTER_SUCCESS: 'auth.register.success',

  // auth.login
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILURE: 'auth.login.failure',
  AUTH_LOGIN_LOCKED: 'auth.login.locked',

  // auth.lockout. The failed attempts that ARM the progressive lockout are
  // already audited (auth.login.failure / auth.login.locked); this is the row
  // for the person who releases it. An admin unlock resets failedAttempts AND
  // lockoutCount, so it does not merely open the door once; it puts the
  // account back on the 5-minute rung, and without this row "who cleared the
  // brake on an account that had been locked three times" is unanswerable.
  // before: { lockoutCount, failedAttempts }: the state that was cleared,
  // which is the only place it survives (the reset overwrites both columns).
  AUTH_LOCKOUT_ADMIN_CLEARED: 'auth.lockout.admin_cleared',

  // auth.logout
  AUTH_LOGOUT: 'auth.logout',
  AUTH_LOGOUT_ALL: 'auth.logout.all',
  // Self-service "log out everywhere else": every session revoked, then the
  // caller's is immediately re-issued, so unlike logout.all they stay in.
  AUTH_LOGOUT_OTHERS: 'auth.logout.others',
  // Self-service single-session revoke from the active-sessions screen.
  // metadata: { sessionRef }: the opaque PUBLIC session handle (already
  // client-visible), never the server-side session id.
  AUTH_SESSION_REVOKED: 'auth.session.revoked',

  // auth.email
  AUTH_EMAIL_VERIFIED: 'auth.email.verified',
  // metadata: { newEmail }, deliberate PII: the tripwire trail must show
  // WHERE the login identity was about to move.
  AUTH_EMAIL_CHANGE_REQUESTED: 'auth.email.change.requested',
  // before/after: { email }: the issue-mandated who-changed-what-to-what row.
  AUTH_EMAIL_CHANGED: 'auth.email.changed',
  // The REQUEST to resend, not the token rows. Same posture as
  // auth.password.forgot: the flow is rate limited and Turnstile guarded, so
  // what the trail has to answer is who asked and how often, and a refusal is
  // as interesting as a success (metadata: { reason } with success: false).
  AUTH_EMAIL_VERIFICATION_RESENT: 'auth.email.verification.resent',

  // auth.password
  AUTH_PASSWORD_FORGOT: 'auth.password.forgot',
  AUTH_PASSWORD_RESET: 'auth.password.reset',
  AUTH_PASSWORD_CHANGE: 'auth.password.change',

  // auth.2fa (two-factor authentication; the canonical list for the 2FA effort)
  AUTH_2FA_ENROLL_BEGIN: 'auth.2fa.enroll.begin',
  AUTH_2FA_ENABLED: 'auth.2fa.enabled',
  AUTH_2FA_DISABLED: 'auth.2fa.disabled',
  // metadata.method: 'totp' | 'recovery' | 'trusted_device'
  AUTH_2FA_CHALLENGE_SUCCESS: 'auth.2fa.challenge.success',
  // metadata.reason: 'bad_code' | 'replay' | 'rate_limited' | 'pending_expired'
  AUTH_2FA_CHALLENGE_FAILURE: 'auth.2fa.challenge.failure',
  AUTH_2FA_LOCKED: 'auth.2fa.locked',
  AUTH_2FA_RECOVERY_USED: 'auth.2fa.recovery.used',
  AUTH_2FA_RECOVERY_REGENERATED: 'auth.2fa.recovery.regenerated',
  AUTH_2FA_TRUST_REVOKED: 'auth.2fa.trust.revoked',
  AUTH_2FA_POLICY_CHANGED: 'auth.2fa.policy.changed',
  AUTH_2FA_ENFORCED: 'auth.2fa.enforced',
  AUTH_2FA_ADMIN_RESET: 'auth.2fa.admin_reset',
  // metadata: { ticketRef, verificationMethod, operatorId }
  AUTH_2FA_SUPPORT_RESET: 'auth.2fa.support_reset',

  // oauth (Google sign-in SPEC sections 5-8). Every row carries the provider
  // key and providerAccountId (sub) in metadata and an EXPLICIT tenantId;
  // these flows run before AuthMiddleware seeds the ALS, so the context
  // fallback would stamp null. Tokens, codes and state values never appear.
  OAUTH_LOGIN: 'oauth.login',
  OAUTH_SIGNUP: 'oauth.signup',
  OAUTH_LINK: 'oauth.link',
  OAUTH_UNLINK: 'oauth.unlink',
  // metadata.reason: which gate rejected the flow (state_missing,
  // browser_mismatch, exchange_failed, account_deleted, account_locked,
  // email_unverified, link_blocked_second_factor,
  // link_blocked_password_account, account_exists,
  // signup_disabled, link_no_session, link_session_mismatch,
  // sub_linked_elsewhere, link_unauthorized, rate_limited, epoch_fence,
  // membership_ended, exception).
  OAUTH_FAILURE: 'oauth.failure',

  // user.role. A privilege grant is the tenant's security posture changing, so
  // "who made this account an admin, and when" has to be answerable years
  // later. before/after carry the role VALUES rather than field names: a role
  // is not PII, and a trail that says only
  // "role" changed cannot answer the question anyone actually asks. Same shape
  // as auth.email.changed.
  USER_ROLE_CHANGED: 'user.role.changed',

  // before/after: { avatarUrl }: storage keys, not PII. The row exists
  // because User.avatarUrl keeps no history: once overwritten, which image a
  // profile used is unrecoverable, and the old object is deleted from S3 right
  // after. Note storage.file.deleted already audits removing an avatar OBJECT,
  // so without this, deleting one left a trail and setting one did not.
  USER_AVATAR_CHANGED: 'user.avatar.changed',

  // user.account (deletion lifecycle: soft delete, admin soft delete, purge)
  USER_ACCOUNT_DELETED: 'user.account.deleted',
  USER_ACCOUNT_ADMIN_DELETED: 'user.account.admin_deleted',
  USER_ACCOUNT_PURGED: 'user.account.purged',

  // user.tenant. An account changing which organization it belongs to, which happens
  // on exactly one path: accepting a staff invitation at an address that already
  // has an account elsewhere.
  //
  // No precedent, because nothing in this product has ever moved an account
  // between tenants. before/after carry BOTH the tenantId and the role, and the
  // role half is the one that is easy to leave out: branch B sets the invited
  // role directly, without going through updateRole, so omitting it would leave
  // "when did this person become an admin" unanswerable in an application built
  // for exactly that question. No address and no PII.
  USER_TENANT_MOVED: 'user.tenant.moved',

  // data_export (GDPR Art. 20 data portability; access events, metadata only)
  DATA_EXPORT_DOWNLOADED: 'data_export.downloaded',

  // storage (destructive object operations)
  STORAGE_FILE_DELETED: 'storage.file.deleted',

  // workspace (the platform Organization -> Workspace tier, modules/workspace).
  // The workspace every tenant-owned record below the organization hangs off.
  // Created rarely and only by an ADMIN, but a wrong or duplicated Workspace
  // silently splits one workspace's records across two lists.
  //
  // These strings are persisted in AuditLog.action, which is append-only
  // evidence: once rows exist, renaming a value would orphan every existing row
  // from its filter and its label, and rewriting the rows would edit the audit
  // trail itself. Rename the constant freely, never the value.
  WORKSPACE_CREATED: 'workspace.created',
  // metadata: { fields }: field NAMES only, never the values.
  WORKSPACE_UPDATED: 'workspace.updated',

  // staff. Admitting a colleague INTO the organization. A separate
  // domain rather than more `user.` actions because the
  // question these answer is a different one: `user.` rows are about an account,
  // these are about MEMBERSHIP of an organization, and the filter dropdown groups
  // by exactly that distinction.
  // metadata: { role, outcome, emailSent }: never the address, which is the
  // invitee's own PII and is already the target row's identity.
  STAFF_INVITE_SENT: 'staff.invite.sent',
  // metadata: { reason }: email_in_use, deleted_address, already_a_member,
  // removed_member. Refusals are audited because "we never invited them" and
  // "the invite was refused" are different answers
  // to the same question, and only one of them is innocent.
  STAFF_INVITE_FAILED: 'staff.invite.failed',
  // The invitation withdrawn before it was ever accepted. The pending row is
  // hard-deleted with it, which is safe precisely because an account that never
  // had a password was never an actor on anything, so this row is the only
  // surviving trace that the invitation existed at all.
  STAFF_INVITE_REVOKED: 'staff.invite.revoked',
  // The member exists from here on: password set, emailVerified flipped.
  STAFF_INVITE_ACCEPTED: 'staff.invite.accepted',
  // The sweep erased an invitation nobody ever accepted, more than 30 days
  // after its last link expired. Same shape and same safety as the withdrawal
  // above (an account that never had a password was never an actor on
  // anything), and separate from it because no person decided this one.
  // metadata: { role }.
  STAFF_INVITE_EXPIRED: 'staff.invite.expired',
  // Membership ended without deleting the account: reversible, and the account
  // keeps its tenantId so the removal stays visible. Sessions are revoked with
  // it. Distinct from user.account.admin_deleted, which is the one-way door.
  MEMBER_REMOVED: 'staff.member.removed',
  // A removed member put back. metadata names whether the restored member is an
  // ADMIN, because re-admitting one is a privilege grant that did not pass
  // through user.role.changed.
  MEMBER_RESTORED: 'staff.member.restored',

  // audit. The retention cron is the ONLY sanctioned delete path for AuditLog
  // rows, so its own work needs a durable trace: a counter resets on restart and
  // a log line naming the retention DAY COUNT only implies the rule, leaving
  // "which rows went, and by what cutoff" unreconstructible afterwards. One row
  // per run, written AFTER the deletes so the sweep cannot destroy its own
  // evidence in the same pass.
  // metadata: { cutoff, retentionDays, deleted }: cutoff is the ISO instant
  // the predicate actually used, which is the value the day count only implies.
  AUDIT_RETENTION_SWEEP: 'audit.retention.sweep',

  // notifications. The saved channel matrix rides in metadata:
  // it is small, non-PII, and "who muted what, when" is the question this row
  // answers when someone asks why a reminder never reached them.
  NOTIFICATION_PREFERENCES_UPDATED: 'notifications.preferences.updated',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * AUDIT PII REGISTRY. The contract between a lint rule and a purge job: adding
 * an entry here changes what gets ERASED, not merely what lints.
 *
 * The owner's policy for audit payloads is SCRUB ON PURGE: a key listed here
 * may carry personal data in an audit row's `metadata`, `before` or `after`
 * while its subject exists, and the user purge (UserPurgeService, via
 * AuditPiiScrubService in apps/api) overwrites every occurrence of it, at any
 * depth, with AUDIT_PII_ERASED_VALUE before the user row is deleted.
 *
 * Two readers, one list:
 *   - `observability/audit-pii-declared` (packages/eslint-config/nestjs.js,
 *     `registeredFields`) fails lint on an audit write that puts a PII-shaped key
 *     in a readable payload without it being declared. A parity spec in apps/api
 *     (audit-pii-registry.parity.spec.ts) loads the REAL lint config and fails if
 *     the two lists differ, so declaring a key in one place and not the other is
 *     red rather than a key that lints clean and is never erased.
 *   - the purge scrub, which erases exactly these keys and nothing else.
 *
 * What an entry asserts: a value under this key, anywhere in a user's audit
 * rows, is personal data of THAT user (or of nobody who outlives them). The
 * scrub cannot tell whose address a value is; it erases the key in every row
 * the purged user is the subject or the actor of.
 *
 *   - `newEmail`: the requested address, auth.email.change_requested metadata.
 *   - `email`: the before/after pair of auth.email.changed.
 *
 * The list itself lives in `pii-fields.json` so the lint config can read the
 * same bytes. It cannot import this module: `@repo/shared` already depends on
 * `@repo/eslint-config`, and the reverse edge is a cycle turbo refuses to
 * schedule. JSON is the one format both a bundled TS module and a plain config
 * file can read without either depending on the other.
 */
export const AUDIT_PII_FIELDS: readonly string[] = piiRegistry.fields;

export type AuditPiiField = (typeof AUDIT_PII_FIELDS)[number];

/**
 * What a registered field holds after the purge. A fixed marker, never a hash:
 * an email address is low entropy, so any unkeyed digest is reversible by a
 * dictionary pass, and a keyed one keeps a recovery key alive. Not `null` and
 * not a deleted key, because both read as "never captured": the marker keeps
 * the fact that the row carried the field, and the row keeps its action,
 * timestamps and opaque ids.
 */
export const AUDIT_PII_ERASED_VALUE = '[erased]';
