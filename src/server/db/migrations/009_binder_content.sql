-- What a binder-native document actually says.
--
-- Deliberately **not** a column on `document`. Invariant 7 of
-- `DOCUMENT-REGISTRY.md`: the registry is not a repository or a storage system.
-- It records that a resource exists, what it is called and where it lives; this
-- table is one of the places a resource can live, and it happens to be the only
-- one the application itself keeps.
--
-- Only binder-native documents have a row here. A Drive document or a link has
-- a registry record and no content, which is exactly the distinction the
-- registry exists to express.

CREATE TABLE document_content (
  document_id TEXT PRIMARY KEY REFERENCES document (id) ON DELETE CASCADE,

  -- The same block list Meeting Notes writes: structure lives in the list,
  -- and each block holds only inline marks. One editor, one shape.
  blocks      TEXT NOT NULL DEFAULT '[]',

  -- Part of the WHERE on save, so two writers cannot both pass through a gap
  -- between reading a version and writing it.
  version     INTEGER NOT NULL DEFAULT 1,

  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);
