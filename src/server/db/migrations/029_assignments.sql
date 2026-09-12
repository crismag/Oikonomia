-- Where a person serves, what they do there, and whether anybody has said so.
--
-- Membership used to be a bare pair of ids: this person is in this group. That
-- answered one of the four questions the organisation actually asks.
--
--   Where does this person serve?          — the pair answered this
--   What do they do there?                 — nothing recorded it
--   Is that current, or is it history?     — nothing recorded it
--   Did the church say so, or did they?    — nothing recorded it
--
-- The last one is the one that matters. Onboarding asks a leader which
-- ministries they are part of, and their answer must not become an
-- authoritative organisational fact by being typed into a form. So a membership
-- now carries a **status**, and what a person says about themselves is
-- `pending` until somebody who may decide confirms it.
--
-- ## Function is contextual
--
-- Somebody may be a head in one ministry, a member of a committee and a
-- coordinator on a team. `function` is free text on the assignment, not a
-- global title on the person: what they do is contextual, and their record
-- already carries the one title the church calls them by.
--
-- **`function` grants nothing.** It is what the church calls the job. Naming
-- somebody "Head" here gives them no capability — authorization reads
-- capabilities, membership and ownership, and never a label. See
-- `roles-are-not-permissions.test.ts`.
--
-- ## Ended, not deleted
--
-- An assignment that is over is `ended`, with the date it ended. A leader who
-- transferred ministries last year led that ministry last year, and a report
-- they filed then was filed by its head. Rewriting membership would rewrite
-- the history the reports sit in.
--
-- ## Both tables, on purpose
--
-- Ministries are not a kind of responsibility group — they carry goals,
-- documents and a lead — so they keep their own membership table. The columns
-- are identical so that one query can union them into a single answer to
-- "where does this person serve", which is what `assignmentsFor` does. Two
-- storages, one authoritative answer.
--
-- Existing rows default to `confirmed`: they were entered by an administrator,
-- which is exactly what confirmed means.

ALTER TABLE responsibility_group_member ADD COLUMN function TEXT NOT NULL DEFAULT '';
ALTER TABLE responsibility_group_member ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE responsibility_group_member ADD COLUMN started_at TEXT;
ALTER TABLE responsibility_group_member ADD COLUMN ended_at TEXT;

ALTER TABLE ministry_member ADD COLUMN function TEXT NOT NULL DEFAULT '';
ALTER TABLE ministry_member ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE ministry_member ADD COLUMN started_at TEXT;
ALTER TABLE ministry_member ADD COLUMN ended_at TEXT;

-- A group may be a committee, a team, a leadership body, a working group. The
-- kinds are configuration — a church names its own — and what a group *does*
-- is decided by its own fields (`leadership_audience`, `campus_id`), never by
-- what kind it is called.
ALTER TABLE responsibility_group ADD COLUMN group_type TEXT NOT NULL DEFAULT 'team';

-- Optional parent, for a church whose structure nests: a worship ministry with
-- a music team and a technical team under it. No group is required to have one,
-- and nothing infers authority from the nesting — it is structure, not policy.
ALTER TABLE responsibility_group ADD COLUMN parent_group_id TEXT
  REFERENCES responsibility_group(id) ON DELETE SET NULL;

CREATE INDEX responsibility_group_parent ON responsibility_group (parent_group_id);
CREATE INDEX ministry_member_person ON ministry_member (person_id);
