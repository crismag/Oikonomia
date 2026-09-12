-- An access role is a name a church gives a bundle of permissions.
--
-- `person.access_role` carried `CHECK (access_role IN ('leader',
-- 'ministry-head', 'bishop', 'admin'))`, on the same reasoning as the two
-- CHECKs before it: the four roles were the product's, so no other value could
-- exist. That reasoning has stopped being true.
--
-- A role is now a **bundle**: a name, and a list of capabilities drawn from a
-- closed set the application owns (`domain/capabilities.ts`). What
-- authorization reads is the capabilities, never the name — enforced by
-- `roles-are-not-permissions.test.ts`, which fails if any file that runs
-- compares a role id. So a church may define "Regional Overseer", tick campus
-- oversight, and have it work; leaving the CHECK behind would mean the screen
-- offers the role and the database refuses the person.
--
-- ## Why removing it is safe
--
-- The CHECK was never what granted anything. A role that resolves to nothing —
-- because it was deleted, mistyped or never existed — falls back to
-- `LEAST_PRIVILEGED`, and `personaFor` filters the bundle against the closed
-- capability set a second time. An unrecognised value therefore grants the
-- fewest permissions there are, with or without a constraint.
--
-- Validation did not disappear. The only writer is `organization-service.ts`,
-- and the administration screen offers only roles this installation defines.
--
-- The default stays `leader`, which is deliberately the least privileged: a
-- row inserted without a role grants nothing.
--
-- SQLite cannot drop a CHECK, so the table is rebuilt. Every column — including
-- `reports_to_id`, added by 017 — every row, and the UNIQUE on email are kept.

CREATE TABLE person_new (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  initials TEXT NOT NULL,

  -- What they are called in the church: "LifeGroup leader", "Bishop".
  -- Descriptive. It grants nothing, and nothing reads it.
  role     TEXT NOT NULL DEFAULT '',

  -- Which bundle of capabilities they hold. No CHECK: the bundles are
  -- configuration, and the capabilities inside them are what is enforced.
  access_role TEXT NOT NULL DEFAULT 'leader',

  email    TEXT UNIQUE,

  campus_id TEXT REFERENCES campus(id) ON DELETE SET NULL,

  created_at TEXT NOT NULL,

  reports_to_id TEXT REFERENCES person(id) ON DELETE SET NULL
);

INSERT INTO person_new
SELECT id, name, initials, role, access_role, email, campus_id, created_at, reports_to_id
  FROM person;

DROP TABLE person;
ALTER TABLE person_new RENAME TO person;
