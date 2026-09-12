-- The audience choices a church may offer are no longer pinned in SQL.
--
-- `leadership_report.visibility` carried `CHECK (visibility IN ('private',
-- 'restricted', 'leadership', 'shared'))`. That constraint duplicated a list
-- the configuration registry owns, and duplication is how configuration turns
-- into decoration: an administrator could add an audience choice, the screen
-- would offer it, the form would show it — and the database would refuse the
-- row.
--
-- ## Why removing it is safe
--
-- The constraint was never what made a report confidential. What decides
-- access is the **access strategy** the choice names, resolved by
-- `accessStrategyOf` — a closed set the application owns — and a value naming
-- no strategy resolves to `owner-only`, the narrowest answer there is. So an
-- unrecognised visibility closes a report rather than opening it, with or
-- without a CHECK.
--
-- Validation did not disappear; it moved to where the registry can be
-- consulted. `report-contract.ts` accepts only choices the church currently
-- offers, and the service is the only writer.
--
-- ## What is deliberately still constrained
--
-- `status` keeps its CHECK. Report stages are reached through the actions the
-- application offers — publish, share, archive, reopen — so a value outside
-- that list cannot be produced by any code path, and a row carrying one would
-- be corruption rather than configuration.
--
-- SQLite cannot drop a CHECK, so the table is rebuilt. Every column, every
-- row, both indexes and the added context columns are preserved.

CREATE TABLE leadership_report_new (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL DEFAULT '',
  report_type           TEXT NOT NULL,
  author_id             TEXT NOT NULL,

  subject_text          TEXT,
  subject_id            TEXT,
  reporting_period      TEXT,

  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'shared', 'published', 'archived')),

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
