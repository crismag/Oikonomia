-- The audience choices for a gathering entry are configuration too.
--
-- `lifegroup_entry.visibility` carried `CHECK (visibility IN ('leaders',
-- 'assigned-leaders', 'selected-viewers', 'private'))`, and `canReadEntry`
-- switched on those same four ids. Both are gone: each choice now names an
-- **entry strategy** — a closed set the application owns — and the strategy
-- decides who may read, in `domain/lifegroup.ts`.
--
-- ## Why removing it is safe
--
-- The CHECK was not what kept an entry private. A choice naming no strategy
-- resolves to `author-only`, the narrowest answer there is, so an unrecognised
-- visibility closes an entry to everybody but its author — with or without a
-- constraint. That is the same fail-closed rule migration 022 relied on for
-- reports, and the same one this column already had in code: its default used
-- to be the *widest* of the four, which was the defect.
--
-- Validation moved to where the registry can be consulted:
-- `lifegroup-contract.ts` accepts only choices the church currently offers,
-- and the service is the only writer.
--
-- These are the most sensitive rows in the product — entries carry prayer
-- requests and concerns about named people — so the table is rebuilt rather
-- than loosened by any other means, and every column, row and index is
-- preserved exactly.

CREATE TABLE lifegroup_entry_new (
  id           TEXT PRIMARY KEY,
  gathering_id TEXT NOT NULL REFERENCES gathering (id) ON DELETE CASCADE,

  author_id    TEXT NOT NULL,
  body         TEXT NOT NULL,

  category     TEXT,

  -- Who may read it. Absent means the church's default choice. No CHECK: the
  -- choices are configuration, and the strategy each one names is what
  -- enforcement reads.
  visibility   TEXT,
  viewer_ids   TEXT,

  person_id    TEXT,
  assigned_to  TEXT,
  due_date     TEXT,
  completed    INTEGER NOT NULL DEFAULT 0,
  reportable   INTEGER NOT NULL DEFAULT 0,

  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

INSERT INTO lifegroup_entry_new
SELECT id, gathering_id, author_id, body, category, visibility, viewer_ids,
       person_id, assigned_to, due_date, completed, reportable,
       created_at, updated_at
  FROM lifegroup_entry;

DROP TABLE lifegroup_entry;
ALTER TABLE lifegroup_entry_new RENAME TO lifegroup_entry;

CREATE INDEX lifegroup_entry_gathering ON lifegroup_entry (gathering_id, created_at);
