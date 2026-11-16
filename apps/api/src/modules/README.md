# Backend module structure

The vocabulary of `apps/api/src`: what a file suffix means, what a module may
import, and which of those rules lint actually enforces.

This is the reference half. The narrative half, for somebody orienting rather
than editing, is the API Module Structure page in `apps/docs`
(`apps/docs/src/content/docs/architecture/api-module-structure.md`): the same
boundaries as a diagram, why they fall where they do, and how a request travels
through them. It deliberately does not restate the glossary below, so a new
suffix is added here and only here.

## File suffixes

Standard NestJS, used the standard way:

| Suffix        | Holds                                                             | Example                          |
| ------------- | ----------------------------------------------------------------- | -------------------------------- |
| `.module`     | Nest wiring only                                                  | `user/user.module.ts`            |
| `.service`    | Domain logic and writes                                           | `user/user.service.ts`           |
| `.repository` | Prisma queries only; extends `common/database/base.repository.ts` | `user/user.repository.ts`        |
| `.router`     | tRPC procedures; the default entry point                          | `user/user.router.ts`            |
| `.controller` | Plain HTTP, for what tRPC cannot serve: bytes, redirects, feeds   | `auth/oauth/oauth.controller.ts` |
| `.constants`  | One module's enums, unions and DI tokens                          | `auth/auth.constants.ts`         |

There is one more, unsuffixed by convention: `<module>.public.ts` names what
another module may import from this one by value.

Local vocabulary:

- **`.port`** - an abstract class used as a DI token: the sanctioned seam
  between two clusters, bound `useExisting` so there is one instance and one
  writer. `storage/avatar-owner.port.ts`

Sweeps have no suffix of their own: they are ordinary services named
`*-sweep.service.ts`. A suffix that appears exactly once (`.store`, `.rules`,
`.reader`, `.registry`, `.host`, `.extension`) is not a convention yet, so read
the docblock rather than generalizing from the name.

## Platform modules versus feature modules

**Platform** modules carry no domain meaning and are imported everywhere:
`logger` and `audit` (both `@Global()`, so no import line), `metrics` (de facto
global through the prom-client singletons in `metrics.registry.ts`), and the
`auth` leaf modules - `session`, `auth-middleware`, `lockout`,
`two-factor-enrollment`. `common/` adds `PrismaModule`, `RedisModule` and
`QueueModule`, also `@Global()`.

`workspace` is platform too, imported where it is needed rather than global:
the workspaces of an organization, the second tier of the Organization -> Workspace tenancy
boundary. Every tenant-owned record below the organization hangs off a Workspace, so the
module carries no domain meaning. It exports only `WorkspaceLookupService`, the read
half (the tenant gate for a caller-supplied `workspaceId`, and the tenant's Workspace
list); creating or editing a Workspace stays behind its own `workspaces` router. It
imports no feature module.

Everything else is a **feature**: `user`, `storage`, `notifications`, `events`,
`mail`, `data-export`, `health`, `help`, and AuthModule proper. `workspace` must not
import from any of them.

`modules/auth` is both at once, and that is the load-bearing fact here. A router
needing `AuthMiddleware` imports `AuthMiddlewareModule`, never `AuthModule` -
AuthModule pulls in login, 2FA and oauth flows and reopens a cycle. Every import
of the platform half looks like an edge to the feature half, which is why those
import lines carry a justification.

## Cross-module edges

The edge list itself is **generated**, not kept here: a graph written in prose is
checked by nothing and is wrong the day after somebody adds an import. The live
one, with fan-in, fan-out and a `file:line` witness per edge, is the Module Map
page in `apps/docs`
(`apps/docs/src/content/docs/architecture/module-map.md`). Regenerate it with
`pnpm generate:arch-map`; `lint:meta` fails when it is stale or when a new module
has no purpose line in `tools/arch/registry.ts`.

What that page cannot say is why an edge is allowed, so the rest of this section
stays here. Every pair on it is DI-safe and the runtime graph is acyclic.

For a new edge: import another module's **service** through its module, or go
through a `.port`. Never import a foreign repository, and never reach into a
foreign subdirectory. Both are enforced (`api-module-edges`, below).

There is one sanctioned way to reach into another module's subdirectory, and it
is the platform half of `auth`: `auth/middleware` and `auth/services`. Those
leaves exist so a router can guard itself without importing AuthModule and
reopening a cycle, so every import of them necessarily names a subdirectory. The
rule holds them as named entry points, each with its reason.

## What lint already guarantees

`packages/eslint-config/nestjs.js` runs twenty-three rules at `error`, production
code only (`interface-prefix-i` is the one that also polices specs). By class:

- **Tenancy and transactions (8)** - no unscoped Prisma client and no raw SQL
  outside an allowlist, a tenant-scoped model carries `tenantId` in both `where`
  and `data`, no foreign tenant id in a `where`, a soft-deletable model's reads
  filter `deletedAt`, every multi-row write inside a transaction, and inside one
  use `tx` rather than the outer client.

- **Single-writer fences** - a fenced column is written by exactly one named
  service.
- **Queue (3)** - processors extend `TracedWorkerHost`, `add` wraps job context,
  job names come from constants.
- **Audit (3)** - an audit write never runs inside a transaction, so a rollback
  cannot erase it; every PII-shaped key in an audit payload is declared; and
  every `@Mutation()` entry point must reach an audit write
  (`mutation-entry-must-reach-audit`). None of them checks that the row
  describes the write it accompanies, so that is on review and the specs.
- **Errors, logging, promises, time, naming and tests (8)** - throws stay inside
  the error taxonomy, log calls are structured and name no sensitive field, no
  floating or misused promise, no bare `Date.now()` in place of `common/clock`,
  every interface is `I`-prefixed, and every service and processor carries a
  colocated spec.

`pnpm lint:meta` adds one more, `api-module-edges`
(`tools/lint-meta/rules/source-text/api-module-edges.ts`), which holds the three
edge rules above as data and resolves every relative import under
`src/modules/` (non-spec):

- the **direction table**: which module may not import which. Zero breaks when
  it landed, so it runs with no allowance at all.
- a **value import of a foreign `*.repository`**. A type-only import is allowed:
  it binds nothing at run time, so it cannot create the cycle the rule is about.
- a **reach into a foreign subdirectory**, other than the sanctioned platform
  entry points above.

Its `EDGE_EXCEPTIONS` table carries the edges that already existed, each with a
written reason and a destination (the `storage` imports of `UserRepository`,
which want a port, because storage needs behavior rather than a value). An
entry naming an import that no longer exists is itself reported, so the table
shrinks as the debt is paid instead of quietly widening the rule.

Nothing enforces the suffix vocabulary or the platform/feature split. Those are
still convention, and only review catches a break.

## The innocence proofs

`grep -rn forwardRef apps/api/src` returns zero live uses. That is held up by the
leaf-module pattern and by prose: a dozen module files carry a comment on an
import naming the cycle it avoids. Those comments are the only record of why the
graph is acyclic. Read the ones already in a file before adding an import, and
write the same sentence when you add one.
