import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

import { bundledMigrations } from "./bundled-migrations";
import { migrate } from "./migrate";

/**
 * The development database.
 *
 * SQLite, on the local filesystem, opened once per process. §4 of the MVP
 * brief: the lightest persistence that works, chosen so that the *shape* of
 * persistence — repositories, migrations, validation at the boundary — is real
 * while the choice of production database stays deferred.
 *
 * ## What this is, and is not
 *
 * **Implemented now.** A real, durable, transactional database for local
 * development and for the MVP's vertical slices.
 *
 * **MVP limitation.** One file, one process, no connection pooling, no
 * replication, no backups. `better-sqlite3` is synchronous and native, which
 * means this module runs on a Node server and nowhere else — see
 * `docs/architecture/data.md` for what that rules out.
 *
 * **Deferred.** Production database selection, hosting, migration tooling for
 * a deployed environment.
 */

/** Where the developer database lives. Overridable so tests get their own. */
export const DB_PATH = process.env["OIKONOMIA_DB"] ?? join(process.cwd(), ".data", "oikonomia.db");

let instance: Db | undefined;

/**
 * Open a database and bring its schema up to date.
 *
 * Exported separately from the singleton so tests can open a throwaway file —
 * or `:memory:` — without touching the developer's data.
 */
export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);

  /* Write-ahead logging so a read during a write does not block, and foreign
     keys on because SQLite otherwise ignores every REFERENCES clause. */
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db, bundledMigrations());
  return db;
}

/**
 * The process-wide database.
 *
 * Repositories take a `Db` rather than reaching for this, so that a test can
 * hand them a different one. Only the composition edge — a request handler
 * assembling its services — should call this.
 */
export function getDatabase(): Db {
  if (!instance) instance = openDatabase(DB_PATH);
  return instance;
}

/** Close and forget the process-wide database. For tests and dev reseeds. */
export function closeDatabase(): void {
  instance?.close();
  instance = undefined;
}
