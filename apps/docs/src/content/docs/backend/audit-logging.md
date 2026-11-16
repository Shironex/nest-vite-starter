---
title: Audit Logging
description: The append-only AuditLog model, the AuditService write path that never throws, the personal data an audit row carries, retention, what's actually audited today, and the lint rule guarding it.
sidebar:
  order: 8
---

## The `AuditLog` model

`packages/database/prisma/schema/audit.prisma`:

```prisma
// AuditLog: append-only record of who did what, for compliance / SOC 2 CC7
// / ISO A.12.4 / GDPR Art. 30. Treat as immutable: rows are never updated,
// and the only sanctioned delete path is the api's `audit-log-retention` cron.
model AuditLog {
  id            String   @id @default(cuid())
  userId        String?
  tenantId      String?
  workspaceId       String?
  action        String
  targetType    String?
  targetId      String?
  before        Json?
  after         Json?
  reason        String?
  ipAddress     String?
  userAgent     String?
  correlationId String?
  success       Boolean  @default(true)
  metadata      Json?
  createdAt     DateTime @default(now())

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([action])
  @@index([createdAt])
  @@index([targetType, targetId])
  @@index([correlationId])
  @@index([tenantId, workspaceId, targetType, targetId])
}
```

Design notes baked into the schema:

- Rows are meant to be **immutable** - the schema comment states the only sanctioned delete path is the retention cron; there is no update path anywhere in the codebase.
- `userId`'s FK is `onDelete: SetNull`, not `Cascade` or `Restrict`: deleting a user (soft-delete followed by the [purge cron](/backend/background-jobs/)) does not delete their audit history, it just nulls the reference - the compliance trail outlives the account.
- `tenantId`/`workspaceId` are plain nullable columns **with no foreign key**, because audit writes can happen pre-auth (a failed login attempt against an email that doesn't even exist) with no tenant context resolved yet.
- The composite index `[tenantId, workspaceId, targetType, targetId]` exists specifically to serve a "what happened to this entity within this Organization/Workspace" lookup - see [tenancy.md](/backend/tenancy/) for the tenant model this supports.

## `AuditService.log()`: never throws

`apps/api/src/modules/audit/audit.service.ts`, provided by a `@Global()` `AuditModule` so it's injectable anywhere without an explicit import.

```ts
async log(params: IAuditLogParams): Promise<void> {
  try {
    // resolve userId/tenantId/workspaceId/ipAddress/userAgent/correlationId,
    // explicit params win over the ALS request context fallback
    await this.prisma.client.auditLog.create({ data: { ... } });
  } catch (error) {
    // logged via structured logger, auditWriteFailuresTotal incremented, Sentry-captured
  }
}
```

This is a deliberate, tested contract: **an audit write failure must never break the user-facing operation it's recording.** The spec file names this out directly - "NEVER throws when Prisma rejects" and "never throws on FK violation." If a `Prisma` write fails (bad connection, constraint violation, whatever), the caller's actual business operation still completes; the failure is only observable via the `auditWriteFailuresTotal` counter and a Sentry capture.

Context resolution order: explicit parameters passed to `log()` win over the AsyncLocalStorage request context. This matters for flows like registration, which pass `tenantId: user.tenantId` explicitly because the audit call runs _before_ `AuthMiddleware` has had a chance to populate the ALS tenant for that request. `correlationId` is the request id, or `null` if the ALS returned the sentinel `'no-context'` value. `before`/`after`/`metadata` are only included in the insert when explicitly provided, kept out of the payload entirely otherwise.

## Canonical action vocabulary

`packages/shared/src/audit/index.ts` - shared between server (writes) and any future client/admin UI (reads/filters), so both sides can never drift on naming:

```ts
export const AUDIT_ACTIONS = {
  AUTH_REGISTER_SUCCESS: 'auth.register.success',
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILURE: 'auth.login.failure',
  AUTH_LOGIN_LOCKED: 'auth.login.locked',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_LOGOUT_ALL: 'auth.logout.all',
  AUTH_EMAIL_VERIFIED: 'auth.email.verified',
  AUTH_PASSWORD_FORGOT: 'auth.password.forgot',
  AUTH_PASSWORD_RESET: 'auth.password.reset',
  AUTH_PASSWORD_CHANGE: 'auth.password.change',
  USER_ACCOUNT_DELETED: 'user.account.deleted',
  USER_ACCOUNT_ADMIN_DELETED: 'user.account.admin_deleted',
  USER_ACCOUNT_PURGED: 'user.account.purged',
  DATA_EXPORT_DOWNLOADED: 'data_export.downloaded',
  STORAGE_FILE_DELETED: 'storage.file.deleted',
} as const;
```

Naming convention: `<domain>.<event>[.<outcome>]`, dotted and lowercase, past-tense verbs where natural.

That snippet is an excerpt. The file also carries the `auth.2fa.*` family (see [two-factor-authentication.md](/backend/two-factor-authentication/)), and its inline comments are worth reading directly: they record which metadata each action must carry and why.

**There is no action for a role change.** `updateRole` in `user.service.ts` never calls the audit logger, and `AUDIT_ACTIONS` has no `USER_ROLE_CHANGED`-style entry. This is a real gap, not an intentional omission documented elsewhere - if privilege-change auditing matters for your compliance posture, it needs to be added.

## What's actually audited today

Grep-verified real call sites of `auditService.log(...)`:

| Action                                          | Where                                                     | Notes                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AUTH_LOGIN_FAILURE` (`reason: unknown_email`)  | `login.service.ts`                                        | Fires even for emails that don't exist                                                                      |
| `AUTH_LOGIN_LOCKED`                             | `login.service.ts`                                        |                                                                                                             |
| `AUTH_LOGIN_FAILURE` (`reason: bad_password`)   | `login.service.ts`                                        |                                                                                                             |
| `AUTH_LOGIN_SUCCESS` (`metadata: {rememberMe}`) | `login.service.ts`                                        |                                                                                                             |
| `AUTH_REGISTER_SUCCESS`                         | `register.service.ts`                                     | Explicitly passes `tenantId` since ALS isn't populated yet at this point in the request                     |
| `AUTH_PASSWORD_FORGOT`                          | `password-reset.service.ts`                               | Fires even for unknown emails, `reason: unknown_email`                                                      |
| `AUTH_PASSWORD_RESET`, `AUTH_PASSWORD_CHANGE`   | `password-reset.service.ts`, `password-change.service.ts` |                                                                                                             |
| `AUTH_EMAIL_VERIFIED`                           | `email-verification.service.ts`                           |                                                                                                             |
| `USER_ACCOUNT_DELETED`                          | `account-deletion.service.ts`                             | Written before session teardown, so the trail captures the actor while still identifiable                   |
| `USER_ACCOUNT_ADMIN_DELETED`                    | `user.service.ts` (`adminDeleteUser`)                     | `targetType: 'User'`, `targetId: <deleted user's id>`                                                       |
| `USER_ACCOUNT_PURGED`                           | `user-purge.service.ts`                                   | `userId: null` (actor is the scheduler), `metadata.deletedAt` preserves the original soft-delete timestamp  |
| `DATA_EXPORT_DOWNLOADED`                        | `data-export.service.ts`                                  | Access event only, metadata, not the exported content                                                       |
| `STORAGE_FILE_DELETED`                          | `storage.router.ts`                                       | Called directly from a router, not a service - a destructive object operation gets one structured audit row |

## Placement matters: never inside a `$transaction`

`noctcore-prisma/no-audit-write-in-transaction` (from `@noctcore/eslint-plugin-prisma`; it was `mutating-service-must-audit` in this repo, renamed because that name promised a check it never made). **No lint rule requires a mutation to call the audit logger.** This one polices placement only, so a mutation that never audits lints clean; the audit row's existence is on review and the service's tests.

What it actually does: flags any `<receiver matching /audit/i>.log(...)` call that is lexically nested inside a `$transaction(...)` callback. The reasoning: `AuditService.log()` is awaited and swallows its own errors by design, so there's nothing to police about fire-and-forget - the real hazard is that an audit write made _inside_ a business transaction's callback gets rolled back together with the business work if that transaction fails, silently losing the audit row for an operation whose whole point was traceability.

```ts
// Violation: if the transaction rolls back, this audit row is lost too
await this.prisma.client.$transaction(async (tx) => {
  await tx.user.update(...);
  await this.auditService.log({ action: '...' });
});

// Fix: audit AFTER the transaction commits
await this.prisma.client.$transaction(async (tx) => {
  await tx.user.update(...);
});
await this.auditService.log({ action: '...' });
```

This is the pattern `register.service.ts` follows: `runRegistrationTransaction()` returns from the transaction, and `finalizeRegistration()` (called afterward) is what actually writes the audit row. Report-only, no autofix - moving a call across a transaction boundary is a semantic edit, not a mechanical one. There is no doc page for this rule under `packages/eslint-plugin-repo/docs/rules/`; read the rule source directly if you need the exact AST matching logic.

## Processed personal data

An audit row is its own record of processing, not an appendix to the record for whatever entity the action touched: it outlives that entity by design (`onDelete: SetNull`), and it is the one table in this schema with no update path. So it needs its own inventory. This is that inventory - keep it current when adding an action.

| Column                              | Category                                                                                                                                                                                                                                                                               | Filled by                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `ipAddress`                         | **Client IP address.** The full address as `req.ip` reports it - not truncated, hashed, or masked. Personal data on its own.                                                                                                                                                           | Request-bound writes (see below)  |
| `userAgent`                         | **User-agent request header** verbatim: browser or Electron shell, version, OS. A usable device fingerprint alongside the IP.                                                                                                                                                          | Request-bound writes (see below)  |
| `userId`, `tenantId`, `workspaceId` | Pseudonymous internal identifiers. `userId` is nulled when the account is purged; the other two are plain columns with no FK.                                                                                                                                                          | ALS context, or an explicit param |
| `targetType`, `targetId`            | Which entity was acted on. When the target is a person, or a record about one, the row is linkable to an identified natural person for as long as that record exists.                                                                                                                  | Call site                         |
| `action`, `success`, `createdAt`    | Event metadata. Not personal data alone, but it is what turns the identifiers above into attributable behavior.                                                                                                                                                                        | Call site / DB default            |
| `correlationId`                     | Request id. May be caller-supplied (`x-request-id`, `traceparent`), so treat it as untrusted for anything but correlation.                                                                                                                                                             | ALS context                       |
| `reason`                            | Free text. Today only short enum-like values (`unknown_email`, `bad_password`).                                                                                                                                                                                                        | Call site                         |
| `metadata`                          | Free-form JSON. Every current call site passes flags, counts, ids, and field **names** only, never the values of personal fields.                                                                                                                                                      | Call site                         |
| `before`, `after`                   | The who-changed-what-to-what snapshot columns. **No call site populates them today** - a grep for `before:` / `after:` across `apps/api/src` returns nothing. Whatever gets written here inherits the retention window below, so filling them is a policy decision, not a convenience. | Nothing yet                       |

**Purpose**: security monitoring, incident investigation, and accountability - the trail behind who authenticated, who changed an account or its access, and who read or mutated a sensitive record.

**Legal basis, as this repo assumes it**: legitimate interest (GDPR Art. 6(1)(f)) for the auth and access surface.

The code cannot decide this - confirm the basis against the deploying controller's own register before the product carries real customer data. There is no customer-facing privacy notice in this repo; this page is the inventory an external notice has to be built from, not a substitute for one.

### How IP and user-agent reach a row

`AuditService.write()` falls back to the AsyncLocalStorage request context whenever the call site does not pass them:

```ts
ipAddress: params.ipAddress ?? ctx?.ip ?? null,
userAgent: params.userAgent ?? ctx?.userAgent ?? null,
```

The store is built by `buildRequestContextStore` from `req.ip` and `req.headers['user-agent']`, and `req.ip` is the real client address rather than the proxy's because `main.ts` sets `trust proxy` (see [security-posture.md](/operations/security-posture/)).

`763b7a1` widened the reach of that fallback. Before it, tRPC procedures ran with no ALS store at all, so `ctx?.ip` was always `undefined` and both columns were null unless the call site passed them. The auth surface already did pass them explicitly (`login.service.ts`, `register.service.ts`, `password-reset.service.ts`, `password-change.service.ts`, the three `two-factor*.service.ts` files, `account-deletion.service.ts`), so those rows always carried both. What newly acquired them is everything relying on the fallback:

- `user.account.admin_deleted`, `data_export.downloaded`, `storage.file.deleted`
- `auth.logout`, `auth.logout.all`, `auth.email.verified`

Rows written outside a request still have both columns null, because there is no request to read them from, such as the `user-purge` sweep and the two-factor enforcement processor. The queue boundary is deliberate about this - `withJobContext` stamps `requestId`/`userId`/`traceId`/`spanId`/`tenantId`/`workspaceId` onto the job envelope and **not** `ip`/`userAgent`, so a queued follow-up to a request does not inherit the requester's network identifiers (see [background-jobs.md](/backend/background-jobs/)).

## Retention

`apps/api/src/modules/audit/audit-retention.service.ts`:

```ts
export const AUDIT_RETENTION_BATCH_SIZE = 5000;
export const AUDIT_RETENTION_MAX_BATCHES = 200;

@Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'audit-log-retention' })
async handleCron(): Promise<void> { await this.sweep(); }
```

- Retention window: `AUDIT_LOG_RETENTION_DAYS` env var, `Joi.number().integer().min(30)`, default **365 days**. The floor of 30 is deliberate - it stops a fat-fingered config value from gutting the compliance trail overnight.
- Deletes rows with `createdAt < cutoff` in batches of 5000 (`findMany` ordered by `createdAt: 'asc'`, then `deleteMany` on the batch's ids), capped at 200 batches per tick - roughly a 1M-row/day ceiling, so a larger backlog drains across consecutive daily ticks instead of one long-running sweep holding a transaction open.
- Idempotency contract, quoted directly: "Idempotent by predicate (createdAt < cutoff), so it races safely when @Cron fires on every replica. Best-effort: sweep() NEVER throws; a failed tick logs and returns 0. Emits audit_retention_deleted_total so the work is observable."
- Uses `prismaService.client` (the tenant-scoped client) directly - safe because `AuditLog` is **not** in `TENANT_SCOPED_MODELS` (see [tenancy.md](/backend/tenancy/)), so the extension passes it through untouched even with no tenant in the AsyncLocalStorage context. This matters because the retention cron runs outside any request, with no tenant context at all.

See [background-jobs.md](/backend/background-jobs/) for how this cron's schedule relates to the other two daily sweeps.

### Is 365 days right for IP and user-agent specifically?

Reviewed for those two columns rather than for the action metadata as a whole, and deliberately left unchanged:

- **The identifiers never outlive the event they annotate.** IP and user-agent exist to make one row investigable; they expire with that row, on the same boundary as the action itself. There is no path that leaves a bare network identifier behind after its event is swept.
- **Nothing can keep them longer than the row.** `AuditLog` has exactly three operations in the codebase - the `create` in `audit.service.ts` plus the sweep's `findMany`/`deleteMany` - and no update path anywhere. The sweep is therefore the only thing that can ever remove an IP or a user-agent, and it removes the whole row when it does.
- **A year is at the long end of defensible for an IP, not past it.** A full year of lookback is what makes the trail useful for an incident or a claim raised late, and the window is uniform, bounded, and enforced by a cron with its own failure counter and Sentry capture.
- **The knob has a floor but no ceiling.** Raising `AUDIT_LOG_RETENTION_DAYS` raises the IP/user-agent horizon with it. That config change is the thing to review against the controller's register, not the default. If the register commits to a shorter horizon for network identifiers, lowering the value applies it to the whole table and costs evidence longevity - see the tension immediately below.

### One window, two purposes pulling opposite ways

Recorded here rather than resolved, because resolving it is a policy decision plus new machinery:

- **IP and user-agent want the shortest defensible window.** They are the highest-sensitivity, shortest-usefulness columns in the table.
- **Evidence rows want the longest.** A row that stands behind a statutory record has to stay reconstructible for as long as that record does, and measured against a multi-year statutory horizon, 365 days is short.

The design that satisfies both is a **split window**: clear `ipAddress`/`userAgent` on a short horizon while keeping the action metadata for the statutory one. That needs an update path to a table this repo deliberately treats as immutable (the schema comment names the retention cron as the only sanctioned mutation), plus a controller-level decision on both horizons. It is not changed here. Tracked under [Modifying this area](#modifying-this-area).

### What user deletion and purge actually reach

**Neither flow touches `ipAddress` or `userAgent`.** The FK is `onDelete: SetNull`, which nulls `userId` and nothing else, and no code path updates an `AuditLog` row.

So once `user-purge` hard-deletes an account, its audit rows survive with the IP, the user-agent, and the erased user's id still in `targetId`, while `userId` reads null. Concretely: a self-service deletion writes `user.account.deleted` carrying the requester's IP and user-agent (`account-deletion.service.ts` passes both explicitly), the purge cron erases the account `USER_PURGE_GRACE_DAYS` later (default 30), and that row keeps both columns until the sweep reaches it - up to 365 days from the request, so roughly 335 days after the account itself is gone. The retention sweep is the erasure path for those columns. The deletion flow is not, and the `user.account.purged` row the cron writes has both columns null anyway, since a cron has no client.

Keeping an audit trail past an erasure request is the ordinary position (Art. 17(3) leaves room for legal obligation and the defense of legal claims) and this one is bounded rather than indefinite. It is written down here because a bounded retention nobody wrote down is indistinguishable from an oversight.

## No admin-facing reader today

There is currently **no way to browse or filter audit logs through the API.** A grep across every `*.router.ts` for audit-related reads found only write call sites (`storage.router.ts` writes on delete) and a comment in `data-export.router.ts` noting the export access event is audited - nothing queries the `AuditLog` table for display. If a task requires an admin audit-log viewer, that's new work: a new router (or new procedures on an existing one), gated by `AdminMiddleware` and almost certainly tenant-scoped by the composite `[tenantId, workspaceId, targetType, targetId]` index that already exists for exactly this kind of query. There is also a `VIEW_AUDIT_LOG` entry already defined in `packages/shared/src/permissions/index.ts`'s `PERMISSIONS` object, unused by any router today - that's the natural permission to gate a new reader behind.

## Modifying this area

- **Adding a new audited action**: add an entry to `AUDIT_ACTIONS` in `packages/shared/src/audit/index.ts` first (dotted, lowercase, past-tense), then call `auditService.log({ action: AUDIT_ACTIONS.YOUR_NEW_ACTION, ... })` from the service, **after** any `$transaction` it's related to has committed. If the row carries a category the [processed-data inventory](#processed-personal-data) doesn't already list - anything in `metadata`, `reason`, `before`, or `after` beyond flags, counts, ids, and field names - extend that table in the same change. The inventory is only as good as the last person who added an action.
- **Auditing role changes** (the known gap above): add a `USER_ROLE_CHANGED`-shaped action and call it from `UserService.updateRole()`, capturing `before`/`after` role values.
- **Building an admin audit-log reader**: gate it behind `AdminMiddleware` plus (once wired) the existing `VIEW_AUDIT_LOG` permission, and lean on the `[tenantId, workspaceId, targetType, targetId]` index for the primary query shape.
- **Changing retention**: set `AUDIT_LOG_RETENTION_DAYS` (env var, minimum 30, default 365). One value covers the whole table, so read [the two-purpose tension](#one-window-two-purposes-pulling-opposite-ways) before moving it in either direction: lowering it shortens the IP/user-agent horizon and the evidence horizon together, raising it lengthens both.
- **Splitting the retention window** (the recorded tension above): the shape is a second, shorter sweep that nulls `ipAddress`/`userAgent` on rows past a network-identifier horizon while leaving the row itself for the main sweep. Two things make this more than a cron: it introduces the first `AuditLog` update path (the schema comment currently names the retention delete as the only sanctioned mutation, and `mutating-service-must-audit` plus the immutability convention assume that), and it needs the controller to commit to both horizons. Get the policy decision first, then the code.
- Running the audit test suite: `pnpm --filter @repo/api test -- audit`.
