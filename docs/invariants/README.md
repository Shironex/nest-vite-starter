# Invariant manifests

One file per subsystem. Each says what must always be true there, where the doors are, what is most
likely to break it, and, per invariant, **what enforces it**. An invariant with no enforcer is not
left blank: it is recorded as `unenforced` with a pointer to its follow-up, because the gap is the
finding.

They exist because the most expensive bugs in this kind of codebase break invariants rather than
code paths, and in each case the invariant is real but written down nowhere a reviewer would look.
The classic shapes:

- a new session re-issue path forgets a field every other door stamps into the session blob;
- "enforce it at every door" updates login, but not password reset, so a disabled account signs
  back in through the reset link.

## Format

Frontmatter carries the two machine-read fields:

```yaml
---
subsystem: Soft delete
globs:
  - apps/api/src/common/database/base.repository.ts
  - apps/api/src/modules/**/*.repository.ts
---
```

The body is prose except for one convention: every invariant is a `###` heading, and the first line
under it is

```markdown
**Enforced by:** `lint-meta:required-rules-at-error`, `eslint:noctcore-prisma/soft-deletable-tables-require-deleted-at`
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
| `sessions.md`          | session mint, epoch, landing and procedure guards                  |
| `account-lifecycle.md` | deleted, locked and disabled accounts at every authentication door |
| `audit.md`             | the audit trail and what is actually enforced about it             |
| `queues.md`            | BullMQ registration, job context and processors                    |

Subsystems deliberately NOT covered yet, because nobody has read them closely enough to write a
manifest that is a record rather than a guess: mail delivery and the web routing
conventions.

## Unenforced invariants

Invariants cited as `unenforced` point here. Each is a known gap, not an oversight: the invariant
holds in the code today, but nothing mechanical stops a future change from breaking it. Closing one
means adding a lint-meta rule, an ESLint rule or a spec and replacing the `unenforced` citation.

- `queues.md`, `audit.md`, `account-lifecycle.md`: see the
  invariant marked `unenforced` in each manifest.
