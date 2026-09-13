import { accessSync, constants, existsSync, rmSync, statSync } from "node:fs";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

import { previousRefreshAt, usableTimeZone } from "@/domain/refresh-schedule";
import { bundledMigrations } from "../db/bundled-migrations";
import { sameFile, within } from "../db/database-paths";
import { appliedVersions, migrate, type Migration } from "../db/migrate";

/**
 * Returning a public demonstration to its baseline.
 *
 * ## Inside the live database, never over it
 *
 * The demonstration's database is open in several server processes at once —
 * Passenger starts as many as it likes, and each holds its own SQLite handle.
 * Replacing, renaming or deleting that file under them does not reset
 * anything: a process that already has it open goes on reading and writing the
 * old inode, WAL and shared-memory files drift apart, and the result ranges
 * from stale data to a corrupt database. So nothing here touches the live
 * file. The baseline is attached, and one `BEGIN IMMEDIATE` transaction on the
 * ordinary connection deletes every application row and copies the baseline's
 * in. SQLite serialises it with every other writer, and every other process
 * sees the restored rows on its next read, through the handle it already has.
 *
 * ## What must be true first
 *
 * All of it is checked before a single row is deleted, and there is no way to
 * skip any of it — no force flag, no override, no parameter:
 *
 * - Demo Mode is on;
 * - the live database is the demonstration's own: not the ordinary
 *   installation's database, not the baseline, not in memory;
 * - the baseline is configured, exists, is readable, and is not the live or the
 *   ordinary database;
 * - the artifact directory a reset empties holds none of those databases, and
 *   is not the ordinary installation's artifact directory;
 * - the live database is marked `demo-installation` in `demo_state`;
 * - the baseline is marked `demo-baseline`, migrates to this build's schema,
 *   passes SQLite's integrity and foreign-key checks, designates at least one
 *   identity, and holds no sessions, tokens, throttles or visitors;
 * - the two schemas match table for table, column for column, and use nothing
 *   a row copy cannot reproduce (triggers, virtual or generated columns).
 *
 * A church's database fails the second check whatever its environment says: it
 * has no `demo_state` row, and nothing in the application writes one.
 *
 * ## Generic, on purpose
 *
 * Tables are read from `sqlite_master`, not listed. A table added by a future
 * migration is restored with the rest; it cannot be forgotten. Only two are left
 * alone, and both describe the database rather than the demonstration:
 * `schema_migrations` (the live ledger already matches the baseline's, which is
 * checked) and `demo_state` (whose generation must survive the reset it
 * counts). SQLite's own `sqlite_*` tables are never application data.
 */

/** Tables a reset leaves as they are. Each is explained above; keep this list tiny. */
export const RESET_EXCLUDED_TABLES: readonly string[] = ["demo_state", "schema_migrations"];

/** The baseline is attached under this name for the length of the restore. */
const BASELINE_SCHEMA = "demo_baseline";

export type DemoResetRefusal =
  | "demo-mode-off"
  | "live-database-not-dedicated"
  | "baseline-not-configured"
  | "baseline-not-dedicated"
  | "baseline-missing"
  | "baseline-unreadable"
  | "artifacts-overlap"
  | "live-not-marked"
  | "baseline-not-marked"
  | "baseline-schema-incompatible"
  | "baseline-integrity-failed"
  | "baseline-has-no-designated-identities"
  | "baseline-has-runtime-state"
  | "schema-mismatch"
  | "schema-unsupported";

/** A reset that was not attempted. Nothing in the live database was changed. */
export class DemoResetRefused extends Error {
  constructor(
    readonly reason: DemoResetRefusal,
    message: string,
  ) {
    super(message);
    this.name = "DemoResetRefused";
  }
}

/** A restore that began and was rolled back. The live database is as it was. */
export class DemoResetFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DemoResetFailed";
  }
}

export interface DemoState {
  marker: "demo-baseline" | "demo-installation";
  generation: number;
  lastResetAt: string | null;
}

/** What a database says about itself, or `undefined` for one that is not a demonstration's. */
export function readDemoState(db: Db, schema = "main"): DemoState | undefined {
  const table = db
    .prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = 'demo_state'`)
    .get();
  if (!table) return undefined;
  const row = db
    .prepare(`SELECT marker, generation, last_reset_at FROM ${schema}.demo_state WHERE id = 1`)
    .get() as
    { marker: DemoState["marker"]; generation: number; last_reset_at: string | null } | undefined;
  return row
    ? { marker: row.marker, generation: row.generation, lastResetAt: row.last_reset_at }
    : undefined;
}

export interface DemoResetParts {
  /** The process's own connection to the live database. Its file is never touched. */
  db: Db;
  demoMode: boolean;
  /** The ordinary installation's database, where one is configured. */
  ordinaryPath: string | undefined;
  baselinePath: string | undefined;
  /** The directory a successful reset empties. */
  artifactRoot: string;
  /** The ordinary installation's artifact directory, where one can be named. */
  ordinaryArtifactRoot: string | undefined;
  /** The artifact store: where the baseline's scratch copy is made, and what is emptied. */
  artifacts: {
    scratchPath(name: string): string;
    list(): { reference: string }[];
    delete(reference: string): void;
  };
  migrations?: Migration[];
  now?: () => Date;
}

export interface DemoResetOptions {
  /**
   * Reset only if a refresh time on the site's schedule has passed since the
   * last reset. This can only skip a reset; it never loosens a check.
   */
  onlyIfDue?: { timeZone: string };
}

export type DemoResetResult =
  | {
      status: "reset";
      generation: number;
      resetAt: string;
      tables: number;
      rows: number;
      /** Emptied after the restore committed. A failure here does not undo the restore. */
      artifacts: { removed: number; failed: string[] };
    }
  | { status: "not-due"; generation: number; lastResetAt: string | null; dueAfter: string };

const refuse = (reason: DemoResetRefusal, message: string): never => {
  throw new DemoResetRefused(reason, message);
};

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

interface SchemaDescription {
  versions: number[];
  /** Table name → a line per column: name, declared type, not-null, key position, hidden. */
  tables: Record<string, string[]>;
  unsupported: string[];
}

/** Everything about a schema that a row-for-row copy depends on. */
function describeSchema(db: Db, schema: string): SchemaDescription {
  const entries = db
    .prepare(
      `SELECT type, name, sql FROM ${schema}.sqlite_master
        WHERE type IN ('table', 'trigger') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
        ORDER BY name`,
    )
    .all() as { type: string; name: string; sql: string | null }[];

  const tables: Record<string, string[]> = {};
  const unsupported: string[] = [];
  for (const entry of entries) {
    if (entry.type === "trigger") {
      unsupported.push(`trigger ${entry.name}`);
      continue;
    }
    if (!SAFE_NAME.test(entry.name)) {
      unsupported.push(`table name ${JSON.stringify(entry.name)}`);
      continue;
    }
    if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(entry.sql ?? "")) {
      unsupported.push(`virtual table ${entry.name}`);
      continue;
    }
    const columns = db.prepare(`PRAGMA ${schema}.table_xinfo(${quote(entry.name)})`).all() as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
      hidden: number;
    }[];
    for (const column of columns) {
      if (column.hidden !== 0) unsupported.push(`generated column ${entry.name}.${column.name}`);
    }
    tables[entry.name] = columns.map(
      (column) => `${column.name} ${column.type} ${column.notnull} ${column.pk} ${column.hidden}`,
    );
  }

  const versions = (
    db.prepare(`SELECT version FROM ${schema}.schema_migrations ORDER BY version`).all() as {
      version: number;
    }[]
  ).map((row) => row.version);

  return { versions, tables, unsupported };
}

/** The tables a reset restores in this database: every application table but the excluded. */
export function restorableTables(db: Db, schema = "main"): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM ${schema}.sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
          ORDER BY name`,
      )
      .all() as { name: string }[]
  )
    .map((row) => row.name)
    .filter((name) => !RESET_EXCLUDED_TABLES.includes(name));
}

function removeScratch(path: string): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
}

/** Whether a refresh time has passed since the last reset. */
function isDue(state: DemoState, now: Date, timeZone: string): { due: boolean; dueAfter: Date } {
  const dueAfter = previousRefreshAt(now, usableTimeZone(timeZone));
  const last = state.lastResetAt ? new Date(state.lastResetAt).getTime() : Number.NaN;
  return { due: !(last >= dueAfter.getTime()), dueAfter };
}

/**
 * Check everything that can be checked without the write lock, and prepare a
 * migrated, verified scratch copy of the baseline. Changes nothing live.
 */
function prepare(parts: DemoResetParts): { scratch: string; tables: string[] } {
  const { db } = parts;
  const livePath = db.name;

  if (!parts.demoMode) {
    refuse("demo-mode-off", "Demo Mode is off. Only a public demonstration can be reset.");
  }

  if (db.memory || livePath === ":memory:" || livePath === "") {
    refuse("live-database-not-dedicated", "The live database is not a file.");
  }
  if (parts.ordinaryPath && sameFile(livePath, parts.ordinaryPath)) {
    refuse(
      "live-database-not-dedicated",
      "The live database is the ordinary installation's database (OIKONOMIA_DB).",
    );
  }

  const baselinePath = parts.baselinePath;
  if (!baselinePath) {
    return refuse("baseline-not-configured", "OIKONOMIA_DEMO_BASELINE is not set.");
  }
  if (sameFile(baselinePath, livePath)) {
    refuse("baseline-not-dedicated", "OIKONOMIA_DEMO_BASELINE is the live database itself.");
  }
  if (parts.ordinaryPath && sameFile(baselinePath, parts.ordinaryPath)) {
    refuse(
      "baseline-not-dedicated",
      "OIKONOMIA_DEMO_BASELINE is the ordinary installation's database (OIKONOMIA_DB).",
    );
  }
  if (!existsSync(baselinePath) || !statSync(baselinePath).isFile()) {
    refuse("baseline-missing", "The baseline database does not exist.");
  }
  try {
    accessSync(baselinePath, constants.R_OK);
  } catch {
    refuse("baseline-unreadable", "The baseline database cannot be read.");
  }

  /* A reset empties this directory. It must hold no database, and must not be
     the ordinary installation's, in either direction. */
  const databases = [livePath, baselinePath, parts.ordinaryPath].filter((path): path is string =>
    Boolean(path),
  );
  if (databases.some((path) => within(path, parts.artifactRoot))) {
    refuse("artifacts-overlap", "The artifact directory contains a database a reset must keep.");
  }
  if (
    parts.ordinaryArtifactRoot &&
    (within(parts.artifactRoot, parts.ordinaryArtifactRoot) ||
      within(parts.ordinaryArtifactRoot, parts.artifactRoot))
  ) {
    refuse(
      "artifacts-overlap",
      "The artifact directory is the ordinary installation's artifact directory.",
    );
  }

  if (readDemoState(db)?.marker !== "demo-installation") {
    refuse(
      "live-not-marked",
      "The live database is not marked as a demonstration (demo_state: demo-installation).",
    );
  }

  /* A copy, so nothing done to check or migrate it can reach the baseline. */
  const scratch = parts.artifacts.scratchPath("demo-baseline.db");
  try {
    let source: Db | undefined;
    try {
      source = new Database(baselinePath, { readonly: true, fileMustExist: true });
      source.prepare("VACUUM INTO ?").run(scratch);
    } catch (error) {
      refuse(
        "baseline-unreadable",
        `The baseline could not be read as a database: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      source?.close();
    }

    const copy = new Database(scratch);
    try {
      const firstLook = copy.pragma("integrity_check", { simple: true });
      if (firstLook !== "ok") {
        refuse(
          "baseline-integrity-failed",
          `The baseline failed its integrity check: ${String(firstLook)}`,
        );
      }
      if (readDemoState(copy)?.marker !== "demo-baseline") {
        refuse(
          "baseline-not-marked",
          "The baseline is not marked as a demonstration baseline (demo_state: demo-baseline).",
        );
      }

      copy.pragma("foreign_keys = ON");
      try {
        migrate(copy, parts.migrations ?? bundledMigrations());
      } catch (error) {
        refuse(
          "baseline-schema-incompatible",
          `The baseline could not be brought to this version's schema: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const integrity = copy.pragma("integrity_check", { simple: true });
      const orphans = copy.pragma("foreign_key_check") as unknown[];
      if (integrity !== "ok" || orphans.length > 0) {
        refuse(
          "baseline-integrity-failed",
          `The baseline failed its integrity or foreign-key check (${String(integrity)}, ${orphans.length} orphaned rows).`,
        );
      }

      const count = (sql: string) => (copy.prepare(sql).get() as { n: number }).n;
      if (count("SELECT COUNT(*) AS n FROM demo_identity WHERE kind = 'designated'") === 0) {
        refuse(
          "baseline-has-no-designated-identities",
          "The baseline designates nobody to explore as.",
        );
      }
      /* A session in a baseline would sign its holder in after every reset; a
         visitor in one would never be removed. */
      const runtime =
        count("SELECT COUNT(*) AS n FROM auth_session") +
        count("SELECT COUNT(*) AS n FROM auth_token") +
        count("SELECT COUNT(*) AS n FROM auth_throttle") +
        count("SELECT COUNT(*) AS n FROM demo_identity WHERE kind = 'visitor'");
      if (runtime > 0) {
        refuse(
          "baseline-has-runtime-state",
          "The baseline holds sessions, sign-in tokens, throttles or visitors.",
        );
      }

      const live = describeSchema(db, "main");
      const baseline = describeSchema(copy, "main");
      if (live.unsupported.length > 0 || baseline.unsupported.length > 0) {
        refuse(
          "schema-unsupported",
          `A row-for-row restore cannot reproduce: ${[...new Set([...live.unsupported, ...baseline.unsupported])].join(", ")}.`,
        );
      }
      if (
        JSON.stringify(live.versions) !== JSON.stringify(baseline.versions) ||
        JSON.stringify(appliedVersions(db)) !== JSON.stringify(live.versions)
      ) {
        refuse("schema-mismatch", "The baseline's migrations do not match the live database's.");
      }
      const liveTables = Object.keys(live.tables);
      const differing = [...new Set([...liveTables, ...Object.keys(baseline.tables)])].filter(
        (name) => JSON.stringify(live.tables[name]) !== JSON.stringify(baseline.tables[name]),
      );
      if (differing.length > 0) {
        refuse(
          "schema-mismatch",
          `The baseline's tables differ from the live database's: ${differing.join(", ")}.`,
        );
      }

      /* Attached next, from a connection that uses the rollback journal. */
      copy.pragma("journal_mode = DELETE");
      return { scratch, tables: restorableTables(db) };
    } finally {
      copy.close();
    }
  } catch (error) {
    removeScratch(scratch);
    throw error;
  }
}

/**
 * Reset the demonstration.
 *
 * Returns once the restore has committed and the artifact directory has been
 * emptied as far as it could be. Throws `DemoResetRefused` when a check failed
 * (nothing was changed) and `DemoResetFailed` when the restore itself failed
 * (it was rolled back; nothing was changed).
 */
export function resetDemo(parts: DemoResetParts, options: DemoResetOptions = {}): DemoResetResult {
  const { db } = parts;
  const now = parts.now ?? (() => new Date());

  /* Cheap, and saves copying the baseline every hour for nothing. Asked again
     under the write lock, where the answer cannot change. */
  if (options.onlyIfDue && parts.demoMode) {
    const state = readDemoState(db);
    if (state?.marker === "demo-installation") {
      const { due, dueAfter } = isDue(state, now(), options.onlyIfDue.timeZone);
      if (!due) {
        return {
          status: "not-due",
          generation: state.generation,
          lastResetAt: state.lastResetAt,
          dueAfter: dueAfter.toISOString(),
        };
      }
    }
  }

  const { scratch, tables } = prepare(parts);
  let result: DemoResetResult;

  try {
    db.prepare(`ATTACH DATABASE ? AS ${BASELINE_SCHEMA}`).run(scratch);
    try {
      try {
        /* Waits for other writers (the connection's busy timeout), then holds
           the database until COMMIT or ROLLBACK. */
        db.exec("BEGIN IMMEDIATE");
        const state = readDemoState(db);
        if (state?.marker !== "demo-installation") {
          throw new DemoResetRefused("live-not-marked", "The live database is no longer marked.");
        }
        if (options.onlyIfDue) {
          const { due, dueAfter } = isDue(state, now(), options.onlyIfDue.timeZone);
          if (!due) {
            db.exec("ROLLBACK");
            return {
              status: "not-due",
              generation: state.generation,
              lastResetAt: state.lastResetAt,
              dueAfter: dueAfter.toISOString(),
            };
          }
        }

        /* Checked once, at COMMIT, rather than after every statement: rows go
           in parent-and-child order only by accident. Deletes all come first,
           so an ON DELETE CASCADE can never remove a row already restored. */
        db.pragma("defer_foreign_keys = ON");

        for (const table of tables) db.exec(`DELETE FROM main.${quote(table)}`);

        let rows = 0;
        for (const table of tables) {
          const columns = (
            db.prepare(`PRAGMA main.table_info(${quote(table)})`).all() as { name: string }[]
          )
            .map((column) => quote(column.name))
            .join(", ");
          rows += db
            .prepare(
              `INSERT INTO main.${quote(table)} (${columns}) SELECT ${columns} FROM ${BASELINE_SCHEMA}.${quote(table)}`,
            )
            .run().changes;
        }

        const orphans = db.pragma("main.foreign_key_check") as unknown[];
        if (orphans.length > 0) {
          throw new Error(`The restored rows leave ${orphans.length} broken references.`);
        }
        const integrity = db.pragma("main.integrity_check", { simple: true });
        if (integrity !== "ok") throw new Error(`Integrity check said: ${String(integrity)}`);

        const resetAt = now().toISOString();
        const counted = db
          .prepare(
            `UPDATE main.demo_state SET generation = generation + 1, last_reset_at = ?
              WHERE id = 1 AND marker = 'demo-installation'`,
          )
          .run(resetAt);
        if (counted.changes !== 1) throw new Error("The reset could not be counted.");

        db.exec("COMMIT");

        result = {
          status: "reset",
          generation: state.generation + 1,
          resetAt,
          tables: tables.length,
          rows,
          artifacts: { removed: 0, failed: [] },
        };
      } catch (error) {
        if (db.inTransaction) db.exec("ROLLBACK");
        if (error instanceof DemoResetRefused) throw error;
        throw new DemoResetFailed(
          `The demonstration could not be restored, and nothing was changed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    } finally {
      db.exec(`DETACH DATABASE ${BASELINE_SCHEMA}`);
    }
  } finally {
    removeScratch(scratch);
  }

  /* After COMMIT: the restore stands whatever happens here. Exports and
     backups made during the last period are what is left behind; a file that
     will not go is reported, not retried and not hidden. */
  for (const artifact of parts.artifacts.list()) {
    try {
      parts.artifacts.delete(artifact.reference);
      result.artifacts.removed += 1;
    } catch {
      result.artifacts.failed.push(artifact.reference);
    }
  }

  return result;
}
