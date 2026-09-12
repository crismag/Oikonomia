-- Configuration an administrator has changed.
--
-- Oikonomia ships with configuration in JSON files: the values a new
-- installation starts from. Those files are the **bootstrap**. This table is
-- the **storage** — what somebody decided, here, in this church.
--
-- It holds overrides rather than copies. A row exists only for a value
-- somebody actually changed, which means three useful things at once:
--
--   * upgrading Oikonomia brings new options and better wording along with it,
--     because unchanged values still come from the file;
--   * "reset to default" is a DELETE, not a guess about what the default was;
--   * the diff between what shipped and what this church decided is readable.
--
-- ## Ids are never overridden
--
-- An override may change a label, a description, whether an option is offered
-- and where it sits in a list. It may never change an `option_id`: that is the
-- value stored on every historical record, and renaming it would silently
-- detach them. Renaming is what `label` is for.
--
-- ## What may not be configured at all
--
-- Capabilities, access classifications and the meaning of a visibility level
-- are authorization. They are not in this table and must not be added to it:
-- a configuration system that can edit permissions is a permission system with
-- a worse name.

CREATE TABLE configuration_setting (
  id         TEXT PRIMARY KEY,

  -- "reports.statuses", "site.profile".
  namespace  TEXT NOT NULL,

  -- The option this overrides, or NULL for a scalar namespace where `field`
  -- names the key instead ("pageSize", "weekStartsOn").
  option_id  TEXT,
  field      TEXT,

  -- JSON, so a scalar namespace can hold a number, a string or a boolean
  -- without a column per type.
  value      TEXT NOT NULL,

  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,

  UNIQUE (namespace, option_id, field)
);

CREATE INDEX configuration_setting_namespace ON configuration_setting (namespace);

-- What was changed, by whom, and what it was before.
--
-- Configuration changes are quiet and far-reaching: renaming a status changes
-- a word on every page that shows it. "Who called this Reviewed?" has to be
-- answerable a year later, so the previous value is kept rather than
-- overwritten.
CREATE TABLE configuration_change (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  namespace  TEXT NOT NULL,
  option_id  TEXT,
  field      TEXT,
  before     TEXT,
  after      TEXT NOT NULL,
  summary    TEXT NOT NULL
);

CREATE INDEX configuration_change_at ON configuration_change (at);
