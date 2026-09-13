-- What each person has starred, for their own quick access.
--
-- A personal bookmark, not a church record: no row means not starred, and
-- starring one report says nothing about another person's binder. Modelled
-- on `read_state` (migration 017) — the same (person_id, item_type, item_id)
-- shape, because "does this person have a private relationship to this item"
-- is the same question read state already answers, just with a different
-- verb. `item_type` stays a plain string rather than a foreign key because it
-- names a kind of record (a leadership report, a reach-out report, a meeting
-- note, a goal, ...), not a row in one particular table.
CREATE TABLE starred_item (
  person_id  TEXT NOT NULL,
  item_type  TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  starred_at TEXT NOT NULL,
  PRIMARY KEY (person_id, item_type, item_id)
);

CREATE INDEX starred_item_person_type ON starred_item (person_id, item_type);
