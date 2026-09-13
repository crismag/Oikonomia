import type { Database as Db } from "better-sqlite3";

import { newId, nowIso } from "../db/records";

/**
 * Configuration an administrator changed, and the record of them changing it.
 *
 * Overrides only: a row exists for a value somebody edited and for nothing
 * else. Everything unchanged still comes from the shipped file, which is what
 * lets an upgrade improve wording without overwriting a church's decisions.
 */

export interface ConfigurationOverride {
  namespace: string;
  optionId?: string;
  field?: string;
  value: unknown;
  /**
   * True when this row **defines** an option rather than patching one.
   *
   * The distinction matters because unknown ids in ordinary overrides are
   * ignored — a leftover patch must not resurrect an option a later version
   * removed. An addition says "this option exists because somebody here said
   * so", which is a different claim.
   */
  isAddition?: boolean;
  updatedAt: string;
  updatedById: string;
}

/**
 * What a configuration value may be. Closed, so the record can cross a wire.
 *
 * A list of strings is allowed for the one field that is genuinely plural —
 * the capabilities in an access role's bundle.
 */
type Scalar = string | number | boolean;
export type ConfigurationValue = Scalar | { [key: string]: Scalar | Scalar[] };

export interface ConfigurationChange {
  id: string;
  at: string;
  actorId: string;
  namespace: string;
  optionId?: string;
  field?: string;
  before?: ConfigurationValue;
  after: ConfigurationValue;
  summary: string;
}

interface Row {
  namespace: string;
  option_id: string | null;
  field: string | null;
  value: string;
  is_addition: number;
  updated_at: string;
  updated_by: string;
}

const parse = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    /* A value that will not parse is a value nothing can use. Treated as
       absent so one bad row cannot take the application down. */
    return undefined;
  }
};

export function createConfigurationRepository(db: Db) {
  return {
    all(): ConfigurationOverride[] {
      const rows = db
        .prepare("SELECT * FROM configuration_setting ORDER BY namespace, option_id, field")
        .all() as Row[];
      return rows
        .map((row) => ({
          namespace: row.namespace,
          ...(row.option_id ? { optionId: row.option_id } : {}),
          ...(row.field ? { field: row.field } : {}),
          value: parse(row.value),
          ...(row.is_addition === 1 ? { isAddition: true } : {}),
          updatedAt: row.updated_at,
          updatedById: row.updated_by,
        }))
        .filter((override) => override.value !== undefined);
    },

    find(namespace: string, optionId?: string, field?: string): ConfigurationOverride | undefined {
      const row = db
        .prepare(
          `SELECT * FROM configuration_setting
            WHERE namespace = ? AND IFNULL(option_id, '') = ? AND IFNULL(field, '') = ?`,
        )
        .get(namespace, optionId ?? "", field ?? "") as Row | undefined;
      if (!row) return undefined;
      const value = parse(row.value);
      if (value === undefined) return undefined;
      return {
        namespace: row.namespace,
        ...(row.option_id ? { optionId: row.option_id } : {}),
        ...(row.field ? { field: row.field } : {}),
        value,
        ...(row.is_addition === 1 ? { isAddition: true } : {}),
        updatedAt: row.updated_at,
        updatedById: row.updated_by,
      };
    },

    /**
     * Write an override, replacing any earlier one for the same thing.
     *
     * The conflict target is the expression key from migration 034, not the
     * table's original constraint: that one contains a NULL on every row, and
     * NULLs never conflict, so naming it inserted a duplicate on every save.
     * `is_addition` is left as it was, so editing an added option keeps it
     * added.
     */
    set(input: {
      namespace: string;
      optionId?: string | undefined;
      field?: string | undefined;
      value: unknown;
      /** True when this row defines a new option rather than patching one. */
      isAddition?: boolean | undefined;
      actorId: string;
    }): void {
      db.prepare(
        `INSERT INTO configuration_setting
           (id, namespace, option_id, field, value, is_addition, updated_at, updated_by)
         VALUES (@id, @namespace, @optionId, @field, @value, @addition, @at, @actor)
         ON CONFLICT (namespace, IFNULL(option_id, ''), IFNULL(field, '')) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      ).run({
        id: newId("cfg"),
        namespace: input.namespace,
        optionId: input.optionId ?? null,
        field: input.field ?? null,
        value: JSON.stringify(input.value),
        addition: input.isAddition ? 1 : 0,
        at: nowIso(),
        actor: input.actorId,
      });
    },

    /** Forget an override, which restores whatever the file says. */
    clear(namespace: string, optionId?: string, field?: string): void {
      db.prepare(
        `DELETE FROM configuration_setting
          WHERE namespace = ? AND IFNULL(option_id, '') = ? AND IFNULL(field, '') = ?`,
      ).run(namespace, optionId ?? "", field ?? "");
    },

    record(change: Omit<ConfigurationChange, "id" | "at">): void {
      db.prepare(
        `INSERT INTO configuration_change
           (id, at, actor_id, namespace, option_id, field, before, after, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId("cch"),
        nowIso(),
        change.actorId,
        change.namespace,
        change.optionId ?? null,
        change.field ?? null,
        change.before === undefined ? null : JSON.stringify(change.before),
        JSON.stringify(change.after),
        change.summary,
      );
    },

    history(limit = 50): ConfigurationChange[] {
      const rows = db
        .prepare("SELECT * FROM configuration_change ORDER BY at DESC LIMIT ?")
        .all(limit) as {
        id: string;
        at: string;
        actor_id: string;
        namespace: string;
        option_id: string | null;
        field: string | null;
        before: string | null;
        after: string;
        summary: string;
      }[];

      return rows.map((row) => ({
        id: row.id,
        at: row.at,
        actorId: row.actor_id,
        namespace: row.namespace,
        ...(row.option_id ? { optionId: row.option_id } : {}),
        ...(row.field ? { field: row.field } : {}),
        ...(row.before ? { before: parse(row.before) as ConfigurationValue } : {}),
        after: parse(row.after) as ConfigurationValue,
        summary: row.summary,
      }));
    },
  };
}

export type ConfigurationRepository = ReturnType<typeof createConfigurationRepository>;
