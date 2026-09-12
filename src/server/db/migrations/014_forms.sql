-- Forms: the definitions leaders design, and the records they fill in.
--
-- Until now the form builder was a convincing interface over React state: a
-- leader could design a checklist, publish it, fill one in and watch all of it
-- disappear on reload. That is the single most misleading surface in the
-- application, because nothing about it looked unfinished.
--
-- Two tables, because a definition and a record are different things with
-- different lifetimes. The structure is **copied onto the record** at the
-- moment it is created: editing a master checklist must never retroactively
-- rewrite what somebody already completed, which is why `sections` appears on
-- both and `form_version` says which version a record was filled under.

CREATE TABLE form_definition (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  ministry_id TEXT,
  campus_id   TEXT,
  owner_id    TEXT NOT NULL,

  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  -- Bumped when the structure is saved, so records can name what they used.
  version     INTEGER NOT NULL DEFAULT 1,

  -- The structure itself: sections, each holding fields. JSON because a form's
  -- shape is the leader's to design and a column per field type would be a
  -- schema that changes every time somebody adds a question.
  sections    TEXT NOT NULL DEFAULT '[]',
  -- Who changed the structure, when, and what they said about it.
  history     TEXT NOT NULL DEFAULT '[]',
  policy      TEXT,

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX form_definition_owner ON form_definition (owner_id);

CREATE TABLE form_record (
  id             TEXT PRIMARY KEY,
  definition_id  TEXT NOT NULL REFERENCES form_definition (id) ON DELETE CASCADE,

  -- The version this record was created under, and the structure as it stood.
  form_version   INTEGER NOT NULL,
  sections       TEXT NOT NULL DEFAULT '[]',

  title          TEXT NOT NULL,
  period         TEXT,
  date           TEXT,

  status         TEXT NOT NULL DEFAULT 'in-progress'
                 CHECK (status IN ('in-progress', 'completed', 'archived')),

  responses      TEXT NOT NULL DEFAULT '[]',
  history        TEXT NOT NULL DEFAULT '[]',
  links          TEXT NOT NULL DEFAULT '[]',

  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT
);

CREATE INDEX form_record_definition ON form_record (definition_id);
CREATE INDEX form_record_creator ON form_record (created_by);
