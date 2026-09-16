-- Gatherings and goals refuse a stale save.
--
-- Both are shared records: several leaders maintain one gathering row on the
-- schedule, and a ministry's goal belongs to everyone who works in it. Until
-- now the last writer silently won, so a leader moving a gathering's time could
-- put back the venue somebody else had just settled.
--
-- `version` increments on every write the services make to the fields a person
-- edits (when, where, who, stage; a goal's details and status). A caller states
-- the version it loaded, and a write against a stale one is refused — the same
-- rule meeting notes, Reach-Out and leadership reports already follow.
ALTER TABLE gathering ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE goal ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
