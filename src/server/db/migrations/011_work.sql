-- The work / review context.
--
-- The **reviewer** side of reporting. `modules/REPORTS.md` is explicit that this
-- and Leadership Reports are two perspectives on reporting and must not be
-- merged: a leader writes and submits in their binder; a reviewer reads,
-- questions, requests changes and acknowledges here.
--
-- Borrows the useful grammar of a pull request — context, working material,
-- participants, conversation, decisions, state, history — without the
-- engineering machinery.
--
-- As in the other guarded modules, nothing here stores "who may read this".
-- That is resolved from the policy by `domain/access.ts`, which returns four
-- outcomes rather than a boolean: full, limited, metadata and denied. A
-- denormalized answer would be a second one, and the two would drift.

CREATE TABLE work_context (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  subject        TEXT NOT NULL,

  -- Where the work lives: a breadcrumb into its owning source context.
  context_label  TEXT NOT NULL DEFAULT '',
  context_path   TEXT NOT NULL DEFAULT '',

  status         TEXT NOT NULL
                 CHECK (status IN ('draft', 'submitted', 'in-review', 'changes-requested',
                                   'acknowledged', 'open', 'resolved', 'closed')),
  -- The short answer to "what is the current state?", so nobody has to reread
  -- a long thread to find out where things stand.
  current_state  TEXT NOT NULL DEFAULT '',

  ministry_id    TEXT,
  campus_id      TEXT NOT NULL DEFAULT '',
  owner_id       TEXT NOT NULL,

  -- JSON arrays of person id.
  assignee_ids   TEXT NOT NULL DEFAULT '[]',
  reviewer_ids   TEXT NOT NULL DEFAULT '[]',
  participant_ids TEXT NOT NULL DEFAULT '[]',

  due            TEXT,
  period         TEXT,
  report_type    TEXT,

  -- Body sections. A section may be marked sensitive, which is what makes a
  -- `limited` decision mean something rather than being a label.
  sections       TEXT,
  artifact_ids   TEXT NOT NULL DEFAULT '[]',
  open_questions TEXT NOT NULL DEFAULT '[]',

  -- The audience policy this object is resolved against.
  policy         TEXT NOT NULL,

  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX work_context_owner ON work_context (owner_id);
CREATE INDEX work_context_status ON work_context (status);

-- What was decided, kept above the conversation rather than inside it.
--
-- `requested` is a decision that has been asked for and not yet made — the
-- distinction a reviewer queue is built on.
CREATE TABLE work_decision (
  id            TEXT PRIMARY KEY,
  work_id       TEXT NOT NULL REFERENCES work_context (id) ON DELETE CASCADE,
  summary       TEXT NOT NULL,
  decided_by_id TEXT NOT NULL,
  at            TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'recorded' CHECK (state IN ('recorded', 'requested'))
);

CREATE INDEX work_decision_work ON work_decision (work_id, at);

-- Coarse and restrained: what happened, not a keystroke log.
CREATE TABLE work_activity (
  id        TEXT PRIMARY KEY,
  work_id   TEXT NOT NULL REFERENCES work_context (id) ON DELETE CASCADE,
  at        TEXT NOT NULL,
  actor_id  TEXT,
  kind      TEXT NOT NULL,
  summary   TEXT NOT NULL
);

CREATE INDEX work_activity_work ON work_activity (work_id, at);
