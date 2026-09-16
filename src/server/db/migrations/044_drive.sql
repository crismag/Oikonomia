-- Google Drive behind the binder's documents.
--
-- Files live in Drive; the binder keeps the record. Two facts are new:
--
-- 1. **A ministry's Drive folder.** Created under the church's Drive root by
--    the church mailbox the first time someone adds a file to the ministry, and
--    remembered here so it is created once. Its own table rather than a column
--    on `ministry`: most installations have no Workspace, and a ministry is not
--    less of a ministry for having no folder.
-- 2. **Which Drive file a document is.** The web address alone was all a leader
--    could paste; the file id is what Drive answers questions about (its name
--    now, who owns it, when it last changed). `drive_mime_type` says what kind
--    of file it was when registered. No file content is ever stored here.

CREATE TABLE ministry_drive_folder (
  ministry_id TEXT PRIMARY KEY REFERENCES ministry(id) ON DELETE CASCADE,
  folder_id   TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

ALTER TABLE document ADD COLUMN drive_file_id TEXT;
ALTER TABLE document ADD COLUMN drive_mime_type TEXT;

CREATE INDEX document_drive_file ON document (drive_file_id) WHERE drive_file_id IS NOT NULL;
