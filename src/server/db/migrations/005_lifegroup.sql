-- Vertical Slice D — LifeGroup.
--
-- Three tables. A gathering is an occasion; attendance is who was at it;
-- entries are what was said worth remembering. There is deliberately **no
-- group and no membership table** — a LifeGroup gathering is a date at a venue
-- with assigned leaders, and a permanent roster is the model this product
-- removed on purpose.
--
-- The exhortation and the leader's report are folded into `gathering` rather
-- than given tables of their own. Both are strictly one-per-gathering, always
-- read with it, and never queried apart from it — and the report's completion
-- has to stay consistent with the gathering's status, which is easier when
-- they are the same row.

CREATE TABLE gathering (
  id            TEXT PRIMARY KEY,

  date          TEXT NOT NULL,
  start_time    TEXT,
  end_time      TEXT,

  -- A venue is reused, never owned. `venue_name` is the snapshot taken when
  -- the gathering was created, so a gathering never loses its identity because
  -- a venue record changed.
  venue_id      TEXT NOT NULL,
  venue_name    TEXT,
  host_id       TEXT,
  campus_id     TEXT,

  -- Leaders assigned to *this occurrence*. May be several, and may change.
  assigned_leaders TEXT NOT NULL DEFAULT '[]',   -- JSON array of person id

  -- Who said they were coming, transcribed from the signup poll. Intended
  -- attendance, kept apart from who actually came.
  expected_attendees TEXT,                        -- JSON array of person id

  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned', 'open', 'completed', 'cancelled')),

  -- The exhortation. Absent exactly when there is no topic: a topic is what
  -- makes one, and "recorded with nothing in it" is not a state the leader
  -- can reach.
  exhortation_topic     TEXT,
  exhortation_scripture TEXT,
  exhortation_notes     TEXT,
  exhortation_given_by  TEXT,

  -- The leader's write-up. `report_completed_at` is what makes a gathering
  -- reported, and it can be cleared — finishing a report must never feel
  -- irreversible.
  report_summary        TEXT,
  report_completed_at   TEXT,
  report_completed_by   TEXT,

  created_by    TEXT,
  updated_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX gathering_date ON gathering (date DESC);
CREATE INDEX gathering_venue ON gathering (venue_id);

CREATE TABLE gathering_attendance (
  id           TEXT PRIMARY KEY,
  gathering_id TEXT NOT NULL REFERENCES gathering (id) ON DELETE CASCADE,

  -- One of the two. A person who is in the directory is marked by id; a
  -- walk-in the leader does not know yet is marked by name, and inventing a
  -- person record for them would be the CRM this product is not.
  person_id    TEXT,
  name         TEXT,

  status       TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
  expected     INTEGER NOT NULL DEFAULT 0,
  first_time   INTEGER NOT NULL DEFAULT 0,

  created_at   TEXT NOT NULL,

  CHECK (person_id IS NOT NULL OR name IS NOT NULL),
  -- One mark per person per gathering. Marking somebody twice is not a
  -- correction, it is two contradictory records of the same evening.
  UNIQUE (gathering_id, person_id)
);

CREATE INDEX gathering_attendance_gathering ON gathering_attendance (gathering_id);
CREATE INDEX gathering_attendance_person ON gathering_attendance (person_id);

CREATE TABLE lifegroup_entry (
  id           TEXT PRIMARY KEY,
  gathering_id TEXT NOT NULL REFERENCES gathering (id) ON DELETE CASCADE,

  author_id    TEXT NOT NULL,
  body         TEXT NOT NULL,

  -- Optional. An uncategorized entry is a perfectly good entry: categories
  -- organize the record and never gate it.
  category     TEXT,

  -- Who may read it. Absent means `leaders`. This is the most sensitive field
  -- in the product so far — entries carry prayer requests and concerns about
  -- named people — and it is enforced in the service, never in a screen.
  visibility   TEXT CHECK (visibility IN ('leaders', 'assigned-leaders', 'selected-viewers', 'private')),
  viewer_ids   TEXT,           -- JSON array, for `selected-viewers`

  -- Progressive enrichment. None of it is required at capture, because a
  -- leader writing during a gathering must not be asked to classify first.
  person_id    TEXT,
  assigned_to  TEXT,
  due_date     TEXT,
  completed    INTEGER NOT NULL DEFAULT 0,
  reportable   INTEGER NOT NULL DEFAULT 0,

  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX lifegroup_entry_gathering ON lifegroup_entry (gathering_id, created_at);
