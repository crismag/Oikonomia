-- Responsibility groups: the church's own leadership bodies.
--
-- "Central leadership" and "campus leaders" were two constants in the source
-- code, and membership of them was faked by putting a group id into a person's
-- **ministry** list. Two things were wrong with that, and the second is worse.
--
-- A group is not a ministry. A pastoral team, a deacons' board, a safeguarding
-- panel and a campus leadership team are bodies people belong to for a reason
-- that has nothing to do with which ministry they serve in; storing one as the
-- other meant the model could not tell "leads the music ministry" from "sits on
-- the leadership team".
--
-- And once the fixture church was removed, **nobody was in either group** —
-- because nothing creates a ministry membership with those ids. A report shared
-- with "Leadership" reached its author and no one else, silently. Configuration
-- that resolves to an empty audience is worse than one that fails: it looks
-- like sharing and is not.
--
-- So a group is a record the church creates, like a ministry or a campus.
--
-- ## Which groups the "leadership audience" means
--
-- `leadership_audience` marks a group as one of the bodies a report set to the
-- leadership audience reaches. It is a property of the group rather than a
-- hard-coded pair of ids, so a church with one leadership team, or four, is
-- describable. A church that marks none has no leadership audience — and a
-- report set to it then reaches only its author, which is the safe direction.

CREATE TABLE responsibility_group (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',

  -- Optional: a group may belong to one campus, or to the whole church.
  campus_id   TEXT REFERENCES campus(id) ON DELETE SET NULL,

  -- Whether reports set to the leadership audience reach this group.
  leadership_audience INTEGER NOT NULL DEFAULT 0,

  -- Groups are deactivated rather than deleted: membership is history, and a
  -- report whose audience was this group must stay interpretable.
  active      INTEGER NOT NULL DEFAULT 1,

  created_at  TEXT NOT NULL
);

CREATE TABLE responsibility_group_member (
  group_id   TEXT NOT NULL REFERENCES responsibility_group(id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, person_id)
);

CREATE INDEX responsibility_group_member_person ON responsibility_group_member (person_id);
CREATE INDEX responsibility_group_leadership ON responsibility_group (leadership_audience);
