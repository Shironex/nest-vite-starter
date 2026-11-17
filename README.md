# Nest Vite Starter

> [!WARNING]
> **The authentication is interim.** I will replace it with `@noctcore/auth` once that package
> reaches 1.0, and until then two known issues stay: the login answer for a locked account reveals
> that the account exists (an account existence oracle), and anyone who knows an email address can
> lock its owner out by failing logins on purpose (victim lockout). Do not run this auth in
> production before the swap. [docs/auth.md](docs/auth.md) lists the flows, the known issues and
> what changes at the swap.

A starter for single-user web apps: a NestJS 11 API and a Vite + React SPA in one pnpm monorepo,
typed from the database to the browser through tRPC. It ships accounts (sign up, verify email,
password reset, opt-in two-factor, sessions you can revoke), a USER/ADMIN role with a lean admin
area, an audit log, a mail queue, and a CI gate that already passes. There is no tenancy: one
account is one user. The code is written to be read and cut down, so each part has a short doc
saying where it lives and how to remove or extend it.

## Tech stack

| Layer        | Technology                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------- |
| **Frontend** | React 19, Vite 8, TanStack Router (file-based) and Query, Zustand, react-hook-form, Zod       |
| **UI**       | shadcn/ui (Radix, Tailwind CSS v4), two color themes with light and dark mode                 |
| **Backend**  | NestJS 11, tRPC through nestjs-trpc, Zod, Prisma 7 (pg adapter), BullMQ                       |
| **Data**     | PostgreSQL 18, Valkey 9 (Redis protocol: sessions, rate limits, queues)                       |
| **Auth**     | Redis-backed session cookies, Argon2id, CSRF double-submit, Cloudflare Turnstile, TOTP        |
| **Email**    | React Email templates, SMTP through nodemailer, Mailpit in development                        |
| **Ops**      | Sentry (off until a DSN is set), structured JSON logs, health endpoints, hardened Dockerfiles |
| **Tooling**  | pnpm 12, Turborepo, ESLint 10 (flat), Prettier, Husky, commitlint, Jest, Vitest, Playwright   |

## Quick start

You need Node 26 (the repo pins it in `.nvmrc`), pnpm 12 (`npm install --global pnpm@12.18.0`),
and Docker.

```bash
git clone https://github.com/Shironex/nest-vite-starter.git my-app   # or "Use this template" on GitHub
cd my-app
nvm use                          # Node 26 from .nvmrc
pnpm install
cp .env.example .env
```

Open `.env` and set `ENCRYPTION_KEY`. The api refuses to boot without a real one, and the
placeholder fails on purpose. Generate one with either of these:

```bash
openssl rand -base64 32
node -p "require('node:crypto').randomBytes(32).toString('base64')"
```

Then start the services, create the schema, add the admin and run both apps:

```bash
docker compose up -d             # Postgres, Valkey, Mailpit
pnpm --filter @repo/database db:generate
pnpm --filter @repo/database db:migrate:deploy
pnpm --filter @repo/database db:seed
pnpm dev
```

The web app is on <http://localhost:5173>, the api on <http://localhost:3000> and the Mailpit inbox
(every mail the app sends in development) on <http://localhost:8035>. Every key in `.env` is
validated at boot by `apps/api/src/config/env.ts`, which lists each bad key before it exits.

**First admin.** `db:seed` creates an admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`
(`admin@example.com` and a placeholder password by default; change them for anything but a local
machine) and, outside production, a `member@example.com` user with the same password. Signing up
always creates a plain `USER`. To make an existing account an admin, for example the first one
on a fresh deployment where the seed must not run, use the script. It revokes the account's
sessions, so the role applies at its next sign-in, and writes the same audit row as an in-app role
change:

```bash
pnpm --filter @repo/api user:promote someone@example.com
```

Stop the services with `docker compose down`, or `docker compose down -v` to wipe the data too.
The host ports are offset from the defaults (Postgres 5442, Valkey 6389, Mailpit SMTP 1035 and UI
8035, all on loopback) so the stack runs beside other projects' dev stacks. The compose project
name and container names are pinned, so only one copy of this stack can run on a machine at a
time.

## Layout

```
apps/
  api/              NestJS API: modules/ (auth, user, audit, mail, health, data-export),
                    common/ (redis, queue, security, errors, clock), config/ (zod env schema)
  web/              Vite SPA: features/ (auth, two-factor, settings, admin, dashboard, ...),
                    routes/ (TanStack file routes, thin), lib/, stores/
packages/
  database/         Prisma schema (one file per domain), migrations, client, seeds
  shared/           Zod schemas, constants, error codes, audit actions, logger (ESM and CJS)
  ui/               shadcn/ui components and the two themes
  email/            React Email templates
  eslint-config/    Shared ESLint flat configs (base, react, nestjs) and their tests
  tsconfig/         Shared TypeScript configs
tools/
  verify/           `pnpm verify`, the lane runner
  lint-meta/        `pnpm lint:meta`, the required auth, security and gate rules
docs/               Architecture, auth, deploy, recipes, invariants, decisions, runbooks
scripts/            Bundle budget, contrast check, image smoke test
```

How the pieces fit together is in [docs/architecture.md](docs/architecture.md).

## Scripts

| Script                                                     | What it does                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                                                 | Api and web in watch mode through Turborepo                                                            |
| `pnpm build`                                               | Build every package and app                                                                            |
| `pnpm verify`                                              | The local gate: format, lint, typecheck, test, build ([tools/README.md](tools/README.md))              |
| `pnpm lint:meta`                                           | The required auth, security and gate rules ([tools/lint-meta/RULES.md](tools/lint-meta/RULES.md))      |
| `pnpm lint`, `pnpm check-types`, `pnpm test`               | One lane each, through Turborepo                                                                       |
| `pnpm format`                                              | Prettier over the repo                                                                                 |
| `pnpm knip`                                                | Unused files, exports and dependencies                                                                 |
| `pnpm test:e2e`                                            | Playwright, against a running api and web (see AGENTS.md)                                              |
| `pnpm --filter @repo/database db:migrate -- --name <name>` | Create and apply a migration in development ([docs/migration-playbook.md](docs/migration-playbook.md)) |
| `pnpm --filter @repo/database db:seed:dev`                 | The seed plus sample data, refused outside a local database                                            |
| `pnpm --filter @repo/api user:promote <email>`             | Make an account an admin                                                                               |

## Add a module

There are no generators: a module is a few files in known places, and `data-export` is the
smallest complete example (an authenticated, owner-scoped, rate-limited read with an audited
access). Follow it for a new feature, say `notes`:

1. **Schema.** Add the Zod input and output schemas to `packages/shared/src/schemas/notes.ts`
   and re-export them from `schemas/index.ts` (`data-export.ts` shows the output side). The api
   and the web import the same schemas. If the module adds a new audit action, add it to
   `AUDIT_ACTIONS` in `packages/shared/src/audit/index.ts`.
2. **Database.** Add a model in `packages/database/prisma/schema/notes.prisma`, then run
   `pnpm --filter @repo/database db:migrate -- --name add_notes`. Read the SQL before you commit
   it. A table that hangs off `User` must also be handled by the account purge
   (`apps/api/src/modules/user/user-purge.service.ts`) and, if it holds user data, by the data
   export.
3. **API.** Create `apps/api/src/modules/notes/` with `notes.module.ts`, `notes.service.ts`,
   `notes.repository.ts` (Prisma queries only, extending `common/database/base.repository.ts`) and
   `notes.router.ts`, each with a colocated spec (lint requires one for every service). The router
   stays thin: `@Router({ alias: 'notes' })`, `@UseMiddlewares(AuthMiddleware)` on the class, one
   service call per procedure, an `output:` schema on every procedure, and the user id taken from
   `ctx.user.id`, never from input. Import `SessionModule` and `AuthMiddlewareModule` (as
   `data-export.module.ts` does) rather than `AuthModule`, then add the module to `AppModule`.
   Every `@Mutation()` must reach an audit write, outside any transaction.
4. **Types for the web.** `pnpm exec turbo run generate:trpc --filter=@repo/api` regenerates
   `apps/api/src/@generated/server.ts`, which gives the web client typed procedures (a build, a
   typecheck and a lint run it too). Never edit that file.
5. **Web.** Create `apps/web/src/features/notes/` with component folders (the sibling set in
   [apps/web/src/features/README.md](apps/web/src/features/README.md)), a `Notes.strings.ts` copy
   table and a `Notes.queries.ts`. Add a thin route under `apps/web/src/routes/_authenticated/notes/`,
   a nav entry in `features/layout/Layout.nav.ts`, and run `pnpm dev` once so the router
   regenerates `routeTree.gen.ts`.
6. **Prove it.** Run `pnpm verify`. For anything user-facing, add a Playwright spec under
   `apps/web/e2e/`.

The conventions behind the file names are in
[apps/api/src/modules/README.md](apps/api/src/modules/README.md). Features you may want next
(S3 uploads, websockets, OAuth, i18n and more) have short recipes in [docs/recipes](docs/recipes).

## The gate

`.github/workflows/ci.yml` is the source of truth, and `pnpm verify` runs its five lanes locally:

```bash
pnpm verify                      # format, lint (incl. lint:meta), typecheck, test, build
pnpm knip
pnpm size:check                  # initial-load byte budget of the web app
pnpm check:contrast              # WCAG ratios of the design tokens
pnpm audit --prod --audit-level=high
```

CI also runs the api integration specs against real Postgres and Valkey, the Playwright suite
against the built apps, and a smoke test of both Docker images. AGENTS.md has the commands for
running each of those locally. A pre-push hook runs the typecheck lane, the tests of affected
packages and gitleaks.

## Deploy

`docker-compose.prod.yml` is a self-host recipe: it builds both images, runs the migrations once,
then starts the api, the web, Postgres and Valkey, with the web on loopback ready for a reverse
proxy.

```bash
cp .env.prod.example .env        # fill it in; the comments say how to generate each secret
docker compose -f docker-compose.prod.yml up -d
```

Both images run as uid 10001 with a read-only root, and the web image reads its public settings
(`API_URL`, `TURNSTILE_SITE_KEY`, `SENTRY_DSN`, `APP_NAME`) when it starts, so one image serves
every environment. `scripts/image-smoke.sh --build` boots both images the way production runs
them. For Coolify, follow [docs/deploy-coolify.md](docs/deploy-coolify.md). Migrations are in
[docs/migration-playbook.md](docs/migration-playbook.md).

## Rename your fork

The display name lives in one place: `PRODUCT_NAME` in `packages/shared/src/constants/index.ts`
(`Nest Vite Starter`), with `PRODUCT_SLUG` (`nest-vite-starter`) beside it for identifiers such as
the data-export filename. The auth screens, sidebar, page titles, mail and the authenticator label
all read it, and `APP_NAME` in the environment overrides it at runtime. Change both constants,
then edit the few places that cannot read a constant:

| File                                                            | What to change                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web/index.html`                                           | The `<title>`                                                         |
| `package.json`                                                  | The root `name`                                                       |
| `LICENSE`                                                       | The copyright holder                                                  |
| `docker-compose.yml`                                            | `name:`, the `container_name` values, the volume names, `POSTGRES_DB` |
| `.env.example`                                                  | The database name in `DATABASE_URL`                                   |
| `docker-compose.prod.yml` and `.env.prod.example`               | `name:`, the default image names, `POSTGRES_DB`                       |
| `.github/workflows/ci.yml`, `scripts/image-smoke.sh`            | The image tags (`nest-vite-starter-api`, `nest-vite-starter-web`)     |
| `.github/ISSUE_TEMPLATE/config.yml`, `SECURITY.md`, `README.md` | The GitHub repository URL                                             |

The `@repo/*` package scope is internal and does not need to change. The two color themes are
named in `packages/ui/src/theme/constants.ts`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the commit style and the pull request flow, and
[SECURITY.md](SECURITY.md) for reporting a vulnerability.

## License

[MIT](LICENSE)
