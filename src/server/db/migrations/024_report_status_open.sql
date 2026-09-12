-- The stages a report moves through are no longer pinned in SQL either.
--
-- Migration 022 removed the CHECK on `visibility` and deliberately kept the
-- one on `status`, on the grounds that stages were reached through four named
-- actions the application owned — publish, share, archive, reopen — so no
-- other value could be produced. That reasoning was correct, and it was the
-- coupling: the four names *were* the workflow, which is why a church could
-- rename a stage but never add or remove one.
--
-- The four actions are gone. A move is now a move to a status this church
-- offers, and what it does is derived from that status's behaviours —
-- `planTransition` in `domain/leadership-report.ts`. Leaving the CHECK behind
-- would reproduce exactly the failure the configuration audit set out to
-- find: the administrator adds a stage, the screen offers it, and the database
-- refuses the row.
--
-- ## Why removing it is safe
--
-- The CHECK was never what protected a report. What a status *means* is read
-- from its behaviours, and an unrecognised status resolves to **not editable,
-- not current, not visible to its audience** — the closed answer. A corrupt
-- value therefore freezes a report rather than opening it, with or without a
-- constraint.
--
-- Validation moved to where the registry can be consulted: `report-contract.ts`
-- accepts only stages the church currently offers, and the service is the only
-- writer.
--
-- The column keeps `NOT NULL`. Its default stays as a last-resort value for a
-- direct insert; the service always supplies `initialStatus()`.
--
-- SQLite cannot drop a CHECK, so the table is rebuilt. Every column, every
-- row and every index is preserved.

CREATE TABLE leadership_report_new (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL DEFAULT '',
  report_type           TEXT NOT NULL,
  author_id             TEXT NOT NULL,

  subject_text          TEXT,
  subject_id            TEXT,
  reporting_period      TEXT,

  -- No CHECK: the stages are configuration too. See the note above.
  status                TEXT NOT NULL DEFAULT 'draft',

  -- No CHECK: the audience choices are configuration, and the strategy each
  -- one names is what enforcement reads.
  visibility            TEXT NOT NULL DEFAULT 'leadership',

  discussion_policy     TEXT NOT NULL DEFAULT 'viewers'
                        CHECK (discussion_policy IN ('disabled', 'viewers', 'selected')),
  content_source        TEXT NOT NULL DEFAULT 'native'
                        CHECK (content_source IN ('native', 'linked-document')),

  audience_ids          TEXT NOT NULL DEFAULT '[]',
  commenter_ids         TEXT,

  blocks                TEXT,
  primary_document_id   TEXT,
  related_document_ids  TEXT NOT NULL DEFAULT '[]',
  related_text          TEXT,

  links                 TEXT NOT NULL DEFAULT '[]',
  tags                  TEXT NOT NULL DEFAULT '[]',

  version               INTEGER NOT NULL DEFAULT 1,

  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  published_at          TEXT,
  archived_at           TEXT,

  context_type          TEXT,
  context_id            TEXT,
  category              TEXT NOT NULL DEFAULT 'general'
);

INSERT INTO leadership_report_new
SELECT id, title, report_type, author_id, subject_text, subject_id, reporting_period,
       status, visibility, discussion_policy, content_source, audience_ids, commenter_ids,
       blocks, primary_document_id, related_document_ids, related_text, links, tags,
       version, created_at, updated_at, published_at, archived_at,
       context_type, context_id, category
  FROM leadership_report;

DROP TABLE leadership_report;
ALTER TABLE leadership_report_new RENAME TO leadership_report;

CREATE INDEX leadership_report_author ON leadership_report (author_id);
CREATE INDEX leadership_report_subject ON leadership_report (subject_id);
CREATE INDEX leadership_report_context ON leadership_report (context_type, context_id);
CREATE INDEX leadership_report_category ON leadership_report (category);
