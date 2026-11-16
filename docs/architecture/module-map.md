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

| Directory     | Purpose                                                                                                                    | Files | Fan-out | Fan-in |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ------ |
| `audit`       | Append-only record of who changed what, written by every mutating service.                                                 | 7     | 2       | 4      |
| `auth`        | May you enter: credentials, sessions, 2FA and the guards.                                                                  | 40    | 4       | 4      |
| `data-export` | GDPR account export: gathers everything the api holds about one account into an archive.                                   | 3     | 3       | 0      |
| `health`      | Liveness and readiness probes for the container platform.                                                                  | 5     | 0       | 0      |
| `logger`      | Structured logging and request-scoped log context.                                                                         | 3     | 0       | 2      |
| `mail`        | Transactional email: templates, the queue and the provider adapter.                                                        | 12    | 0       | 1      |
| `user`        | The account lifecycle: profile, membership, deletion and the purge sweep.                                                  | 5     | 2       | 2      |
| `workspace`   | The workspaces of an organization (the Organization -> Workspace tenancy tier): the Workspace gate, list, create and edit. | 5     | 2       | 0      |

### Cross-directory edges in `apps/api/src/modules`

`Imports` counts every import line that creates the edge; `First witness` is the lowest one, so
an edge you did not expect can be opened rather than argued about.

| From          | To       | Imports | First witness                                                       |
| ------------- | -------- | ------- | ------------------------------------------------------------------- |
| `audit`       | `auth`   | 3       | `apps/api/src/modules/audit/audit.module.ts:2`                      |
| `audit`       | `logger` | 1       | `apps/api/src/modules/audit/audit.service.ts:5`                     |
| `auth`        | `audit`  | 13      | `apps/api/src/modules/auth/services/account-deletion.service.ts:10` |
| `auth`        | `logger` | 2       | `apps/api/src/modules/auth/auth-outcome.recorder.ts:1`              |
| `auth`        | `mail`   | 9       | `apps/api/src/modules/auth/auth.module.ts:3`                        |
| `auth`        | `user`   | 11      | `apps/api/src/modules/auth/auth.module.ts:2`                        |
| `data-export` | `audit`  | 1       | `apps/api/src/modules/data-export/data-export.service.ts:6`         |
| `data-export` | `auth`   | 3       | `apps/api/src/modules/data-export/data-export.module.ts:4`          |
| `data-export` | `user`   | 2       | `apps/api/src/modules/data-export/data-export.module.ts:6`          |
| `user`        | `audit`  | 3       | `apps/api/src/modules/user/user-purge.service.ts:8`                 |
| `user`        | `auth`   | 7       | `apps/api/src/modules/user/user.module.ts:6`                        |
| `workspace`   | `audit`  | 1       | `apps/api/src/modules/workspace/workspace.service.ts:12`            |
| `workspace`   | `auth`   | 4       | `apps/api/src/modules/workspace/workspace.module.ts:2`              |

## `apps/web/src/features`

| Directory    | Purpose                                                                                                          | Files | Fan-out | Fan-in |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ----- | ------- | ------ |
| `admin`      | Organization member management: roles, lockout, two-factor reset and deletion.                                   | 29    | 1       | 0      |
| `audit`      | Audit log browser with filters and per-entry detail.                                                             | 21    | 1       | 0      |
| `auth`       | Sign in, register, verify, reset password and the Turnstile challenge.                                           | 63    | 1       | 0      |
| `dashboard`  | The authenticated landing page and its widgets.                                                                  | 6     | 0       | 0      |
| `landing`    | The public marketing page.                                                                                       | 37    | 0       | 0      |
| `layout`     | Authenticated app shell: sidebar, top bar, organization identity and user menu.                                  | 19    | 0       | 0      |
| `settings`   | Profile, password, sessions, GDPR export, theme and account deletion.                                            | 31    | 1       | 0      |
| `shared`     | Components used by more than one domain.                                                                         | 17    | 0       | 5      |
| `two-factor` | TOTP enrollment, the challenge screen and recovery codes.                                                        | 27    | 0       | 0      |
| `workspace`  | Platform Organization -> Workspace tier: the Workspaces screen, the Workspace picker and the create/edit dialog. | 15    | 1       | 0      |

### Cross-directory edges in `apps/web/src/features`

`Imports` counts every import line that creates the edge; `First witness` is the lowest one, so
an edge you did not expect can be opened rather than argued about.

| From        | To       | Imports | First witness                                                                           |
| ----------- | -------- | ------- | --------------------------------------------------------------------------------------- |
| `admin`     | `shared` | 1       | `apps/web/src/features/admin/components/MembersSection/MembersSection.hooks.ts:4`       |
| `audit`     | `shared` | 3       | `apps/web/src/features/audit/components/AuditLogFilters/AuditLogFilters.tsx:3`          |
| `auth`      | `shared` | 2       | `apps/web/src/features/auth/components/RegisterForm/RegisterForm.tsx:2`                 |
| `settings`  | `shared` | 1       | `apps/web/src/features/settings/components/PasswordSection/PasswordSection.tsx:6`       |
| `workspace` | `shared` | 1       | `apps/web/src/features/workspace/components/WorkspaceListPage/WorkspaceListPage.tsx:11` |
