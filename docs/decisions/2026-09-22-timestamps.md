# Decision record: timestamp column types

**Date:** 2026-09-22
**Status:** decided; not yet applied to the schema
**Touches:** `packages/database/prisma/schema/*.prisma`, the baseline migration
(`packages/database/prisma/migrations/0001_init`)
**Reopens when:** never. It stops being cheap to apply once a product built on the starter has
deployed its first database, because from then on every change is a data migration.

## Decision

- An **instant** (something that happened, or will happen, at a point in time) is
  `DateTime @db.Timestamptz(3)`.
- A **calendar date** (a date printed on paper: a birth date, a contract start, an expiry day)
  is `DateTime @db.Date`.
- A bare `DateTime` with no `@db.` type is not allowed in new schema.

## The state

```text
$ grep -hE '^\s+\w+\s+DateTime' packages/database/prisma/schema/*.prisma | wc -l
30
$ grep -rn '@db\.' packages/database/prisma/schema/ | wc -l
0
```

So every `DateTime` column is still `timestamp(3) without time zone`. The starter ships a single
baseline migration, so applying the decision today is a schema edit plus a regenerated baseline,
not a data migration. Do it before your first production deployment.

## Why

`timestamp without time zone` stores a wall-clock reading with no zone. Prisma writes UTC into
it, so it works as long as every writer agrees on that convention. The first raw SQL `now()`,
a `psql` session with a non-UTC `TimeZone`, or a reporting tool reading the column directly
gets a value that is silently off by the zone offset. `timestamptz` stores an instant, and
every client converts it correctly.

Calendar dates are the other half. A column that holds a calendar day but is stored as an
instant holds whatever instant the client sent for that day, so every reader has to recover the
day through zone arithmetic, and a reader that forgets is a day out near midnight. `@db.Date`
stores the day itself.

## Proposed, not built: a lint-meta check

A small `prisma-datetime-has-db-type` check in the lint-meta registry: read every
`schema/*.prisma`, and fail on any field whose type is `DateTime` or `DateTime?` with no
`@db.Timestamptz(` or `@db.Date` attribute on the same line. About 60 lines plus a test, and no
new dependency: the model and field shape is simple enough to read line by line, the same way
the other registry rules read their files today. There is no Prisma equivalent in
`@noctcore/*` today.

## Applying it after a deployment: what it would cost

If a product has already deployed with bare columns, this becomes a data migration:

- **Instants.** `ALTER COLUMN ... TYPE timestamptz(3) USING col AT TIME ZONE 'UTC'`. Correct
  because Prisma has always written UTC into these columns. On Postgres 12 and later this
  conversion does not rewrite the table when the session `TimeZone` is UTC, so it is cheap, but
  the migration must set `TimeZone` explicitly rather than inherit it. No application code
  changes: the Prisma client type is `Date` either way.
- **Calendar dates.** Converting to `@db.Date` needs the zone the day was meant in, so decide it
  per column and verify the values near midnight before and after.

The lint-meta check above would then need a **baseline**: an explicit list of the existing
fields that may stay bare, which may only shrink.
