-- The LifeGroup schedule as a shared roster.
--
-- Two changes, both following from the same correction: the schedule is a
-- collaborative operational record several leaders maintain together, not a
-- form one person completes.
--
--   * A row may exist before its details do. "Somewhere in Markham, leader
--     needed" is a real state of the roster, and requiring a venue to add a row
--     is what made this a form in the first place. SQLite cannot drop a NOT
--     NULL in place, so the table is rebuilt.
--
--   * `primary_leader_id` names whoever is carrying a gathering when the
--     leaders have said. Informational: several leaders share a gathering, and
--     naming one says who to ask, never who owns it. Assignment lives in
--     `assigned_leaders`, which was already many-to-many.

CREATE TABLE gathering_new (
  id            TEXT PRIMARY KEY,

  date          TEXT NOT NULL,
  start_time    TEXT,
  end_time      TEXT,

  -- Now nullable: a row on the roster before anyone has settled where.
  venue_id      TEXT,
  venue_name    TEXT,
  host_id       TEXT,
  campus_id     TEXT,

  assigned_leaders TEXT NOT NULL DEFAULT '[]',
  -- Whoever is carrying it. Never an owner.
  primary_leader_id TEXT,

  expected_attendees TEXT,

  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned', 'assigned', 'confirmed', 'open', 'completed', 'cancelled')),

  exhortation_topic     TEXT,
  exhortation_scripture TEXT,
  exhortation_notes     TEXT,
  exhortation_given_by  TEXT,

  report_summary        TEXT,
  report_completed_at   TEXT,
  report_completed_by   TEXT,

  created_by    TEXT,
  updated_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

INSERT INTO gathering_new (
  id, date, start_time, end_time, venue_id, venue_name, host_id, campus_id,
  assigned_leaders, expected_attendees, status,
  exhortation_topic, exhortation_scripture, exhortation_notes, exhortation_given_by,
  report_summary, report_completed_at, report_completed_by,
  created_by, updated_by, created_at, updated_at
)
SELECT
  id, date, start_time, end_time, venue_id, venue_name, host_id, campus_id,
  assigned_leaders, expected_attendees,
  -- A row that already has leaders is assigned, not merely planned. Rows that
  -- have moved past that keep the stage they were in.
  CASE
    WHEN status = 'planned' AND assigned_leaders <> '[]' THEN 'assigned'
    ELSE status
  END,
  exhortation_topic, exhortation_scripture, exhortation_notes, exhortation_given_by,
  report_summary, report_completed_at, report_completed_by,
  created_by, updated_by, created_at, updated_at
FROM gathering;

DROP TABLE gathering;
ALTER TABLE gathering_new RENAME TO gathering;

CREATE INDEX gathering_date ON gathering (date DESC);
CREATE INDEX gathering_venue ON gathering (venue_id);
