-- One stored value per configuration key.
--
-- ## The defect
--
-- 020 declared `UNIQUE (namespace, option_id, field)`. One of `option_id` and
-- `field` is always NULL — an option override names no field, a scalar names
-- no option — and SQL treats every NULL as distinct from every other. The
-- constraint therefore never matched, the repository's `ON CONFLICT` upsert
-- never fired, and every save inserted another row for the same key.
--
-- The application kept working by accident: the registry lays every row over
-- the shipped defaults in turn, so the last one mostly won. But `find()`
-- returned whichever duplicate SQLite reached first, and saving an option
-- merged the new edit into that — an older copy — silently dropping edits in
-- between.
--
-- ## The key
--
-- `(namespace, option_id or '', field or '')` — the key `find()` and `clear()`
-- have always used. Enforced by an expression index, which SQLite's upsert can
-- name as its conflict target. The original table constraint is left in place:
-- it is harmless, and removing it would mean rebuilding the table.
--
-- ## Existing duplicates
--
-- Collapsed into the newest row of each key, reproducing what the registry
-- already shows for that key, so no installation's configuration changes
-- meaning:
--
--   * option overrides are JSON objects, merged in the order they were written
--     (a later field wins, an earlier field not repeated later survives);
--   * any other value — a scalar setting — is the newest written;
--   * a row whose JSON will not parse is ignored, as the registry ignores it;
--   * a key that defined an added option still does, if any of its rows did.

CREATE TEMP TABLE configuration_setting_collapsed AS
WITH RECURSIVE
  ordered AS (
    SELECT rowid AS rid,
           namespace,
           IFNULL(option_id, '') AS option_key,
           IFNULL(field, '') AS field_key,
           value,
           is_addition,
           ROW_NUMBER() OVER (
             PARTITION BY namespace, IFNULL(option_id, ''), IFNULL(field, '')
             ORDER BY rowid
           ) AS position
      FROM configuration_setting
  ),
  merged AS (
    SELECT namespace, option_key, field_key, position, rid, value, is_addition
      FROM ordered
     WHERE position = 1
    UNION ALL
    SELECT o.namespace, o.option_key, o.field_key, o.position, o.rid,
           -- Nested rather than joined with AND: SQLite does not promise to
           -- short-circuit, and json_type() on malformed JSON is an error.
           CASE
             WHEN NOT json_valid(o.value) THEN m.value
             WHEN NOT json_valid(m.value) THEN o.value
             WHEN json_type(m.value) = 'object' THEN
               CASE WHEN json_type(o.value) = 'object'
                    THEN json_patch(m.value, o.value)
                    ELSE o.value
               END
             ELSE o.value
           END,
           MAX(m.is_addition, o.is_addition)
      FROM merged AS m
      JOIN ordered AS o
        ON o.namespace = m.namespace
       AND o.option_key = m.option_key
       AND o.field_key = m.field_key
       AND o.position = m.position + 1
  )
SELECT merged.rid, merged.value, merged.is_addition
  FROM merged
  JOIN (
    SELECT namespace, option_key, field_key, MAX(position) AS last
      FROM ordered
     GROUP BY namespace, option_key, field_key
  ) AS final
    ON final.namespace = merged.namespace
   AND final.option_key = merged.option_key
   AND final.field_key = merged.field_key
   AND final.last = merged.position;

UPDATE configuration_setting
   SET value = (SELECT c.value FROM configuration_setting_collapsed AS c
                 WHERE c.rid = configuration_setting.rowid),
       is_addition = (SELECT c.is_addition FROM configuration_setting_collapsed AS c
                       WHERE c.rid = configuration_setting.rowid)
 WHERE rowid IN (SELECT rid FROM configuration_setting_collapsed);

DELETE FROM configuration_setting
 WHERE rowid NOT IN (SELECT rid FROM configuration_setting_collapsed);

DROP TABLE configuration_setting_collapsed;

CREATE UNIQUE INDEX configuration_setting_key
    ON configuration_setting (namespace, IFNULL(option_id, ''), IFNULL(field, ''));
