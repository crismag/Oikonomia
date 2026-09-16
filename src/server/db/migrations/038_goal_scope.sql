-- What a goal belongs to, stated rather than guessed.
--
-- A goal used to be read as personal or a ministry's from which of `owner_id`
-- and `ministry_id` happened to be set. Both are set on a leader's personal
-- goal that relates to a ministry *and* on a ministry's goal with a leader
-- responsible for it, so the two could not be told apart — and pages that
-- guessed either way pooled one leader's goals with another's.
--
--   personal  a leader's own goal. `owner_id` is that leader; a ministry, if
--             any, is only what it relates to.
--   ministry  the ministry's goal. `ministry_id` is the ministry.
--   other     a goal of another group the church has named. `group_id` is
--             that group.
--
-- Existing rows: before this migration the application only ever created a
-- goal with an owner and no ministry, so an owned goal without a ministry is
-- personal. A goal filed under a ministry was put there on purpose, so it is
-- the ministry's. A goal with neither belongs to no one person and is other.
ALTER TABLE goal ADD COLUMN scope TEXT NOT NULL DEFAULT 'personal'
  CHECK (scope IN ('personal', 'ministry', 'other'));

ALTER TABLE goal ADD COLUMN group_id TEXT;

UPDATE goal SET scope = 'ministry' WHERE ministry_id IS NOT NULL;
UPDATE goal SET scope = 'other' WHERE ministry_id IS NULL AND owner_id IS NULL;

CREATE INDEX goal_scope ON goal (year, scope);
