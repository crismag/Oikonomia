-- Which follow-up in a leadership report an agenda item was put on the week for.
--
-- A meeting could turn a line into work on somebody's week; a leadership report
-- could not. An author who wrote "follow up with the family" had to retype it
-- on the Weekly Agenda, and the week had no way back to the report.
--
-- Reference, never ownership, like `related_entry_id` and `escalation_id`: the
-- report and the agenda item live and end separately. `report_block_id` names
-- the follow-up line, so the same line is not put on the week twice.
ALTER TABLE agenda_item ADD COLUMN report_id TEXT;
ALTER TABLE agenda_item ADD COLUMN report_block_id TEXT;

CREATE INDEX agenda_item_report ON agenda_item (report_id);
