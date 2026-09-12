-- Vertical Slice B — Meeting Notes.
--
-- Two tables, for the same reason the calendar has two: a note is a document,
-- and a task that came out of a meeting is a record that outlives it. A task
-- gets assigned, tracked and surfaced elsewhere; folding it into the note's
-- blocks would bury it in the document it escaped from.

CREATE TABLE meeting_note (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,

  -- The distinction the whole module rests on. A personal note is the
  -- leader's own working record; minutes are the meeting's account of itself.
  -- Sharing a personal note does not turn it into minutes.
  note_type      TEXT NOT NULL CHECK (note_type IN ('personal', 'minutes')),

  -- The date of the meeting, not of typing it up.
  date           TEXT NOT NULL,
  time           TEXT,
  location       TEXT,
  meeting_type   TEXT,

  facilitator_id TEXT,
  note_taker_id  TEXT,
  participants   TEXT,           -- JSON array of person id
  absentees      TEXT,           -- JSON array of person id; minutes only

  -- The document itself. JSON, because blocks are read and written whole and
  -- never queried across: the editor loads a note and saves a note. Rows per
  -- block would buy ordering pain and no query anyone makes.
  blocks         TEXT NOT NULL DEFAULT '[]',

  -- Plain text of every block, maintained by the repository on write, so the
  -- list can search what a note *says* and not only what it is called. A
  -- derived column with exactly one writer; never read as content.
  body_text      TEXT NOT NULL DEFAULT '',

  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),

  -- Free tags describing the note. A tag never stands in for an
  -- organizational relationship — that is what `links` is for, and why
  -- ministries are not hashtags.
  tags           TEXT,           -- JSON array
  related_text   TEXT,
  links          TEXT,           -- JSON array of BinderLink

  author_id      TEXT,
  visibility     TEXT,

  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX meeting_note_date ON meeting_note (date DESC);
CREATE INDEX meeting_note_type ON meeting_note (note_type);
CREATE INDEX meeting_note_author ON meeting_note (author_id);

CREATE TABLE meeting_task (
  id          TEXT PRIMARY KEY,

  -- A task belongs to the meeting it came out of. Deleting the meeting takes
  -- its tasks with it: they were never filed anywhere else.
  meeting_id  TEXT NOT NULL REFERENCES meeting_note (id) ON DELETE CASCADE,

  -- Which block produced it, so the document can show where it came from. The
  -- block may be edited away; the task survives, which is the point of it
  -- being its own record.
  block_id    TEXT,

  title       TEXT NOT NULL,
  assignee_id TEXT,
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX meeting_task_meeting ON meeting_task (meeting_id);
CREATE INDEX meeting_task_assignee ON meeting_task (assignee_id);
