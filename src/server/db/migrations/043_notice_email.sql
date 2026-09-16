-- Which notices each person has asked to receive by email.
--
-- A row means "email me about this kind"; no row means no. Every kind is off
-- until the person turns it on, so an upgraded installation sends nothing new
-- to anybody. `kind` is text rather than constrained here because the kinds
-- are named in `src/domain/email-notices.ts` and validated at the write
-- boundary: a new kind is a line of code, not a table rebuild.
--
-- Deleting a person removes their preferences with them.
CREATE TABLE notice_email_preference (
  person_id  TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  enabled_at TEXT NOT NULL,
  PRIMARY KEY (person_id, kind)
);
