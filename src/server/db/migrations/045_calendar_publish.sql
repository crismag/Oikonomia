-- Which Oikonomia records are published to the church's Google Calendar.
--
-- Oikonomia stays the source of truth for church events; Google holds a copy
-- the church can subscribe to. One row per published record remembers the
-- Google event it became, so a change updates that event rather than adding a
-- second one, and a removal knows what to delete.
--
-- `calendar_id` is kept per row: if the church points publishing at another
-- calendar, a row naming the old one is not an event in the new one, and is
-- published afresh there.
--
-- `last_error` is for the administrator. A failure to reach Google never
-- undoes or blocks the leader's own change; it is recorded here and retried by
-- "Publish all events".
CREATE TABLE calendar_publication (
  source_type     TEXT NOT NULL CHECK (source_type IN ('schedule-entry', 'gathering')),
  source_id       TEXT NOT NULL,
  calendar_id     TEXT NOT NULL,
  google_event_id TEXT,
  last_synced_at  TEXT,
  last_attempt_at TEXT NOT NULL,
  last_error      TEXT,
  PRIMARY KEY (source_type, source_id)
);
