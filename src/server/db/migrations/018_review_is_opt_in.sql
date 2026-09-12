-- Review stops being what happens to everything.
--
-- `work_context` was built as the reviewer's side of reporting: a leader
-- submitted, and the submission waited for somebody to pick it up, read it,
-- ask for changes or acknowledge it. Every report acquired a reviewer and a
-- review state by existing.
--
-- That is the wrong default. Most of what leaders write is information: it
-- should reach its audience, be new until read, and then be read. A formal
-- review is a real process — a development record being assessed, a policy
-- being approved — and it should happen because somebody defined it, not
-- because a record was created.
--
-- So the review cycle becomes a property of the record. Off by default. Where
-- it is off, `submitted` means **published**: it is out, people can read it,
-- and nobody owes anything. Where it is on, the existing cycle applies
-- unchanged.
--
-- Existing rows are handled deliberately rather than by assumption: a record
-- that already carries reviewers and sits in a review state was genuinely
-- being reviewed, and keeps its review. Everything else did not need one.
-- Review is opt-in: a report asks for one only when its author said so.

ALTER TABLE work_context ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0;

UPDATE work_context
   SET review_required = 1
 WHERE status IN ('in-review', 'changes-requested')
    OR (status = 'acknowledged' AND reviewer_ids <> '[]')
    OR (kind = 'development-record' AND reviewer_ids <> '[]');
