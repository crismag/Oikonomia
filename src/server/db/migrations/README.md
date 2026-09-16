# Migrations

One `.sql` file per schema change, named `NNN_description.sql` — for example
`001_calendar.sql`. They are numbered from `001`; a gap in the numbers is harmless, only the order matters.

## How they run

- They are part of the build: `../bundled-migrations.ts` imports every `*.sql`
  file here with `import.meta.glob`, so a deployed server never reads this
  directory at runtime. `../bundled-migrations.test.ts` checks that the bundled
  set matches the files on disk.
- `openDatabase()` (`../connection.ts`) applies them when a database is opened,
  so a new installation and an upgraded one reach the same schema on first use.
- They run in numeric order, each once, each in its own transaction, and each
  is recorded in `schema_migrations` (`version`, `name`, `applied_at`).
  `/healthz` reports how many are applied.

Rules the runner enforces (`../migrate.ts`):

- The filename must match `NNN_description.sql`; anything else is an error,
  because its order would be undefined.
- Two files may not claim the same number.
- A migration recorded in `schema_migrations` is never run again.

By convention, not enforcement: an applied migration is never edited. Change a
schema by adding the next migration — someone else's database has already run
the old one.

There is deliberately no `down`. Restoring from a backup is the recovery path.

## What they contain

Mostly `CREATE TABLE`, `ALTER TABLE … ADD COLUMN` and indexes. Two kinds need
care:

- **Table rebuilds** — create `…_new`, copy, drop, rename — where SQLite cannot
  change a constraint in place: `013`, `022`, `024`, `025`, `026`, `027`.
- **Data changes** beyond copying: `018` (updates existing work contexts),
  `031` (seeds the retention policies), `032` (creates an account for every
  existing person), `034` (collapses duplicate configuration rows before adding
  a unique key).

A uniqueness rule must not rely on a nullable column: SQL treats NULLs as
distinct, so `UNIQUE (a, b)` with `b` NULL never matches and `ON CONFLICT`
becomes an insert. `034` replaced such a rule on `configuration_setting` with
an expression index on `IFNULL(option_id, '')` and `IFNULL(field, '')`.

## Conventions for new tables

Persisted records carry lifecycle metadata where the domain needs it, not
uniformly:

| Column            | Type | Notes                                                                                          |
| ----------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `id`              | TEXT | Application-generated `prefix-uuid` — `newId("ev")` gives `ev-…` (`../records.ts`).            |
| `created_at`      | TEXT | ISO 8601, UTC, from `nowIso()`.                                                                |
| `updated_at`      | TEXT | ISO 8601, UTC, from `nowIso()`.                                                                |
| person id columns | TEXT | Named for their role — `created_by`, `author_id`, `actor_id`. Identity comes from the session. |

Dates that the _domain_ treats as dates — a meeting date, a goal's target —
stay `yyyy-MM-dd` strings, matching `src/domain/schedule.ts`. Only timestamps
are full ISO. `031` and `032` fill the timestamps of rows they insert with
SQLite's `datetime('now')` (`YYYY-MM-DD HH:MM:SS`), a different format from
`nowIso()`.
