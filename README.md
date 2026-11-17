# SaaS Starter

> [!WARNING]
> **Work in progress.** This repository is being trimmed from a multi-tenant SaaS starter into a
> simple single-user NestJS + Vite starter, one pull request per phase. Until that work lands, parts
> of this README describe the old tree.
>
> **The authentication is interim.** It will be replaced by `@noctcore/auth` once that package
> reaches 1.0. Two known issues stay until then: the login answer for a locked account reveals that
> the account exists (an account existence oracle), and anyone who knows an email address can lock
> its owner out by failing logins on purpose (victim lockout). Do not run this auth in production
> before the swap.

`nest-vite-starter` is an open-source starter for single-user web apps, built as a monorepo
with **Vite + React** and **NestJS 11**: type-safe from database to browser, with authentication,
auditing, background jobs, observability and a CI gate already wired.

The display name ("SaaS Starter") lives in one place: `PRODUCT_NAME` in `@repo/shared/constants`.
Rebranding is a one-line change there plus the handful of surfaces that cannot read a constant
(`apps/web/index.html`, the compose files).

## Tech Stack

| Layer        | Technology                                                                               |
| ------------ | ---------------------------------------------------------------------------------------- |
| **Frontend** | React 19, Vite 8, TanStack Router (file-based), TanStack Query, Zustand                  |
| **Backend**  | NestJS 11, tRPC (nestjs-trpc), Prisma 7, BullMQ                                          |
| **Database** | PostgreSQL 17, Redis 7                                                                   |
| **Auth**     | Session-based (Redis-backed), Argon2id hashing, CSRF double-submit, Cloudflare Turnstile |
| **UI**       | shadcn/ui (Radix + Tailwind CSS v4), 2 color themes                                      |
| **Email**    | React Email templates, Mailpit for dev                                                   |
| **Tooling**  | pnpm workspaces, Turborepo, ESLint 10 (flat config), Prettier, Husky, Commitlint         |

## Features

- **End-to-end type safety**: Zod schemas shared between frontend and backend via tRPC
- **Session-based auth** with progressive account lockout, email verification, password reset
- **Repository pattern**: clean separation of business logic and data access
- **Structured logging** with JSON output (production) and correlation IDs via AsyncLocalStorage
- **Audit trail**: AuditLog service for tracking user actions
- **Rate limiting**: global ThrottlerGuard + Helmet security headers
- **Background jobs**: BullMQ queue infrastructure ready for use
- **UI components**: the core shadcn/ui set plus form, date field, data table, pagination, sidebar and toasts
- **2 color themes** (indigo accent and neutral slate) with light/dark mode (OKLCH color space)
- **Error boundaries**: React ErrorBoundary wrapping route layouts
- **Docker-ready**: multi-stage Dockerfiles for API and Web, production compose file

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22.22.3
- [pnpm](https://pnpm.io/) 10
- [Docker](https://www.docker.com/) (for dev infrastructure)

## Quick Start

```bash
# Clone and install
git clone https://github.com/Shironex/nest-vite-starter.git
cd nest-vite-starter
pnpm install

# Start infrastructure (Postgres, Redis, Mailpit)
docker compose up -d

# Set up environment (one file at the repo root feeds every app)
cp .env.example .env

# Generate Prisma client and apply migrations
pnpm --filter @repo/database db:generate
pnpm --filter @repo/database db:migrate:deploy

# Seed the database
pnpm --filter @repo/database db:seed

# Start dev servers
pnpm dev
```

Signup always creates a plain `USER`. To make an existing account an admin (the first admin
included), run this from the repo root; it revokes the account's sessions so the role applies at
its next sign-in, and writes the same audit row as an in-app role change:

```bash
pnpm --filter @repo/api user:promote someone@example.com
```

The API runs on `http://localhost:3000` and the web app on `http://localhost:5173`.

## Project Structure

```
apps/
  api/              NestJS 11 API with tRPC
  web/              Vite + React SPA

packages/
  database/         Prisma 7 schema, client, migrations, seed
  shared/           Shared types, schemas, constants, logger (dual ESM/CJS)
  ui/               shadcn/ui components with 2 color themes
  email/            React Email templates
  eslint-config/    Shared ESLint flat configs (base, react, nestjs)
  tsconfig/         Shared TypeScript configs

tools/
  verify/           `pnpm verify`, the lane runner (format, lint, typecheck, test, build)
  lint-meta/        `pnpm lint:meta`, the required auth, security and gate rules
```

## Scripts

| Script             | Description                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`         | Start API + Web dev servers via Turborepo                                                       |
| `pnpm build`       | Build all packages and apps                                                                     |
| `pnpm verify`      | The local gate: format, lint, typecheck, test, build lanes ([tools/README.md](tools/README.md)) |
| `pnpm lint`        | Lint all packages and apps                                                                      |
| `pnpm lint:meta`   | The required repo rules ([tools/lint-meta/RULES.md](tools/lint-meta/RULES.md))                  |
| `pnpm check-types` | Type-check all packages and apps                                                                |
| `pnpm test`        | Run all tests                                                                                   |
| `pnpm format`      | Format all files with Prettier                                                                  |

## Docker Services

| Service       | Port                   | Purpose                 |
| ------------- | ---------------------- | ----------------------- |
| PostgreSQL 17 | 5432                   | Primary database        |
| Redis 7       | 6379                   | Sessions, cache, BullMQ |
| Mailpit       | 8025 (UI), 1025 (SMTP) | Email testing           |

```bash
docker compose up -d      # Start services
docker compose down        # Stop services
docker compose down -v     # Stop and wipe data
```

Upgrading an older checkout: the migrations were squashed into one (`0001_init` replaced `0_init`)
and the compose project, containers and database were renamed, so wipe the local database once
(`docker compose down -v`, stopping any old containers `docker ps` still shows), copy the new
`DATABASE_URL` from `.env.example`, then rerun `db:migrate:deploy` and `db:seed`.

## Production Deployment

Multi-stage Dockerfiles are included for both API and Web:

```bash
# Build and run with production compose
docker compose -f docker-compose.prod.yml up --build
```

See `apps/api/Dockerfile`, `apps/web/Dockerfile`, and `docker-compose.prod.yml`.

## Architecture

```
Browser
     |
     | tRPC (HTTP)
     v
  NestJS API
     |
     |--- ThrottlerGuard (rate limiting)
     |--- Helmet (security headers)
     |--- CSRF double-submit
     |--- RequestContext (correlation IDs)
     |
     v
  Routers (thin, extract context)
     |
     v
  Services (business logic)
     |
     v
  Repositories (data access, soft-delete filtering)
     |
     v
  Prisma 7 (PostgreSQL) + Redis (sessions, cache, queues)
```

## Auth Flow

- **Registration**: Email + password -> Argon2id hash -> verification email -> confirm token
- **Login**: Turnstile CAPTCHA -> credential check -> progressive lockout (5 attempts -> 5min/15min/1hr/permanent) -> session cookie (SHA-256 hashed in Redis)
- **Sessions**: Max 3 concurrent per user, oldest evicted, 24h TTL (7d remember me)
- **Password Reset**: Token via email -> invalidates all sessions + unlocks account

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit with conventional commits (`feat:`, `fix:`, `chore:`, etc.)
4. Push and open a PR

See [CONTRIBUTING.md](CONTRIBUTING.md) for the merge bar and [SECURITY.md](SECURITY.md) for
reporting vulnerabilities.

## License

[MIT](LICENSE)
