-- Vertical Slice A — Calendar.
--
-- Two tables, because the domain has two concepts and they are not the same
-- thing: a calendar entry is something that
-- happens, an agenda item is something the leader intends to do. Merging them
-- behind a `type` column would force one to carry the other's columns.
--
-- Shapes that stay as the domain has them:
--   * dates are `yyyy-MM-dd` TEXT, matching src/domain/schedule.ts;
--   * times are `HH:mm` TEXT — a wall clock, not an instant;
--   * only created_at / updated_at are full ISO timestamps.
--
-- Lists (reminders, tags, participants, related records, recurrence skips) are
-- JSON TEXT rather than child tables. They are read and written whole, never
-- queried across, and a join table for "the two people coming to a phone call"
-- would be structure the domain does not have.

CREATE TABLE schedule_entry (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,

  -- Exactly one of `date` or a recurrence is present. A one-off has a date; a
  -- rhythm has a frequency and a start, and its dates are computed.
  date          TEXT,
  start_time    TEXT,
  end_time      TEXT,
  all_day       INTEGER NOT NULL DEFAULT 0,

  category      TEXT NOT NULL,
  ministry_id   TEXT,
  location      TEXT,
  meeting_url   TEXT,
  note          TEXT,

  -- Weekly-on-a-weekday and its near neighbours. Deliberately not RFC 5545:
  -- the binder's rhythms are weekly, and §7 forbids a recurrence engine.
  rec_frequency TEXT,
  rec_weekday   INTEGER,
  rec_from      TEXT,
  rec_until     TEXT,
  rec_skip      TEXT,           -- JSON array of yyyy-MM-dd

  reminders     TEXT,           -- JSON array of ReminderOffset
  tags          TEXT,           -- JSON array
  participants  TEXT,           -- JSON array of person id
  related       TEXT,           -- JSON array of BinderLink

  organizer_id  TEXT,
  source        TEXT,
  related_work_id TEXT,

  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,

  -- An entry with neither a date nor a rhythm would never appear anywhere, and
  -- one with both would appear twice. The database refuses both.
  CHECK ((date IS NOT NULL) <> (rec_frequency IS NOT NULL))
);

-- The month and week views ask "what falls in this range", so one-offs are
-- indexed by date. Rhythms are few and are expanded in the domain.
CREATE INDEX schedule_entry_date ON schedule_entry (date);
CREATE INDEX schedule_entry_ministry ON schedule_entry (ministry_id);

CREATE TABLE agenda_item (
  id               TEXT PRIMARY KEY,
  text             TEXT NOT NULL,

  -- A day, or the week's Monday, or neither is invalid: an item has to be
  -- filed somewhere to be found. Never invent a date to file one — the NOTES
  -- area of the binder is `week_of` with no `date`.
  date             TEXT,
  week_of          TEXT,

  completed        INTEGER NOT NULL DEFAULT 0,
  completed_at     TEXT,
  category         TEXT,
  ministry_id      TEXT,
  due_at           TEXT,
  assignee_id      TEXT,

  -- Reference, never ownership. An agenda item outlives the entry it was
  -- about, so this is nulled rather than cascading when an entry is deleted.
  related_entry_id TEXT REFERENCES schedule_entry (id) ON DELETE SET NULL,

  created_by       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,

  CHECK (date IS NOT NULL OR week_of IS NOT NULL)
);

CREATE INDEX agenda_item_date ON agenda_item (date);
CREATE INDEX agenda_item_week ON agenda_item (week_of);
CREATE INDEX agenda_item_entry ON agenda_item (related_entry_id);
