# Invariant manifests

One file per subsystem. Each says what must always be true there, where the doors are, what is most
likely to break it, and, per invariant, **what enforces it**. An invariant with no enforcer is not
left blank: it is recorded as `unenforced` with a pointer to its follow-up, because the gap is the
finding.

They exist because the most expensive bugs in this kind of codebase break invariants rather than
code paths, and in each case the invariant is real but written down nowhere a reviewer would look.
The classic shapes:

- a new session re-issue path forgets a field every other door stamps into the session blob;
- the tenant scope escapes through a transaction;
- "enforce it at every door" updates login and password reset, but not the OAuth resolver, so a
  removed member signs back in with Google.

## Format

Frontmatter carries the two machine-read fields:

```yaml
---
subsystem: Tenant scope
globs:
  - apps/api/src/common/database/tenant-scope.extension.ts
  - apps/api/src/modules/**/*.repository.ts
---
```

The body is prose except for one convention: every invariant is a `###` heading, and the first line
under it is

```markdown
**Enforced by:** `lint-meta:tenant-model-registry-parity`, `eslint:noctcore-prisma/tenant-scoped-tables-require-where`
```

Citations are one of:

| Citation               | Means                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `` `lint-meta:<id>` `` | a rule registered in `tools/lint-meta/registry.ts`                                  |
| `` `eslint:<id>` ``    | a rule configured in `packages/eslint-config`                                       |
| `` `file:<path>` ``    | a spec, fence or registry that exists in the tree                                   |
| `` `unenforced` ``     | nothing mechanical checks it; the same line must carry `#<issue>` or a `docs/` link |

## The rot check

`pnpm lint:meta` runs `invariant-manifest-fresh`, which fails when a `globs:` entry matches no file,
an invariant has no `**Enforced by:**` line, a cited lint-meta rule is not registered, a cited
ESLint rule is not configured, a cited path is gone, or an `unenforced` invariant has no follow-up
(an issue number or a `docs/` path).

It cannot check that an invariant is TRUE. That is review's job, and the manifest is what tells
review where to look.

## Using them in a review

Load only the manifests whose `globs:` match the diff. A reviewer (human or an automated review
agent) reads the invariants, the entry points and the checklist for those subsystems, and reports a
finding only when it is reproduced or traced to a concrete `file:line`.

## Coverage

The subsystems covered, written from the code rather than from memory:

| Manifest               | Covers                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| `tenancy.md`           | the Organization/Workspace boundary and the Prisma scope extension |
| `sessions.md`          | session mint, epoch, landing and procedure guards                  |
| `account-lifecycle.md` | deleted, locked and removed accounts at every authentication door  |
| `audit.md`             | the audit trail and what is actually enforced about it             |
| `queues.md`            | BullMQ registration, job context and processors                    |

Subsystems deliberately NOT covered yet, because nobody has read them closely enough to write a
manifest that is a record rather than a guess: mail and notification delivery, storage and the S3
ticket path, and the web i18n and routing conventions.

## Unenforced invariants

Invariants cited as `unenforced` point here. Each is a known gap, not an oversight: the invariant
holds in the code today, but nothing mechanical stops a future change from breaking it. Closing one
means adding a lint-meta rule, an ESLint rule or a spec and replacing the `unenforced` citation.

- `sessions.md`: revocation reaches live sockets, not only future requests.
- `queues.md`, `audit.md`, `account-lifecycle.md`, `tenancy.md`: see the
  invariant marked `unenforced` in each manifest.
