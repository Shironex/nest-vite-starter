---
title: Security Posture
description: Rate limiting, CSRF, session hardening, secret scanning, headers/CORS, upload validation, audit logging, and the known limitations.
sidebar:
  order: 6
---

This page documents the security controls in the current working tree, and ends with the known limitations: what the starter deliberately does not do yet, so a product built on it can decide what to add before launch.

## Rate limiting

`ThrottlerModule` is configured in `apps/api/src/app.module.ts` with **Redis-backed storage** (`ThrottlerStorageRedisService` from `@nest-lab/throttler-storage-redis`, pointed at the same `REDIS_CLIENT` used elsewhere), a single shared limit window across API replicas, not an in-memory bucket per process. Global limit: `{ ttl: 60000, limit: 100 }` (100 requests / 60s), applied via `APP_GUARD` (`ThrottlerGuard`), so it's active on every route by default.

`GET /api/csrf-token` gets a tighter, route-specific override: `@Throttle({ default: { limit: 30, ttl: 60000 } })` in `apps/api/src/common/security/csrf.controller.ts`: deliberately tighter than the global default because the endpoint is unauthenticated and a legitimate client fetches a token roughly once per session. The endpoint lives on a real Nest controller (rather than on the raw HTTP adapter) specifically so the global guard applies.

Login attempts have their own, separate defense: `enforceAuthRateLimit` (`auth-shared.service.ts`) caps logins at 10/60s per IP, and `LockoutService` adds progressive account lockout (5 failed attempts triggers 5m -> 15m -> 1h -> permanent-with-admin-unlock).

There is no per-tenant or per-route-family rate limiting beyond the auth-specific case above: the global bucket is one flat value for everything else.

Express is configured with `app.set('trust proxy', configService.get('TRUST_PROXY', 'loopback'))` in `main.ts`, so `req.ip` (and therefore every IP-keyed rate limit and audit-log IP) reflects the real client behind a reverse proxy (Traefik, Caddy, nginx) rather than the proxy's own address. `TRUST_PROXY` is an env var (`.env.example` documents `loopback` as correct for a proxy on the same host; use a hop count or specific IP list for multi-hop setups like CloudFront -> Traefik).

## CSRF

Implemented via `csrf-csrf` (double-submit cookie pattern), encapsulated in `apps/api/src/common/security/csrf.service.ts`. Two properties make it work in every realistic deployment (dev over plain HTTP, the production SPA and the Electron shell):

- A pre-session identity cookie (`__Host-csrf-sid` in production, `csrf-sid` in dev) is minted on the first request via `ensureSessionIdentifier` middleware, **before** any login session exists. This is what `getSessionIdentifier` hashes into the CSRF token, so every unauthenticated browser gets its own distinct identifier instead of all sharing an empty string.
- `secure` is gated on `isProduction`, so dev over plain HTTP works without the cookie being silently dropped.
- The CSRF token cookie itself: `sameSite: isProduction ? 'none' : 'lax'`, `secure: isProduction`, `httpOnly: true`. `'none'` in production is necessary because this one `csrf-csrf` instance serves both the same-site web SPA and the cross-site `app://` Electron origin.
- **Rotation**: `csrfService.rotate()` forces a fresh token (`generateCsrfToken(req, res, { overwrite: true })`) after register/login/logout/changePassword, so a token issued pre-auth doesn't remain valid post-auth.
- **Error handling**: a CSRF validation failure is translated to an explicit `403` with the app's standard error envelope (rather than letting it fall through to Express's default handler as an uncaught 500) specifically so the web client's CSRF self-heal retry (`apps/web/src/lib/csrf.ts`, which watches for a 403 mentioning "csrf") actually fires.
- `/api/vitals` is the one deliberate CSRF exemption, a `sendBeacon` POST fired before any session/CSRF token can exist, gated at both the sid-cookie-creation and CSRF-protection steps to avoid a cookie race with `GET /api/csrf-token`.

The SPA calls `resetCsrfToken()` after auth mutations; if CSRF failures appear after changing an auth flow, re-check those call sites end to end.

## Session hardening

- Argon2id password hashing (`@node-rs/argon2`) with OWASP-baseline parameters, single source of truth in one `ARGON2_OPTIONS` config shared by the hasher and the timing-equalization dummy hash used on the login path (so a nonexistent-user login takes the same wall-clock time as a real failed password check, defeating account enumeration via timing).
- Sessions: random 32-byte token, SHA-256 hashed before Redis storage, `MAX_SESSIONS = 3` per user with oldest-session eviction on the 4th concurrent login (`apps/api/src/modules/auth/services/session.service.ts`), `deleteAllUserSessions` invoked on password reset and password change.
- **Session cookie `SameSite`** is origin-aware, not a single static value: `resolveSameSite()` in `auth-shared.service.ts` returns `'lax'` in every non-production environment (both clients talk to plain-HTTP `localhost`, where `'none'` would require `secure`), and in production returns `'none'` only when the request's `Origin` header is the desktop app's origin (`DESKTOP_APP_ORIGIN`), every other production origin (the web SPA) gets `'lax'`.
- Progressive account lockout (`LockoutService`): 5 failed attempts -> escalating lockout windows (5m/15m/1h/permanent), with admin unlock for the permanent case.
- Turnstile (Cloudflare CAPTCHA) gates register/login/forgot-password/resend-verification. The dev fallback test key (`1x0000000000000000000000000000000AA`) is explicitly dev-only-gated; a missing production key logs loudly, and server-side verification remains the actual gate regardless.
- Email-existence non-disclosure on both login and forgot-password (does not reveal whether an email is registered).
- Disposable-email domains are blocked at registration.

**Second factor**: TOTP with recovery codes, trusted devices, and per-Organization enforcement policy (`TotpService`, `TwoFactorChallengeService`, `TrustedDeviceService`; see the [two-factor doc](/backend/two-factor-authentication/)). `SecondFactorType.WEBAUTHN` is reserved in the schema with **no v1 code path**: every query filters by `type`, so the reserved value cannot leak into a TOTP path.

**SSO**: Google sign-in over OIDC, with account linking and a sudo re-authentication gate on unlink (see the [Google sign-in doc](/backend/google-sign-in/)). Each deployment provisions its own Google OAuth client (see the [Google OAuth deployment doc](/operations/google-oauth-deployment/)); the test suites run against an injected fake `OPENID_CLIENT`.

**Session rotation on privilege change**: a role change calls `UserService.revokeAuthState`, which drops every Redis session, disconnects live websockets, and clears each role-keyed permission-cache entry, in that order, because clearing the cache first would let an in-flight request on a still-valid session repoison it. A session epoch (`session-epoch-captured` lint rule) fences re-issued sessions.

`Role` holds `USER` and `ADMIN`.

## Secret scanning (gitleaks)

Two layers, same config (`.gitleaks.toml`, extends the full upstream gitleaks rule set):

- **CI**: `.github/workflows/security-secrets.yml`: pinned gitleaks 8.30.1 (version + SHA-256-verified binary), `gitleaks git . --config .gitleaks.toml --exit-code 1` over full commit history on every push/PR plus a weekly Monday scheduled run.
- **Local pre-push**: `scripts/ci/pre-push.sh` runs the same scan (native binary if installed, else the pinned `ghcr.io/gitleaks/gitleaks:v8.30.1` Docker image) as a hard gate before push, bypassable only via `PRE_PUSH_SKIP_GITLEAKS=1`.

The allowlist in `.gitleaks.toml` is narrow and each entry is explained inline: the lockfile (sha512 hashes trip the entropy heuristic), the generated TanStack route tree, the internal ESLint plugin's gitignored build output, and three **exact-value** exemptions for known-synthetic secrets (a CI-only `ENCRYPTION_KEY` used in `ci.yml`/`test/setup-env.ts`, and a synthetic test `CSRF_SECRET`). A real secret sharing the same shape as any of these would still fail the scan, since the match is on exact string value, not pattern.

gitleaks 8.x removed the old `detect` subcommand; the scans use `gitleaks git` (history) and `gitleaks dir`. The [CI/CD doc](/operations/ci-cd/) covers the workflow side. On a public repository, also enable GitHub secret scanning and push protection.

## Headers, CORS, and CSP

### API (`apps/api/src/main.ts`)

Uses `helmet()` with an **explicit** configuration (not defaults: default helmet allows `unsafe-inline` in `style-src` and omits Permissions-Policy/COEP entirely):

- CSP: `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `connect-src 'self'`, `font-src 'self' data:`, `object-src 'none'`, `frame-src 'self' blob:`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` in production only.
- `crossOriginEmbedderPolicy: false` (deliberately off, would break presigned-URL media loads), `crossOriginOpenerPolicy: same-origin`, `crossOriginResourcePolicy: same-site`, `referrerPolicy: strict-origin-when-cross-origin`, `xFrameOptions: deny`.
- `strictTransportSecurity`: 2-year max-age with `includeSubDomains`/`preload`, but **only in production** (disabled in dev, where there's no HTTPS to enforce).
- **Permissions-Policy** is set via a small explicit middleware (helmet doesn't ship one): denies accelerometer, autoplay, camera, display-capture, geolocation, gyroscope, magnetometer, microphone, payment, and USB; allows fullscreen for `self`.
- **CORS**: explicit origin allowlist, not a wildcard. Dev hard-codes `http://localhost:5173` plus the desktop app's origin constant. Production reads `CORS_ORIGINS` (comma-separated) if set, otherwise falls back to `APP_URL` plus the desktop origin. `credentials: true`, methods restricted to `GET/POST/PUT/DELETE/PATCH`.

### Web (`apps/web/nginx.conf`, served by the production Docker image)

Sets the same class of headers at the static edge, since the SPA is served separately from the API: HSTS (2-year, `includeSubDomains`, `preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site`, the same Permissions-Policy allowlist as the API, and its own CSP: `script-src 'self' https://challenges.cloudflare.com` (Turnstile), `connect-src 'self' https://challenges.cloudflare.com wss: https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io` (Sentry ingest hosts across regions, plus a generic `wss:` for the deployment's own websocket, the config comment notes this should be pinned to the actual deploy host once known), `frame-src https://challenges.cloudflare.com blob:` (Turnstile, plus `blob:` for sandboxed inline document previews). The theme-boot bootstrapper was moved to an external `/theme-boot.js` file specifically so `script-src` could drop `'unsafe-inline'` entirely.

Between them, both surfaces send CSP, HSTS, Permissions-Policy and the cross-origin policies.

## Upload validation

Uploads go through S3 **presigned POST** (`@aws-sdk/s3-presigned-post`, `createPresignedPost` in `apps/api/src/modules/storage/storage.service.ts`), not a plain presigned PUT URL. The POST policy includes `['content-length-range', 1, MAX_FILE_SIZE]`, so S3 itself rejects an oversized body, the size cap is enforced by the storage backend, not merely by a client-reported field the server trusts.

Avatar keys are validated by a single shared `avatarKeySchema` (regex-shaped, `packages/shared/src/schemas/storage.ts`) enforced at all three boundaries that touch a key: the upload-request schema, the `user.updateAvatar` tRPC input, and the storage delete path, so no boundary accepts an arbitrary string or a `..` path-traversal segment.

## Audit logging

`AuditService` (`apps/api/src/modules/audit/audit.service.ts`) is **actively called** from register, login, logout, password change/reset, email verification, user role changes, user deletion/purge, and storage file deletion (confirmed by call sites in `login.service.ts`, `register.service.ts`, `password-change.service.ts`, `password-reset.service.ts`, `email-verification.service.ts`, `user.service.ts`, `user-purge.service.ts`, `storage.router.ts`, `account-deletion.service.ts`, and the auth middleware).

Audit writes are **best-effort and swallow their own failures by design** (an audit-logging outage must not break the underlying business operation), which is why `audit_write_failures_total` exists as a Prometheus counter with a `critical`-severity alert rule (see the observability doc): it's the only signal that an audit row was silently dropped.

Retention: `AUDIT_LOG_RETENTION_DAYS` (default 365, floor 30 enforced by Joi) drives a scheduled sweep (`audit-retention.service.ts`), so the table does not grow without bound.

**Personal data in the trail.** Every request-bound audit row carries the client IP (`req.ip`, full and unmasked, real client address because of `trust proxy` above) and the raw `user-agent` header. Because tRPC procedures run inside the AsyncLocalStorage request scope, that includes the surfaces relying on the ALS fallback rather than passing the fields explicitly, such as `user.account.admin_deleted`, `data_export.downloaded`, `storage.file.deleted`, and the logout/email-verified rows. The processed-data inventory, the purpose and legal basis, and the retention review for those two columns specifically live in [audit-logging.md](/backend/audit-logging/#processed-personal-data). Two consequences worth knowing here: user deletion and purge do **not** reach `ipAddress`/`userAgent` (the `SetNull` FK nulls `userId` only, and the table has no update path at all), so the retention sweep is the sole erasure path for them; and one window serves two purposes pulling opposite ways, since the same 365 days is at the long end for a network identifier and far short of a multi-year statutory horizon for evidence rows.

## User deletion and other retention crons

Three scheduled sweeps exist under `@nestjs/schedule`'s cron convention, each with a Joi-validated, environment-tunable window and its own Prometheus counter:

| Cron                   | Service                                                                | Window env var                | Default / floor | Counter(s)                                              |
| ---------------------- | ---------------------------------------------------------------------- | ----------------------------- | --------------- | ------------------------------------------------------- |
| User purge             | `apps/api/src/modules/user/user-purge.service.ts`                      | `USER_PURGE_GRACE_DAYS`       | 30 / 0          | `user_purge_deleted_total`, `user_purge_failures_total` |
| Audit log retention    | `apps/api/src/modules/audit/audit-retention.service.ts`                | `AUDIT_LOG_RETENTION_DAYS`    | 365 / 30        | `audit_retention_deleted_total`                         |
| Notification retention | `apps/api/src/modules/notifications/notification-retention.service.ts` | `NOTIFICATION_RETENTION_DAYS` | 90 / 7          | `notification_retention_deleted_total`                  |

The user-deletion lifecycle itself (self-service password-confirmed delete, tenant-scoped admin delete) sets `deletedAt`, revokes sessions, disconnects live sockets, deletes the user's `avatars/<userId>/` S3 prefix, and clears the permission cache; the purge cron then hard-deletes rows (FK cascades cover tokens/permissions/notifications) once `USER_PURGE_GRACE_DAYS` has elapsed since soft-delete.

The admin path has a web surface: `MembersSection` on `/settings` lists the tenant's staff (`user.listUsers`) with role change, password reset, lockout unlock and delete (`user.adminDeleteUser`) dialogs beside each row.

## Runbooks and operating docs under `docs/`

- `docs/migration-playbook.md`: Prisma Migrate operating manual: expand-and-contract pattern, backfill conventions, rollback strategy, the `CREATE INDEX CONCURRENTLY` single-statement-per-migration trick (Prisma has no no-transaction directive), and common foot-guns (`NOT NULL` on a populated table, renaming columns, `db push` against a shared DB).
- `docs/runbooks/2fa-support-reset.md`: the operator procedure for resetting a user's second factor after identity verification.
- `docs/invariants/`: per-subsystem invariant manifests (sessions, tenancy, account lifecycle, audit, idempotency, queues) and what enforces each one.
- `docs/local-ci.md`: how to run the GitHub Actions workflow locally via `act`; see the [CI/CD doc](/operations/ci-cd/) for the summary.
- `docs/observability/README.md`: the optional self-hosted Grafana LGTM stack overlay; see the [observability doc](/operations/observability/).

## Known limitations

What the starter deliberately does not do yet. None of these is a bug in the controls above; each is a decision a product should make before it handles real customer data.

**Rate limiting and abuse**

- No per-tenant or per-route-family rate limits beyond the auth-specific ones.

**Authentication and sessions**

- No WebAuthn/passkeys (`SecondFactorType.WEBAUTHN` is reserved in the schema only).
- No absolute session lifetime separate from the sliding TTL: `MAX_SESSIONS = 3` caps concurrent sessions, not total lifetime.
- No fine-grained (per-permission, CASL-style) authorization beyond the role checks, and no field-level encryption of PII columns. TOTP secrets (`totpSecretEnc`) are already encrypted at rest.

**Uploads**

- No server-side magic-byte/file-type verification independent of the client-declared content type, and no antivirus hook. A common design is a two-phase quarantine flow: upload to a `quarantine/` prefix, a worker verifies with `file-type` plus ClamAV, then moves the object to a `clean/` prefix.
- Local `s3rver` compatibility with POST policies is not a proof for production: confirm the upload flow against your real S3-compatible backend.

**Audit trail**

- No tamper evidence (hash chain) and no admin UI to query the audit log.
- One retention window covers both the IP/user-agent columns and the rest of the row; see [audit-logging.md](/backend/audit-logging/#one-window-two-purposes-pulling-opposite-ways). Splitting it needs a policy decision on both horizons plus the first `AuditLog` update path.
- No customer-facing privacy notice or record of processing activities ships with the starter; the inventory in [audit-logging.md](/backend/audit-logging/#processed-personal-data) is the input for writing one.

**Accounts**

- No deletion-confirmation email is sent to the user.

**Desktop**

- Code signing is not set up. Electron auto-update `autoDownload`/`autoInstallOnAppQuit` stay disabled until an Apple Developer ID with notarization and a Windows Authenticode certificate are in place.

**Idempotency and tenancy**

- `IdempotencyMiddleware` is applied per mutation router (post-auth), not globally: a new mutation router that needs replay protection must apply it.
- `workspaceId` exists in `IRequestContext` but is never resolved by the auth middleware; a second scoping axis below the tenant is machinery only until a product wires it.
