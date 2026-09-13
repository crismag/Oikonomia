-- Which people a public demonstration lets a visitor explore as.
--
-- Infrastructure only: this migration creates the table and puts nothing in
-- it. On a church's own installation it stays empty forever. A demonstration's
-- baseline database fills it with the identities it offers, so who a visitor
-- can be is data, never code.
--
-- A row points at an ordinary person, whose ordinary account is what a
-- session is opened for. Nothing about Demo Mode is added to `person` or
-- `account` themselves.
--
--   designated — offered on the demonstration's sign-in screen;
--   visitor    — created by somebody trying Oikonomia as themselves, and
--                discarded when the demonstration is reset.
--
-- Entering through this table needs OIKONOMIA_DEMO_MODE=true as well: a real
-- database has no rows here, and a demonstration's database copied somewhere
-- without the flag offers nothing.

CREATE TABLE demo_identity (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL UNIQUE REFERENCES person (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('designated', 'visitor')),
  -- The order designated identities are offered in. Visitors are not offered.
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE INDEX demo_identity_kind ON demo_identity (kind, display_order);
