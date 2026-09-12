-- What each person has done with the things routed to them.
--
-- Attention is a **projection** over records that live elsewhere: a report is
-- still a report, a gathering still a gathering. What is personal is whether
-- *this* leader has read it, saved it for later, or is finished with it — so
-- only that is stored, keyed by person and item.
--
-- Deliberately not a copy of every domain object into an "attention" table.
-- The items themselves are derived; this is the thin per-user layer on top,
-- which is why a row appears only once somebody acts on one.
--
-- `done` here means "no longer in my attention", never "the work is resolved".
-- The record's own status says whether the work is done, and it lives in its
-- own module.

CREATE TABLE attention_state (
  person_id TEXT NOT NULL,
  item_id   TEXT NOT NULL,

  state     TEXT NOT NULL DEFAULT 'inbox' CHECK (state IN ('inbox', 'saved', 'done')),
  unread    INTEGER NOT NULL DEFAULT 1,

  updated_at TEXT NOT NULL,

  PRIMARY KEY (person_id, item_id)
);
