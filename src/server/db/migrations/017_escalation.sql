-- Asking something of leadership, and knowing what has been read.
--
-- Oikonomia's reporting used to work one way: a leader submitted, and the
-- submission became somebody's review. Forty leaders reporting weekly produced
-- forty items for a head to process, whether or not any of them needed
-- anything. That is a product that makes work out of information.
--
-- Information is the default now. A report reaches its audience, is new until
-- somebody reads it, and then is read — and that is the whole of it. An
-- obligation exists only when a leader **asked for one**, in one of three
-- shapes, or when a leader receiving information decided something must be
-- done and created one.
--
-- Three shapes, deliberately distinct and never merged:
--
--   attention  notice this and consider it     (may end in nothing, correctly)
--   action     do this particular thing        (work, with four states)
--   approval   decide before I go ahead        (a decision, recorded)
--
-- One row here is one ask. It generates notifications and appears in views;
-- neither of those is a second work item, which is why there is no
-- notification table and no task table beside this one.

CREATE TABLE escalation (
  id     TEXT PRIMARY KEY,
  type   TEXT NOT NULL CHECK (type IN ('attention', 'action', 'approval')),

  -- Attention: raised → noted. Action: requested → assigned → in-progress →
  -- completed / unable / not-required. Approval: requested → approved /
  -- declined, with more-information as a way to ask back.
  status TEXT NOT NULL CHECK (status IN (
    'raised', 'noted',
    'requested', 'assigned', 'in-progress', 'completed', 'unable', 'not-required',
    'approved', 'declined', 'more-information'
  )),

  -- Where it came from. An escalation never copies the information it is
  -- about: it points at it, so that reading the ask and reading the report are
  -- the same record seen twice rather than two records that can disagree.
  source_type TEXT NOT NULL CHECK (source_type IN (
    'leadership-report', 'reach-out-report', 'meeting-note', 'lifegroup-entry',
    'gathering', 'goal', 'ministry', 'work'
  )),
  source_id   TEXT NOT NULL,

  -- The entry within the source, when one paragraph of a long report is the
  -- part that needs somebody. Five ordinary updates and one problem is the
  -- normal shape of a ministry report; only the problem should reach an inbox.
  entry_id    TEXT,

  -- How to name the place it came from without opening it.
  context_label TEXT NOT NULL DEFAULT '',

  -- What is being asked, in the requester's words. Required by the service: an
  -- escalation with no words is a flag, and a flag makes the recipient go and
  -- find out what was meant.
  request TEXT NOT NULL,

  requested_by TEXT NOT NULL,

  -- Addressed to a **position**, not a name: the church reorganises, and a
  -- stored name would send next year's requests to last year's leader.
  -- A specific person is still allowed where somebody means one person.
  requested_from_role   TEXT CHECK (requested_from_role IN (
    'reporting-leader', 'ministry-head', 'campus-leadership', 'church-leadership'
  )),
  requested_from_person TEXT,

  needed_by TEXT,

  -- Action only.
  assignee_id TEXT,

  -- Approval only. Who decided, when, and what they said — an approval that
  -- does not record its decider is not a record of a decision.
  decided_by    TEXT,
  decided_at    TEXT,
  decision_note TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX escalation_source ON escalation (source_type, source_id);
CREATE INDEX escalation_requested_from ON escalation (requested_from_person);
CREATE INDEX escalation_assignee ON escalation (assignee_id);

-- What happened to it, in order. Small on purpose: who did what, when.
CREATE TABLE escalation_activity (
  id            TEXT PRIMARY KEY,
  escalation_id TEXT NOT NULL REFERENCES escalation(id) ON DELETE CASCADE,
  at            TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  summary       TEXT NOT NULL,
  note          TEXT
);

CREATE INDEX escalation_activity_parent ON escalation_activity (escalation_id, at);

-- What each person has read.
--
-- A reading state, and nothing more. Unread is not a task and never becomes
-- overdue: a leader who has not opened last week's music report has not failed
-- at anything. No row means unread, which is why nothing is written until
-- somebody actually opens something.
CREATE TABLE read_state (
  person_id     TEXT NOT NULL,
  item_type     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  PRIMARY KEY (person_id, item_type, item_id)
);

-- Who a leader reports to.
--
-- Nullable, and unset by default: a church has to say what its structure is,
-- and guessing at it would be inventing an organisation. "My reporting leader"
-- resolves through this; where it is unset, the request is addressed to the
-- position that does exist rather than to a person who might not.
ALTER TABLE person ADD COLUMN reports_to_id TEXT REFERENCES person(id) ON DELETE SET NULL;
