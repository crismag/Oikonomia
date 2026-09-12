-- What a leadership journal entry says.
--
-- A journal entry is a `work_context` of kind `development-record`: that is what
-- gives it an audience policy, an owner, a history, and a place in the review
-- shell if it is ever shared. What it says lives here, for the same reason
-- `document_content` is separate from `document` — a record of something and
-- the something are different concerns.
--
-- Only entries the binder itself keeps have a row here. The older development
-- records carry prose `sections` instead and are read, not written.
--
-- Nothing in this table is readable by anyone but its owner unless the owner
-- deliberately shares it, and sharing does not happen by opening this table: a
-- summary is a *copy* into a Leadership Report, so unrelated entries stay shut.

CREATE TABLE work_content (
  work_id    TEXT PRIMARY KEY REFERENCES work_context (id) ON DELETE CASCADE,

  -- The same block list Meeting Notes and ministry documents use.
  blocks     TEXT NOT NULL DEFAULT '[]',

  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
