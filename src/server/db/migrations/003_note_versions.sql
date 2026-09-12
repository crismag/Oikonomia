-- Optimistic concurrency for Meeting Notes.
--
-- Slice B saves a note behind a debounce, which makes a lost update easy: two
-- people in one note, or one person in two tabs, and the slower write silently
-- replaces the faster one. Nothing warned anybody, because last-write-wins
-- looks exactly like success.
--
-- `version` increments on every write. A caller states the version it was
-- editing, and a write against a stale version is refused rather than applied.
-- Cheaper and clearer than comparing timestamps, which collide at this
-- resolution and drift between machines.

ALTER TABLE meeting_note ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
