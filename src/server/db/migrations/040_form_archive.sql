-- A filled-in form outlives the master it was made from.
--
-- `form_record.definition_id` cascaded: deleting a form's design deleted every
-- checklist anyone had completed with it, which is deleting evidence of what
-- was done. A record already carries its own copy of the structure it was
-- filled under (`sections`, `form_version`), so it never needed the master to
-- be readable.
--
-- Now a definition that has records is **archived** instead (`archived_at`):
-- it stops being offered for new records, and every record made from it stays.
-- A definition with no records is still simply deleted. The foreign key no
-- longer cascades, so a delete that would orphan records is refused by the
-- database as well as by the service.
--
-- Only `form_record` is rebuilt. Rebuilding `form_definition` would drop it
-- while the cascade is still in force — deleting the very records this is for.
ALTER TABLE form_definition ADD COLUMN archived_at TEXT;

CREATE TABLE form_record_new (
  id             TEXT PRIMARY KEY,
  definition_id  TEXT NOT NULL REFERENCES form_definition (id),

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

INSERT INTO form_record_new
  (id, definition_id, form_version, sections, title, period, date, status, responses,
   history, links, created_by, created_at, updated_at, completed_at)
SELECT id, definition_id, form_version, sections, title, period, date, status, responses,
       history, links, created_by, created_at, updated_at, completed_at
  FROM form_record;

DROP TABLE form_record;
ALTER TABLE form_record_new RENAME TO form_record;

CREATE INDEX form_record_definition ON form_record (definition_id);
CREATE INDEX form_record_creator ON form_record (created_by);
