-- A field that decided nothing.
--
-- `meeting_note.visibility` held 'private', 'selected' or 'leaders'. It was
-- written on every note, returned on every read, accepted from the API — and
-- consulted by **nothing**. Who may open a note is decided by its type and its
-- participants, in `authorize.ts`, and always was.
--
-- That made it worse than unused. A client could send `visibility: "leaders"`
-- on a personal note, be answered with success, and reasonably believe the note
-- had been shared. Nothing had happened. A stored value that looks like a
-- decision and is not is the same defect as a button that looks operational and
-- is not, one layer down where it is harder to notice.
--
-- ## Removed rather than enforced
--
-- Enforcing it would mean building note sharing — deciding what "selected"
-- means, who may select, whether sharing a personal note promotes it to
-- minutes. That is a feature, and the product has deliberately not built it:
-- `readership()` states the rule in a sentence precisely because there is no
-- control behind it yet.
--
-- So the honest move is the smaller one. The type is the whole of the rule, and
-- now nothing in the schema suggests otherwise.
--
-- ## What is lost
--
-- Nothing that meant anything. Every stored value was either the default
-- derived from `note_type` or a value a caller sent that was never read. No
-- access changes, in either direction, for any existing note.
--
-- When real sharing arrives it arrives as a field with a rule behind it, a
-- migration of its own, and a test that fails when the rule is not applied.
--
-- SQLite before 3.35 cannot drop a column, and the established pattern in this
-- schema is to rebuild, so the table is rebuilt. Every other column — including
-- `version`, added by 003 — every row and both indexes are preserved.

CREATE TABLE meeting_note_new (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,

  note_type      TEXT NOT NULL CHECK (note_type IN ('personal', 'minutes')),

  date           TEXT NOT NULL,
  time           TEXT,
  location       TEXT,
  meeting_type   TEXT,

  facilitator_id TEXT,
  note_taker_id  TEXT,
  participants   TEXT,
  absentees      TEXT,

  blocks         TEXT NOT NULL DEFAULT '[]',
  body_text      TEXT NOT NULL DEFAULT '',

  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),

  tags           TEXT,
  related_text   TEXT,
  links          TEXT,

  author_id      TEXT,

  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,

  version        INTEGER NOT NULL DEFAULT 1
);

INSERT INTO meeting_note_new
SELECT id, title, note_type, date, time, location, meeting_type,
       facilitator_id, note_taker_id, participants, absentees,
       blocks, body_text, status, tags, related_text, links, author_id,
       created_at, updated_at, version
  FROM meeting_note;

DROP TABLE meeting_note;
ALTER TABLE meeting_note_new RENAME TO meeting_note;

CREATE INDEX meeting_note_date ON meeting_note (date DESC);
CREATE INDEX meeting_note_type ON meeting_note (note_type);
