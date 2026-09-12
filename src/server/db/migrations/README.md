# Migrations

One `.sql` file per schema change, named `NNN_description.sql` — for example
`002_calendar.sql`. They run in numeric order, exactly once each, inside a
transaction, and are recorded in `schema_migrations`.

Rules the runner enforces (`../migrate.ts`):

- The filename must match `NNN_description.sql`. A file that does not is a
  migration whose order is undefined, so it is an error rather than a warning.
- Two files may not claim the same number.
- A migration that has been applied is never re-run, and never edited. Change a
  schema by adding the next migration, not by rewriting an old one — someone
  else's database has already run it.

There is deliberately no `down`. Rolling a schema backwards is a production
discipline this MVP has not earned, and a half-written `down` is worse than
none.

## Conventions for new tables

Per §6 of the MVP brief, persisted records carry lifecycle metadata where the
domain needs it, not uniformly:

| Column       | Type | Notes                                                           |
| ------------ | ---- | --------------------------------------------------------------- |
| `id`         | TEXT | Application-generated, prefixed by kind (`ev-`, `mn-`).         |
| `created_at` | TEXT | ISO 8601, UTC.                                                  |
| `updated_at` | TEXT | ISO 8601, UTC.                                                  |
| `created_by` | TEXT | Person id. See `src/domain/viewer.ts` — asserted, not verified. |

Dates that the _domain_ treats as dates — a meeting date, a goal's target —
stay `yyyy-MM-dd` strings, matching `src/domain/schedule.ts`. Only timestamps
are full ISO.

No migration exists yet. The first arrives with Vertical Slice A (Calendar);
the runner and its tests exist ahead of it on purpose, so the first real schema
change is not also the first exercise of the machinery.
