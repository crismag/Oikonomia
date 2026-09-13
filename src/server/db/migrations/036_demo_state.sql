-- What a public demonstration's database knows about itself.
--
-- Infrastructure only: this migration creates the table and puts nothing in
-- it. On a church's own installation it stays empty forever, and an empty
-- table is exactly what makes a demonstration reset refuse to touch it.
--
-- At most one row, and it is a marker put there on purpose:
--
--   demo-baseline      — this file is a curated baseline a demonstration is
--                        restored from. Only ever read by a reset.
--   demo-installation  — this file is a demonstration's live database, which a
--                        reset may empty and restore. Written once, when the
--                        demonstration is provisioned (scripts/ops/demo-provision.mjs).
--
-- A reset restores every other table from the baseline and never this one, so
-- the live row's generation survives each reset and counts them.

CREATE TABLE demo_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  marker        TEXT    NOT NULL CHECK (marker IN ('demo-baseline', 'demo-installation')),
  -- How many times this database has been reset. Only a completed reset adds one.
  generation    INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  last_reset_at TEXT
);
