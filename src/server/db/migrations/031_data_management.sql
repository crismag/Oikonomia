-- Moving, preserving and recovering what the church has written.
--
-- Three tables, for three different things that are easy to collapse into one.
--
-- ## `data_job` — one operation, and what became of it
--
-- Export, import, backup, restore and retention are long enough, and
-- consequential enough, that "it worked" has to be a record rather than a
-- toast somebody may have missed. A job carries its **scope** as selectors
-- rather than as a query: `{"type":"ministry","ministryId":"min_1"}` is
-- something the service can check somebody is allowed to ask for. A raw SQL
-- string would not be.
--
-- `execution_actor` separates a person's export from a scheduled backup. The
-- scheduler is not an administrator with a login; recording it as one would
-- make the audit trail lie about who did what.
--
-- ## `data_audit` — who did a sensitive thing
--
-- Separate from `data_job` because the questions differ. A job is *what is
-- happening*; an audit row is *what happened and who asked*, and it is never
-- rewritten. Exports name a scope and a count, never the content: an audit log
-- that quotes the confidential report it exported has widened the disclosure it
-- was meant to record.
--
-- ## `retention_policy` — how long a copy lives
--
-- Configurable per class of artifact, because a staged download and a disaster
-- recovery backup have nothing in common but the word "file". Deleting the
-- wrong one is how a church loses its history, so a policy is a record with an
-- author and a date rather than a constant.

CREATE TABLE data_job (
  id                TEXT PRIMARY KEY,

  -- export | import | backup | restore | retention | archive
  operation         TEXT NOT NULL,

  -- Who asked. Null for the system actor.
  requested_by      TEXT REFERENCES person(id) ON DELETE SET NULL,
  -- 'user' or 'system'. A scheduled backup is not somebody's action.
  execution_actor   TEXT NOT NULL DEFAULT 'user',

  -- Selectors, never SQL. What the service checks authorization against.
  scope_type        TEXT NOT NULL,
  scope_json        TEXT NOT NULL DEFAULT '{}',

  format            TEXT,
  destination       TEXT NOT NULL DEFAULT 'download',

  -- queued | validating | preview_ready | running | completed
  -- | validation_failed | failed | cancelled | expired
  status            TEXT NOT NULL DEFAULT 'queued',
  progress          INTEGER NOT NULL DEFAULT 0,

  -- What produced it, so an old artifact can be read or refused knowingly.
  schema_version    INTEGER,
  application_version TEXT,

  requested_at      TEXT NOT NULL,
  started_at        TEXT,
  completed_at      TEXT,
  -- When the staged artifact stops being downloadable and is deleted.
  expires_at        TEXT,

  -- Opaque. Never a filesystem path: a path in a response is a way to ask for
  -- another one.
  artifact_ref      TEXT,
  artifact_bytes    INTEGER,
  checksum          TEXT,

  record_count      INTEGER,
  -- What was left out because the requester may not have it. A count, never
  -- a list — saying which records were skipped describes records they were
  -- not allowed to know exist.
  withheld_count    INTEGER NOT NULL DEFAULT 0,

  error_code        TEXT,
  error_summary     TEXT
);

CREATE INDEX data_job_requested ON data_job (requested_at DESC);
CREATE INDEX data_job_operation ON data_job (operation, status);
CREATE INDEX data_job_expiry ON data_job (expires_at);

CREATE TABLE data_audit (
  id             TEXT PRIMARY KEY,
  at             TEXT NOT NULL,

  actor_type     TEXT NOT NULL DEFAULT 'user',
  actor_id       TEXT REFERENCES person(id) ON DELETE SET NULL,

  -- export.requested, export.downloaded, import.committed, backup.verified …
  action         TEXT NOT NULL,
  scope_type     TEXT,
  scope_json     TEXT,
  job_id         TEXT REFERENCES data_job(id) ON DELETE SET NULL,

  result         TEXT NOT NULL DEFAULT 'ok',
  record_count   INTEGER,

  -- Anything worth keeping that is safe to keep. Never exported content.
  metadata       TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX data_audit_at ON data_audit (at DESC);
CREATE INDEX data_audit_action ON data_audit (action);

CREATE TABLE retention_policy (
  artifact_class TEXT PRIMARY KEY,
  retention_days INTEGER NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  -- A hold stops deletion regardless of age, for a church under an obligation
  -- to keep something.
  on_hold        INTEGER NOT NULL DEFAULT 0,
  updated_by     TEXT REFERENCES person(id) ON DELETE SET NULL,
  updated_at     TEXT NOT NULL
);

-- Starting values, chosen conservatively: a staged download is short-lived
-- because it sits on the server unencrypted, and a backup outlives it by a lot
-- because losing backups is the failure that cannot be undone.
INSERT INTO retention_policy (artifact_class, retention_days, enabled, updated_at) VALUES
  ('export',  1,  1, datetime('now')),
  ('import',  1,  1, datetime('now')),
  ('backup',  30, 1, datetime('now')),
  ('archive', 3650, 1, datetime('now'));
