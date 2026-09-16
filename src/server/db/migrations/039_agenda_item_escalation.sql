-- Which ask an agenda item was put on the week for.
--
-- "Put on my week" used to recognise its own agenda items by matching their
-- text against the ask's request. Editing either one broke the match, and two
-- asks worded the same could not be told apart. The item now says which ask it
-- came from.
--
-- Reference, never ownership: the ask and the agenda item live and end
-- separately. Not a foreign key, for the same reason as `related_entry_id`'s
-- ON DELETE SET NULL — the agenda item is the leader's record of what they
-- meant to do, and it outlives whatever it was about.
ALTER TABLE agenda_item ADD COLUMN escalation_id TEXT;

CREATE INDEX agenda_item_escalation ON agenda_item (escalation_id);
