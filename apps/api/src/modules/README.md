# Backend module structure

The vocabulary of `apps/api/src`: what a file suffix means, what a module may
import, and which of those rules lint actually enforces.

A new suffix is added here and only here.

## File suffixes

Standard NestJS, used the standard way:

| Suffix        | Holds                                                             | Example                       |
| ------------- | ----------------------------------------------------------------- | ----------------------------- |
| `.module`     | Nest wiring only                                                  | `user/user.module.ts`         |
| `.service`    | Domain logic and writes                                           | `user/user.service.ts`        |
| `.repository` | Prisma queries only; extends `common/database/base.repository.ts` | `user/user.repository.ts`     |
| `.router`     | tRPC procedures; the default entry point                          | `user/user.router.ts`         |
| `.controller` | Plain HTTP, for what tRPC cannot serve: bytes, redirects, feeds   | `health/health.controller.ts` |
| `.constants`  | One module's enums, unions and DI tokens                          | `auth/auth.constants.ts`      |

There is one more, unsuffixed by convention: `<module>.public.ts` names what
another module may import from this one by value.

Local vocabulary:

Sweeps have no suffix of their own: they are ordinary services named
`*-sweep.service.ts`. A suffix that appears exactly once (`.store`, `.rules`,
`.reader`, `.registry`, `.host`, `.extension`) is not a convention yet, so read
the docblock rather than generalizing from the name.

## Platform modules versus feature modules

**Platform** modules carry no domain meaning and are imported everywhere:
`logger` and `audit` (both `@Global()`, so no import line), and the
`auth` leaf modules - `session`, `auth-middleware`, `lockout`. `common/` adds `PrismaModule`, `RedisModule` and
`QueueModule`, also `@Global()`.

Everything else is a **feature**: `user`, `mail`, `data-export`, `health`, and
AuthModule proper.

`modules/auth` is both at once, and that is the load-bearing fact here. A router
needing `AuthMiddleware` imports `AuthMiddlewareModule`, never `AuthModule` -
AuthModule pulls in the login and 2FA flows and reopens a cycle. Every import
of the platform half looks like an edge to the feature half, which is why those
import lines carry a justification.

## Cross-module edges

The edge list itself is not kept here: a graph written in prose is wrong the day
after somebody adds an import. Read the imports under `src/modules/` for the live
one. Every pair on it is DI-safe and the runtime graph is acyclic.

For a new edge: import another module's **service** through its module. Never
import a foreign repository by value (a type-only import is fine: it binds
nothing at run time, so it cannot create a cycle), and never reach into a
foreign subdirectory. The one sanctioned reach is the platform half of `auth`
(`auth/middleware` and `auth/services`): those leaves exist so a router can guard
itself without importing AuthModule and reopening a cycle. No lint rule backs these
edge rules; they are held in review.

## What lint already guarantees

`packages/eslint-config/nestjs.js` runs these rules at `error` (production code
only, except `interface-prefix-i`, which also polices specs). By class:

- **Data access and transactions**: no raw SQL outside an allowlist, a
  soft-deletable model's reads filter `deletedAt`, every multi-row write sits
  inside a transaction, and inside one you use `tx` rather than the outer client.
  Writes to a fenced model are limited to the named service.
- **Audit**: an audit write never runs inside a transaction, so a rollback cannot
  erase it; every PII-shaped key in an audit payload is declared; and every
  `@Mutation()` entry point must reach an audit write
  (`mutation-entry-must-reach-audit`). None of them checks that the row
  describes the write it accompanies, so that is on review and the specs.
- **Errors, logging, promises, time, naming and tests**: throws stay inside the
  error taxonomy, log calls are structured and name no sensitive field, no
  floating or misused promise, no bare `Date.now()` in place of `common/clock`,
  every interface is `I`-prefixed, and every service and processor carries a
  colocated spec.

Nothing enforces the suffix vocabulary or the platform/feature split. Those are
convention, and only review catches a break.

## The innocence proofs

`grep -rn forwardRef apps/api/src` returns zero live uses. That is held up by the
leaf-module pattern and by prose: a dozen module files carry a comment on an
import naming the cycle it avoids. Those comments are the only record of why the
graph is acyclic. Read the ones already in a file before adding an import, and
write the same sentence when you add one.
