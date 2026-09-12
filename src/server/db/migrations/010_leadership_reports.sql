-- Leadership Reports.
--
-- The most guarded records in the binder. A report may be an evaluation of a
-- person, a pastoral note, or an ordinary monthly update, and which of those it
-- is decides who may know it exists at all.
--
-- Two things are deliberately *not* in this schema:
--
--   * No permission columns beyond the audience the report itself names.
--     Whether a viewer is an audience is decided by `domain/access.ts` from the
--     visibility, the named audience and the viewer's persona and groups. A
--     denormalized "who may read" column would be a second answer to a question
--     that already has one, and the two would drift.
--
--   * No comment table. Comments live in the generic `comment` table from
--     migration 006, under `parent_type = 'leadership-report'`.

CREATE TABLE leadership_report (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL DEFAULT '',
  report_type           TEXT NOT NULL,
  author_id             TEXT NOT NULL,

  -- What the report is about. `subject_text` is what the leader typed;
  -- `subject_id` is set only when that resolved to a known person, so a report
  -- about "the Thursday team" stays valid and resolves to nobody.
  subject_text          TEXT,
  subject_id            TEXT,
  reporting_period      TEXT,

  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'shared', 'published', 'archived')),
  visibility            TEXT NOT NULL DEFAULT 'leadership'
                        CHECK (visibility IN ('private', 'restricted', 'leadership', 'shared')),
  discussion_policy     TEXT NOT NULL DEFAULT 'viewers'
                        CHECK (discussion_policy IN ('disabled', 'viewers', 'selected')),
  content_source        TEXT NOT NULL DEFAULT 'native'
                        CHECK (content_source IN ('native', 'linked-document')),

  -- JSON arrays of person id.
  audience_ids          TEXT NOT NULL DEFAULT '[]',
  commenter_ids         TEXT,

  -- Authoritative when `content_source` is 'native'.
  blocks                TEXT,
  -- Identifies the external content when it is 'linked-document'.
  primary_document_id   TEXT,
  related_document_ids  TEXT NOT NULL DEFAULT '[]',
  related_text          TEXT,

  -- Binder records this relates to. References, never grants.
  links                 TEXT NOT NULL DEFAULT '[]',
  tags                  TEXT NOT NULL DEFAULT '[]',

  -- Part of the WHERE on save, so two writers cannot both pass through a gap
  -- between reading a version and writing it.
  version               INTEGER NOT NULL DEFAULT 1,

  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  published_at          TEXT,
  archived_at           TEXT
);

CREATE INDEX leadership_report_author ON leadership_report (author_id);
CREATE INDEX leadership_report_subject ON leadership_report (subject_id);

-- What the report said before each publish.
--
-- Kept because a published report is a record of what was said at the time, and
-- reopening it to say something else must not quietly erase that.
CREATE TABLE report_revision (
  id         TEXT PRIMARY KEY,
  report_id  TEXT NOT NULL REFERENCES leadership_report (id) ON DELETE CASCADE,
  revision   INTEGER NOT NULL,
  blocks     TEXT NOT NULL DEFAULT '[]',
  actor_id   TEXT NOT NULL,
  at         TEXT NOT NULL,
  note       TEXT,

  UNIQUE (report_id, revision)
);

-- Coarse, restrained: what happened to the report, not a keystroke log.
CREATE TABLE report_activity (
  id         TEXT PRIMARY KEY,
  report_id  TEXT NOT NULL REFERENCES leadership_report (id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  actor_id   TEXT,
  kind       TEXT NOT NULL,
  summary    TEXT NOT NULL
);

CREATE INDEX report_activity_report ON report_activity (report_id, at);
