-- Vertical Slice C — Goals.
--
-- Two tables. A goal is the annual intention; an update is a dated, attributed
-- line about how it is going. Updates are **rows, not JSON**, which is the
-- opposite of the choice made for meeting-note blocks — and for a reason:
-- blocks are read and written whole by one editor, while a goal update is
-- written on its own, listed on its own, attributed on its own, and read by
-- the Leader's Progress Report without its goal.

CREATE TABLE goal (
  id                 TEXT PRIMARY KEY,

  -- The binder's "01", "02". Its position in the year, stable once written,
  -- and unique within that year — two goals numbered 03 is a binder nobody
  -- can read aloud.
  number             INTEGER NOT NULL,
  year               INTEGER NOT NULL,

  title              TEXT NOT NULL,
  description        TEXT,

  ministry_id        TEXT,
  campus_id          TEXT,
  owner_id           TEXT,

  -- "June" and "21 May 2026" are both targets the binder writes. Precision is
  -- modelled rather than faked as the 1st, so a month never renders as a day.
  target_precision   TEXT CHECK (target_precision IN ('month', 'date')),
  target_value       TEXT,

  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'completed', 'on-hold', 'carried-forward')),

  completed_at       TEXT,
  completion_note    TEXT,
  hold_since         TEXT,
  hold_reason        TEXT,

  -- Set when this goal was carried into a later year from an earlier one.
  -- Not a foreign key: the earlier goal may be archived away, and losing the
  -- provenance would be worse than holding an id that no longer resolves.
  carried_from_goal_id TEXT,

  links              TEXT,           -- JSON array of BinderLink
  -- Absent means ordinary organizational visibility. Held whole because
  -- `resolveAccess` reads it whole; see the service for why it is not SQL.
  policy             TEXT,

  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,

  -- A target with a precision and no value, or the reverse, would render as
  -- either a blank date or a date nobody set.
  CHECK ((target_precision IS NULL) = (target_value IS NULL)),
  UNIQUE (year, number)
);

CREATE INDEX goal_year ON goal (year);
CREATE INDEX goal_ministry ON goal (ministry_id);

CREATE TABLE goal_update (
  id        TEXT PRIMARY KEY,

  -- An update is about its goal and has no life without it.
  goal_id   TEXT NOT NULL REFERENCES goal (id) ON DELETE CASCADE,

  -- The date the update is *about*, not when it was typed.
  date      TEXT NOT NULL,
  text      TEXT NOT NULL,
  author_id TEXT,

  -- An ordinary note, a status change, or the completion itself.
  kind      TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'status', 'completion')),

  created_at TEXT NOT NULL
);

CREATE INDEX goal_update_goal ON goal_update (goal_id, date DESC);
