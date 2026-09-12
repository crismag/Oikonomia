-- Optimistic concurrency for Reach-Out.
--
-- Meeting Notes got this in migration 003 because autosave made a lost update
-- easy. Reach-Out needs it more: two leaders continuing one report is the
-- *expected* use of the module, not an edge case, and last-write-wins would
-- silently discard whichever account arrived second.
--
-- Same mechanism: `version` increments on every write, the caller states the
-- version it was editing, and a stale write is refused rather than applied.

ALTER TABLE reach_out_report ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
