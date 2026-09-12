-- The organisation: who exists, where they gather, and under what ministry.
--
-- Until now these were fixtures compiled into the application, which meant a
-- fresh installation of Oikonomia arrived already containing a church — three
-- campuses, four ministries and ninety-one people who had never been entered
-- by anyone. Everything else in the product then referred to them, so the
-- fiction reached every page.
--
-- These are **records**, not configuration. A campus is a real place somebody
-- decided to name; a person is a real person somebody added. An installation
-- with none of them is a correct installation that nobody has set up yet, and
-- every page must be able to say so.
--
-- What stays hard-coded is vocabulary, not instances: the four access roles,
-- the venue types, the entry categories. Those are what the product *means*,
-- and they are defined in `src/domain/`.

CREATE TABLE campus (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE person (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  initials TEXT NOT NULL,

  -- What they are called in the church: "LifeGroup leader", "Bishop".
  -- Descriptive. It grants nothing.
  role     TEXT NOT NULL DEFAULT '',

  -- What they may do in Oikonomia. Four values, defined in the product, and
  -- the only one of these two that any access rule reads.
  access_role TEXT NOT NULL DEFAULT 'leader'
    CHECK (access_role IN ('leader', 'ministry-head', 'bishop', 'admin')),

  -- How a session finds this person once authentication is real. Unique when
  -- present, so two accounts cannot silently become one.
  email    TEXT UNIQUE,

  campus_id TEXT REFERENCES campus(id) ON DELETE SET NULL,

  created_at TEXT NOT NULL
);

CREATE TABLE ministry (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  purpose   TEXT NOT NULL DEFAULT '',
  campus_id TEXT REFERENCES campus(id) ON DELETE SET NULL,

  -- A ministry exists independently of whoever currently leads it, so this is
  -- nullable and clearing a person does not delete the ministry.
  lead_id   TEXT REFERENCES person(id) ON DELETE SET NULL,

  created_at TEXT NOT NULL
);

-- Membership is its own record: a person belongs to several ministries, and
-- `shared` marks somebody given sight of a ministry's information without
-- being part of its team.
CREATE TABLE ministry_member (
  ministry_id TEXT NOT NULL REFERENCES ministry(id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  shared      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (ministry_id, person_id)
);

CREATE TABLE venue (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('residence', 'church', 'park', 'public-place', 'other')),
  host_id  TEXT REFERENCES person(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES campus(id) ON DELETE SET NULL,
  area     TEXT,
  -- Held apart from the name because a home address is often restricted.
  address  TEXT,
  notes    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_person_campus ON person(campus_id);
CREATE INDEX idx_ministry_campus ON ministry(campus_id);
CREATE INDEX idx_ministry_member_person ON ministry_member(person_id);
