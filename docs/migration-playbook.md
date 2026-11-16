# Database Migration Playbook

This template uses **Prisma Migrate** (not `db push`) for schema changes in any
environment past dev. Financial / business-critical data cannot be `DROP COLUMN`-ed
with rows in the table, every change needs migration history and a rollback
path. This document is the operating manual for that.

## Where things live

- Schema: `packages/database/prisma/schema/` (a FOLDER: one `.prisma` file per
  domain, all loaded together, relations resolve across files with no imports)
- Migration history: `packages/database/prisma/migrations/`
- Migration lock file (provider): `packages/database/prisma/migrations/migration_lock.toml`
- Scripts (defined in `packages/database/package.json`):
  - `pnpm --filter @repo/database db:generate`: regenerate Prisma client
  - `pnpm --filter @repo/database db:migrate`: `prisma migrate dev` (local: edit + new migration)
  - `pnpm --filter @repo/database db:migrate:deploy`: `prisma migrate deploy` (CI/prod: apply pending migrations only)
  - `pnpm --filter @repo/database db:migrate:status`: list applied + pending
  - `pnpm --filter @repo/database db:migrate:resolve`: manually mark a migration as applied/rolled-back
  - `pnpm --filter @repo/database db:push`: _dev/prototyping only_, do not use against shared environments

## Local development workflow

1. Edit the relevant file under `prisma/schema/`.
2. Run `pnpm --filter @repo/database db:migrate -- --name <short_snake_case_name>`.
   - Prisma generates SQL into `prisma/migrations/<timestamp>_<name>/migration.sql`
     and applies it to your local DB.
   - **Read the SQL.** If it contains `DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... NOT NULL`
     on a populated table, or any `RENAME`, the migration is destructive, see
     "Expand-and-contract" below.
3. Commit the schema change AND the new migration folder in the same PR.
4. CI applies migrations via `db:migrate:deploy` (idempotent, only runs new ones).

## Production / staging deployment

The `migrate` service in `docker-compose.prod.yml` is a one-shot container that
runs `prisma migrate deploy` and exits. The `api` service waits for it via
`depends_on: { migrate: { condition: service_completed_successfully } }`.

```bash
# Bring everything up: migrations run before api starts
docker compose -f docker-compose.prod.yml up -d --build

# Inspect migration state
docker compose -f docker-compose.prod.yml run --rm migrate \
  pnpm exec prisma migrate status --schema=prisma/schema
```

If a migration fails the api container will not start (good, it prevents the
"app shipped but DB still on old schema" scenario).

For hosts that do not run the compose `migrate` service (a managed Postgres, a
PaaS release phase, etc.) run `db:migrate:deploy` as a release step before
booting the API.

## The expand-and-contract pattern

**Default to additive migrations.** A change that only adds nullable columns,
tables, or indexes is safe to deploy with the old code still running. A change
that drops or narrows is not.

For any rename / drop / not-null-on-existing / type-change, split across two or
three releases:

| Step | Migration            | App code                    |
| ---- | -------------------- | --------------------------- |
| 1    | Add new column/table | App writes both old and new |
| 2    | Backfill (one-shot)  | App reads new, writes both  |
| 3    | Drop old column      | App reads/writes new only   |

This keeps every release rollback-safe: at any point both N and N-1 of the app
work against the current schema.

Concretely:

- **Renaming `Invoice.status` → `Invoice.state`**: Add `state`, dual-write, copy
  data, swap reads, drop `status` in a later release.
- **Making `User.tenantId` `NOT NULL`**: Add nullable, backfill, only then add
  `NOT NULL` constraint.
- **Splitting one column into two**: Add the new pair, dual-write, backfill,
  swap, drop.

## Backfills

- Keep them out of `migration.sql`. Prisma migrations should be DDL only.
- Run backfills as a separate one-shot script (`tsx scripts/backfill-<x>.ts`)
  with `--batch-size` for large tables.
- Idempotent, script can re-run on partial completion.
- Long backfills: pause writers (or dual-write) and run during low-traffic
  windows; or chunk so each batch is < 1s of locks.

## Rollback strategy

Prisma does not generate `down` SQL. There are three options:

1. **Forward fix (preferred).** Write a new migration that reverses the change.
   This keeps history linear and reproducible.
2. **Restore from backup.** If the migration corrupted data and forward-fix
   isn't viable, restore the most recent snapshot. The starter ships no backup
   automation, so set one up before you rely on this option.
3. **`prisma migrate resolve --rolled-back <name>`.** Marks a failed migration
   so the next `deploy` can skip it. Only useful when the SQL partially applied
   and you want to manually clean up; do not use to "undo" a successful
   migration.

For destructive migrations (drop/rename), write the rollback SQL alongside the
migration as `migration.sql` + `rollback.sql` and exercise it on a staging copy
of prod data before merging.

## Common foot-guns

- **Adding `NOT NULL` without a default to a populated table** locks the table
  while Postgres rewrites every row. Use `DEFAULT` + `NOT NULL` together; or
  add nullable, backfill, then `SET NOT NULL` in a later migration.
- **Adding a `UNIQUE` index on a populated table with duplicates** fails. Run
  `SELECT ... GROUP BY ... HAVING COUNT(*) > 1` first.
- **Renaming a column** in the schema makes Prisma produce `DROP` + `ADD`,
  losing data. Always go via expand-and-contract.
- **Forgetting to commit the migrations folder.** CI's `migrate deploy` reads
  the folder; if it's missing, CI applies nothing and prod drifts silently.
- **Running `prisma db push` against a shared DB.** This bypasses the migration
  history and the next `migrate deploy` will fail with "drift detected." If you
  did this by accident, `prisma migrate resolve --applied <fake-baseline>` and
  document the incident.

## Index creation on large tables

`CREATE INDEX` takes a lock that blocks writes to the table for the duration of
the build. On a small table that is milliseconds; on a large production table
it is an outage. Postgres offers `CREATE INDEX CONCURRENTLY` for this, but it
cannot run inside a transaction block, and Prisma has no directive to opt a
migration out of its transaction wrapper (see
[prisma/prisma#14456](https://github.com/prisma/prisma/issues/14456)).

What Prisma actually does: a migration file containing a **single statement**
is executed without a transaction wrapper; two or more statements get wrapped.
That gives a reliable pattern:

1. Put each `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` in its **own
   migration folder**, with nothing else in the file (one statement, no
   trailing `;`-separated extras, comments are fine).
2. Keep the matching `@@index` in the schema so introspection does not
   drift.
3. Verify afterwards: a failed concurrent build leaves an `INVALID` index
   behind. Check with
   `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`
   and if anything shows up, `DROP INDEX CONCURRENTLY` it and re-run.

Rules of thumb:

- Tables that are small by construction (this template's `Token`) do not need this; plain `CREATE INDEX` inside a normal
  migration is fine and keeps history simpler.
- Anything expected to grow without bound (`AuditLog`, and any
  event, invoice or ledger tables a product adds) should get new indexes via the single-statement
  concurrent pattern once it is deployed anywhere with real data.
- `CREATE UNIQUE INDEX CONCURRENTLY` works too, but fails on duplicate data;
  run the duplicate check from "Common foot-guns" first.

## Bootstrapping an existing database (baseline)

If you have a database created via `db push` and want to switch to migrations:

```bash
# Generate the SQL representing current state
pnpm --filter @repo/database exec prisma migrate diff \
  --from-empty --to-schema prisma/schema --script \
  > prisma/migrations/<timestamp>_baseline/migration.sql

# Mark it as applied so future migrations apply on top
pnpm --filter @repo/database db:migrate:resolve --applied <timestamp>_baseline
```

This starter's single baseline migration (`0_init`) was generated this way
before any production deployment. Until your product has deployed a database,
regenerating that baseline is simpler than stacking new migrations on it.

## Connection pooling and migrations

- `prisma migrate deploy` requires a **direct** Postgres connection, not via
  PgBouncer in transaction mode (it uses session-level features). Set a
  separate `DIRECT_URL` and configure `directUrl` in the Prisma config if your
  prod DB is behind PgBouncer.
- The api itself can use the pooled URL.

## Audit trail for migrations

Schema changes that affect business-critical entities should also leave an
`AuditLog` entry. Consider a small wrapper that records a `system.migration.applied`
row with the migration name after each `migrate deploy`. The starter does not ship
that wrapper.
