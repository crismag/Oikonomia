import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

import { currentInstallation } from "../installation/policy";
import { bundledMigrations } from "./bundled-migrations";
import { liveDatabasePath } from "./database-paths";
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

/**
 * Where the database lives.
 *
 * `.data/` under the working directory is right for a developer and wrong for a
 * deployment: hosts that build from a repository replace the application
 * directory on every deploy, and a database inside it goes with it — silently,
 * on the first routine redeploy. So a production process must be told where its
 * data lives, and refuses rather than guessing, as `siteUrl()` does.
 *
 * A public demonstration opens its own database, never the ordinary one — see
 * `database-paths.ts` for the rules and the refusals.
 *
 * Read on each call rather than at import, so the refusal happens where the
 * database is needed rather than while an unrelated module loads.
 */
export function databasePath(): string {
  return liveDatabasePath(currentInstallation().demoMode);
}

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
  if (!instance) instance = openDatabase(databasePath());
  return instance;
}

/** Close and forget the process-wide database. For tests and dev reseeds. */
export function closeDatabase(): void {
  instance?.close();
  instance = undefined;
}
