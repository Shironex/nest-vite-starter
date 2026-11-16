---
title: 'Module Map'
description: 'Generated map of apps/api/src/modules and apps/web/src/features: one purpose line per directory, file counts, fan-in, fan-out, and every cross-directory import with a file:line witness.'
sidebar:
  order: 7
---

<!-- GENERATED FILE. Run `pnpm generate:arch-map` to refresh it; hand edits are overwritten. -->

Every number and every edge below is read off the tree by `tools/arch/build-map.ts`. The only
hand-written column is **Purpose**, which lives in `tools/arch/registry.ts`: a file count is
derivable, what a module is FOR is not. A directory with no purpose line fails the
`arch-map-fresh` lint-meta rule, and so does a stale copy of this page.

The prose companions are still the place for the reasoning: `apps/api/src/modules/README.md` for
the backend vocabulary and why the module boundaries fall where they do, and
`apps/web/src/features/README.md` for the component folder convention.

## `apps/api/src/modules`

| Directory       | Purpose                                                                                                                    | Files | Fan-out | Fan-in |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ------ |
| `audit`         | Append-only record of who changed what, written by every mutating service.                                                 | 7     | 3       | 6      |
| `auth`          | May you enter: credentials, sessions, 2FA, OAuth, invites and the guards.                                                  | 61    | 6       | 8      |
| `data-export`   | GDPR account export: gathers everything the api holds about one account into an archive.                                   | 3     | 3       | 0      |
| `events`        | Socket.io fan-out and session revocation broadcasts.                                                                       | 4     | 3       | 3      |
| `health`        | Liveness and readiness probes for the container platform.                                                                  | 5     | 0       | 0      |
| `help`          | Server half of the in-app guided tours: which tours a user has already seen.                                               | 4     | 1       | 0      |
| `logger`        | Structured logging and request-scoped log context.                                                                         | 3     | 0       | 4      |
| `mail`          | Transactional email: templates, the queue and the provider adapter.                                                        | 12    | 1       | 1      |
| `metrics`       | Prometheus counters and histograms, plus the scrape endpoint.                                                              | 7     | 1       | 5      |
| `notifications` | In-app notification rows, their read state and their retention sweep.                                                      | 13    | 4       | 3      |
| `storage`       | S3 object storage: presigned uploads, download tickets and avatar bytes.                                                   | 4     | 3       | 1      |
| `user`          | The account lifecycle: profile, membership, deletion and the purge sweep.                                                  | 8     | 6       | 3      |
| `workspace`     | The workspaces of an organization (the Organization -> Workspace tenancy tier): the Workspace gate, list, create and edit. | 5     | 3       | 0      |

### Cross-directory edges in `apps/api/src/modules`

`Imports` counts every import line that creates the edge; `First witness` is the lowest one, so
an edge you did not expect can be opened rather than argued about.

| From            | To              | Imports | First witness                                                                                |
| --------------- | --------------- | ------- | -------------------------------------------------------------------------------------------- |
| `audit`         | `auth`          | 3       | `apps/api/src/modules/audit/audit.module.ts:2`                                               |
| `audit`         | `logger`        | 1       | `apps/api/src/modules/audit/audit.service.ts:6`                                              |
| `audit`         | `metrics`       | 2       | `apps/api/src/modules/audit/audit-retention.service.ts:12`                                   |
| `auth`          | `audit`         | 16      | `apps/api/src/modules/auth/oauth/oauth-account.service.ts:8`                                 |
| `auth`          | `events`        | 13      | `apps/api/src/modules/auth/auth.module.ts:4`                                                 |
| `auth`          | `logger`        | 2       | `apps/api/src/modules/auth/middleware/auth.middleware.ts:11`                                 |
| `auth`          | `mail`          | 12      | `apps/api/src/modules/auth/auth.module.ts:3`                                                 |
| `auth`          | `metrics`       | 9       | `apps/api/src/modules/auth/oauth/oauth.controller.ts:7`                                      |
| `auth`          | `user`          | 15      | `apps/api/src/modules/auth/auth.module.ts:2`                                                 |
| `data-export`   | `audit`         | 1       | `apps/api/src/modules/data-export/data-export.service.ts:6`                                  |
| `data-export`   | `auth`          | 3       | `apps/api/src/modules/data-export/data-export.module.ts:4`                                   |
| `data-export`   | `user`          | 2       | `apps/api/src/modules/data-export/data-export.module.ts:6`                                   |
| `events`        | `auth`          | 6       | `apps/api/src/modules/events/events.gateway.ts:21`                                           |
| `events`        | `logger`        | 1       | `apps/api/src/modules/events/events.gateway.ts:17`                                           |
| `events`        | `notifications` | 2       | `apps/api/src/modules/events/events.gateway.ts:24`                                           |
| `help`          | `auth`          | 3       | `apps/api/src/modules/help/help.module.ts:2`                                                 |
| `mail`          | `metrics`       | 2       | `apps/api/src/modules/mail/email-delivery/email-delivery.processor.ts:7`                     |
| `metrics`       | `logger`        | 1       | `apps/api/src/modules/metrics/auth-outcome.recorder.ts:1`                                    |
| `notifications` | `audit`         | 1       | `apps/api/src/modules/notifications/notification-preferences.service.ts:18`                  |
| `notifications` | `auth`          | 3       | `apps/api/src/modules/notifications/notifications.module.ts:2`                               |
| `notifications` | `events`        | 2       | `apps/api/src/modules/notifications/notification-dispatch/notification-dispatch.module.ts:2` |
| `notifications` | `metrics`       | 1       | `apps/api/src/modules/notifications/notification-retention.service.ts:11`                    |
| `storage`       | `audit`         | 1       | `apps/api/src/modules/storage/storage.router.ts:11`                                          |
| `storage`       | `auth`          | 3       | `apps/api/src/modules/storage/storage.module.ts:4`                                           |
| `storage`       | `user`          | 1       | `apps/api/src/modules/storage/storage.module.ts:6`                                           |
| `user`          | `audit`         | 4       | `apps/api/src/modules/user/expired-invite-sweep.service.ts:12`                               |
| `user`          | `auth`          | 6       | `apps/api/src/modules/user/user.module.ts:7`                                                 |
| `user`          | `events`        | 2       | `apps/api/src/modules/user/user.module.ts:11`                                                |
| `user`          | `metrics`       | 3       | `apps/api/src/modules/user/expired-invite-sweep.service.ts:11`                               |
| `user`          | `notifications` | 2       | `apps/api/src/modules/user/user.module.ts:12`                                                |
| `user`          | `storage`       | 5       | `apps/api/src/modules/user/avatar-owner.module.ts:2`                                         |
| `workspace`     | `audit`         | 1       | `apps/api/src/modules/workspace/workspace.service.ts:12`                                     |
| `workspace`     | `auth`          | 4       | `apps/api/src/modules/workspace/workspace.module.ts:2`                                       |
| `workspace`     | `notifications` | 2       | `apps/api/src/modules/workspace/workspace.module.ts:5`                                       |

## `apps/web/src/features`

| Directory       | Purpose                                                                                                          | Files | Fan-out | Fan-in |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ----- | ------- | ------ |
| `admin`         | Organization member management: roles, lockout, deletion and the employer invite.                                | 40    | 1       | 0      |
| `audit`         | Audit log browser with filters and per-entry detail.                                                             | 21    | 1       | 0      |
| `auth`          | Sign in, register, verify, reset password and the Turnstile challenge.                                           | 80    | 1       | 0      |
| `dashboard`     | The authenticated landing page and its widgets.                                                                  | 11    | 0       | 0      |
| `desktop`       | Electron-only chrome: frameless title bar and the update banner.                                                 | 8     | 0       | 0      |
| `help`          | Replayable per-screen guided tours: registry, engine and launcher.                                               | 15    | 0       | 0      |
| `landing`       | The public marketing page.                                                                                       | 37    | 0       | 0      |
| `layout`        | Authenticated app shell: sidebar, nav rail, organization identity and connection indicator.                      | 22    | 0       | 0      |
| `notifications` | Header bell, unread badge and per-item read state.                                                               | 8     | 0       | 0      |
| `settings`      | Profile, password, sessions, notification prefs, GDPR export, theme and updates.                                 | 38    | 1       | 0      |
| `shared`        | Components used by more than one domain.                                                                         | 21    | 0       | 5      |
| `two-factor`    | TOTP enrollment, the challenge screen and recovery codes.                                                        | 38    | 0       | 0      |
| `workspace`     | Platform Organization -> Workspace tier: the Workspaces screen, the Workspace picker and the create/edit dialog. | 15    | 1       | 0      |

### Cross-directory edges in `apps/web/src/features`

`Imports` counts every import line that creates the edge; `First witness` is the lowest one, so
an edge you did not expect can be opened rather than argued about.

| From        | To       | Imports | First witness                                                                           |
| ----------- | -------- | ------- | --------------------------------------------------------------------------------------- |
| `admin`     | `shared` | 1       | `apps/web/src/features/admin/components/MembersSection/MembersSection.hooks.ts:6`       |
| `audit`     | `shared` | 3       | `apps/web/src/features/audit/components/AuditLogFilters/AuditLogFilters.tsx:3`          |
| `auth`      | `shared` | 3       | `apps/web/src/features/auth/components/RegisterForm/RegisterForm.tsx:3`                 |
| `settings`  | `shared` | 2       | `apps/web/src/features/settings/components/PasswordSection/PasswordSection.tsx:7`       |
| `workspace` | `shared` | 1       | `apps/web/src/features/workspace/components/WorkspaceListPage/WorkspaceListPage.tsx:11` |
