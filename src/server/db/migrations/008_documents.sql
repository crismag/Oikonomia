-- The document registry, and associations as records of their own.
--
-- `DOCUMENT-REGISTRY.md` §3: a document and its association with a domain
-- object are different concepts, and one document may take part in many places
-- without being duplicated. The prototype had a single `owner` on the document,
-- which is why a planning sheet could not belong to both Music Ministry and a
-- leadership meeting (its Gap 2). Associations live in their own table here.
--
-- The registry is not storage. A row says what the application knows about a
-- resource; `origin` and `url` say where the content actually is, and nothing
-- here fetches, copies or indexes it.

CREATE TABLE document (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  -- What kind of thing it is, in the leader's words, never the provider's.
  kind          TEXT NOT NULL,
  -- Where the content lives. Supporting metadata; never the organizing idea.
  origin        TEXT NOT NULL CHECK (origin IN ('binder', 'file', 'drive', 'link')),
  url           TEXT,
  file_name     TEXT,
  -- Opens inside the application, for binder-native resources.
  open_route    TEXT,
  tags          TEXT,
  registered_by TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,

  -- A resource kept somewhere else and registered without saying where is a
  -- row that cannot be opened and cannot be found again.
  CHECK (origin NOT IN ('drive', 'link') OR (url IS NOT NULL AND url <> ''))
);

CREATE TABLE document_association (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  -- The record it takes part in: 'ministry', 'meeting-note', 'gathering',
  -- 'reach-out-report', 'leadership-report', 'form', 'schedule-entry'.
  entity_type   TEXT NOT NULL,
  -- '' means the binder area as a whole rather than one record in it, which is
  -- how Reach-Out's shared working material is filed.
  entity_id     TEXT NOT NULL DEFAULT '',
  -- §3: the association carries the relationship, not just the pair. This is
  -- what lets search say "Leadership Reports › Campus Review › Supporting"
  -- instead of leaving a title unplaced.
  relationship  TEXT NOT NULL DEFAULT 'filed-in'
                CHECK (relationship IN ('filed-in', 'supporting', 'report-content')),
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,

  UNIQUE (document_id, entity_type, entity_id, relationship)
);

CREATE INDEX document_association_document ON document_association (document_id);
CREATE INDEX document_association_entity ON document_association (entity_type, entity_id);
