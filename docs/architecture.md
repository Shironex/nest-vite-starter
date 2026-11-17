# Architecture

How a request moves through the starter, where state lives, and where to look for each concern.
For the folder layout see the README; for file naming rules inside the api see
[apps/api/src/modules/README.md](../apps/api/src/modules/README.md), and for the web see
[apps/web/src/features/README.md](../apps/web/src/features/README.md).

## Request flow

```
Browser (Vite SPA, TanStack Router and Query)
   |  tRPC over HTTP (superjson), cookie session, x-csrf-token header
   v
Express (apps/api/src/main.ts)
   |  helmet, cookie parser, body parsers, CSRF check, global throttler (Redis-backed)
   v
tRPC (nestjs-trpc)
   |  TrpcRequestContextMiddleware (request id, later the user id, in AsyncLocalStorage)
   |  AuthMiddleware (session cookie -> ctx.user), AdminMiddleware where needed
   v
Router      thin: one service call per procedure, input and output are Zod schemas
Service     the logic, and the audit write
Repository  Prisma queries only, soft-delete filtering
   v
PostgreSQL (Prisma 7, pg adapter)      Valkey (sessions, rate limits, queues)
```

- **Contract.** The Zod schemas in `packages/shared/src/schemas` are both the validation on the api
  and the types on the web. Every procedure declares an `output:` schema, which also strips
  anything internal before the response leaves the process. `nestjs-trpc generate` writes
  `apps/api/src/@generated/server.ts` from the routers, and the web client imports its types.
- **Errors.** Services throw from the taxonomy in `apps/api/src/common/errors`. The tRPC error
  formatter puts a stable `AppErrorCode` (from `@repo/shared/errors`) on `error.data.appCode`, and
  the web maps codes to copy in one table (`apps/web/src/lib/strings.ts`), never message text.
- **Guards.** A procedure is either behind `AuthMiddleware` or listed with a reason in
  `PUBLIC_PROCEDURES`. `pnpm lint:meta` fails on a procedure that is neither.
- **Public HTTP.** The few plain controllers (`/health`, `/api/csrf-token`) exist for what tRPC
  cannot serve. Everything else is tRPC.

## Auth and sessions

A session is a random 32-byte token in an HTTP-only cookie, stored hashed (SHA-256) as a blob in
Valkey. Authentication is one lookup: the middleware reads the cookie, loads the blob and puts the
user on the context. Each user has at most three live sessions (the oldest is evicted), a session
lives 24 hours, or 30 days with "remember me", and every credential change bumps a per-user
session epoch so a revocation beats a sign-in that was already in flight. The flows, 2FA and the
single place sessions are minted are in [auth.md](auth.md); what must stay true in that code is in
[invariants/](invariants/).

## Queue

Mail is the only background work. A service enqueues a job on the `email-delivery` BullMQ queue
(`modules/mail/mail.service.ts`), and a processor renders the React Email template and sends it
over SMTP. Workers are at-least-once, so the caller keys the job on something stable where a
duplicate matters; the conventions are in
[apps/api/src/common/queue/CONVENTIONS.md](../apps/api/src/common/queue/CONVENTIONS.md).

`QUEUE_WORKER` decides where the consumers run. `inline` (the default) runs them inside the api
process. `off` makes the api only enqueue, and a second container runs the same image with the
worker command (`node dist/src/worker`, or `pnpm --filter @repo/api start:worker`). Producers do
not change between the two. Periodic maintenance (token cleanup, audit retention, the account
purge) uses `@nestjs/schedule` `@Cron` instead of queues, and every sweep is idempotent because a
cron fires on every replica.

## Config

All api configuration is one Zod schema, `apps/api/src/config/env.ts`, validated at boot: a bad
key stops the process and lists every problem. In production it also refuses unsafe values
(localhost origins, an empty captcha secret, cleartext SMTP, `TRUST_PROXY=true`). `.env.example`
lists every key and a spec keeps the two in step. The web has no build-time environment: its
public settings come from `/config.js`, which the web container writes from its own environment at
start (`apps/web/public/config.js` holds the empty development defaults), so one image serves
every environment. Sentry stays off in both apps until a DSN is set.

## Where things live

| You want to...                       | Look in                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Add or change a procedure            | `apps/api/src/modules/<module>/*.router.ts`                                        |
| Change who may call it               | `modules/auth/middleware/`, `PUBLIC_PROCEDURES`                                    |
| Change a table                       | `packages/database/prisma/schema/`, then a migration                               |
| Add an audit action                  | `packages/shared/src/audit/index.ts`                                               |
| Add an error code                    | `packages/shared/src/errors`, and its copy in `apps/web/src/lib/strings.ts`        |
| Change mail copy or layout           | `packages/email/src/templates/`                                                    |
| Add a page                           | `apps/web/src/routes/` (thin) and `apps/web/src/features/`                         |
| Change colors or add a UI primitive  | `packages/ui` (`src/styles/globals.css`, `src/theme/`)                             |
| Change a limit, TTL or cron schedule | The constants file of that module, or `.env.example` for the deployment-level ones |
| Change the gate                      | `tools/`, `.github/workflows/ci.yml`                                               |
