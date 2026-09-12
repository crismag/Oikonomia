-- Where somebody is in setting themselves up.
--
-- Onboarding owns **workflow state and nothing else**. It does not own
-- ministries, groups, roles, memberships, the reporting line or any permission:
-- those are the organisation's records, and onboarding reads them, asks the
-- person to confirm them, and writes back only through the assignment service —
-- which turns what a person says about themselves into a claim awaiting
-- confirmation rather than into membership.
--
-- So this table holds four things: how far they got, which version of the
-- process they completed, and when they started and finished.
--
-- ## Why a version
--
-- A church that adds a required confirmation next year should not drag
-- everybody back through the welcome screen. Recording which version somebody
-- completed makes "you have one new thing to confirm" expressible; recording
-- only a boolean does not.
--
-- ## Why a step
--
-- Closing the browser halfway through must not lose what was already
-- confirmed. The step is where to resume, and every step's effects are written
-- as they happen rather than at the end — there is no draft of an organisation.
--
-- One row per person. The row's absence means not started, which is the
-- correct state for everybody who existed before this table did: they see
-- onboarding once, and what it shows them is the organisation as it already
-- stands.

CREATE TABLE onboarding_state (
  person_id      TEXT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,

  -- 'in-progress' or 'complete'. Absent row means not started.
  status         TEXT NOT NULL DEFAULT 'in-progress',

  -- Where to resume. A step id, not an index: inserting a step must not send
  -- everybody who was on step 4 to a different question.
  step           TEXT NOT NULL DEFAULT 'welcome',

  -- Which version of the process was completed. Compared against the version
  -- the application currently requires.
  version        INTEGER NOT NULL DEFAULT 0,

  started_at     TEXT NOT NULL,
  completed_at   TEXT,

  updated_at     TEXT NOT NULL
);
