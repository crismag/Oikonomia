-- Vertical Slice E — Reach-Out.
--
-- Reach-Out is a **top-level leadership reporting area**, not a ministry and
-- not a CRM. It holds reports, and the people a report mentions are named in
-- its text rather than tracked as records with a pipeline
-- 
--
-- The report is shared leadership work: `author_id` is who wrote it first and
-- is provenance, never ownership. Any leader may continue any report, and the
-- contributors list says who has.

CREATE TABLE reach_out_report (
  id            TEXT PRIMARY KEY,

  title         TEXT NOT NULL,
  -- The date the report is *about*, which is not when it was typed up.
  report_date   TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',

  author_id     TEXT NOT NULL,
  -- Other leaders who have since worked on it, oldest contribution first.
  contributors  TEXT,           -- JSON array of person id

  -- Reserved for the binder-wide audience model. Sharing rules for Reach-Out
  -- are an open product decision, so this is stored and read by nothing —
  -- deliberately empty rather than filled in with a guess.
  policy        TEXT,

  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX reach_out_report_date ON reach_out_report (report_date DESC);
CREATE INDEX reach_out_report_author ON reach_out_report (author_id);

-- §14's generic comment model. Reach-Out is its only writer today; the parent
-- columns exist because §14 describes the shape and because a comment that
-- could only ever belong to one kind of thing would have to be rebuilt the
-- first time something else needed one.
--
-- Deliberately not built: mentions, reactions, threading, notifications,
-- moderation. §14 rules all five out.
CREATE TABLE comment (
  id          TEXT PRIMARY KEY,

  parent_type TEXT NOT NULL,
  parent_id   TEXT NOT NULL,

  author_id   TEXT NOT NULL,
  body        TEXT NOT NULL,

  -- A section or row the comment is about, when it is about one.
  target      TEXT,
  -- Written by the application rather than by a person — "marked complete".
  system      INTEGER NOT NULL DEFAULT 0,

  created_at  TEXT NOT NULL,
  edited_at   TEXT
);

CREATE INDEX comment_parent ON comment (parent_type, parent_id, created_at);
