import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";

/**
 * Migrations.
 *
 * §26 of the MVP brief: once records are persistent, schema changes go through
 * migrations. Do not delete the developer database when a model changes — the
 * habit is cheap to start now and expensive to retrofit once anyone else has
 * data.
 *
 * A migration is a `.sql` file in `migrations/`, named `NNN_description.sql`.
 * They run in filename order, exactly once each, inside a transaction, and are
 * recorded in `schema_migrations`. There is deliberately no "down": rolling a
 * schema backwards is a production discipline this MVP has not earned, and a
 * half-written `down` is worse than none.
 */

export interface Migration {
  /** The numeric prefix. Ordering is by this, never by mtime or directory order. */
  version: number;
  name: string;
  sql: string;
}

const FILENAME = /^(\d+)_([A-Za-z0-9-_]+)\.sql$/;

/**
 * Order and validate migrations that have already been read.
 *
 * Separated from reading them because there are two ways they arrive: from the
 * filesystem in tooling, and bundled into the build for a deployed server. The
 * rules about naming and ordering must be the same either way, so they live
 * here once rather than in each reader.
 */
export function parseMigrations(files: { file: string; sql: string }[]): Migration[] {
  const migrations = files.map(({ file, sql }) => {
    const match = FILENAME.exec(file);
    if (!match) {
      throw new Error(
        `Migration "${file}" is not named NNN_description.sql, so its order is undefined.`,
      );
    }
    return { version: Number(match[1]), name: match[2]!, sql };
  });

  /* Two migrations claiming the same version would apply in an order that
     depends on the filesystem, which is exactly what versioning prevents. */
  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version}.`);
    seen.add(m.version);
  }

  return migrations.sort((a, b) => a.version - b.version);
}

/** Read and order the migrations in a directory. */
export function loadMigrations(dir: string): Migration[] {
  return parseMigrations(
    readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") })),
  );
}

function ensureBookkeeping(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
    )
  `);
}

export function appliedVersions(db: Database): number[] {
  ensureBookkeeping(db);
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {
    version: number;
  }[];
  return rows.map((row) => row.version);
}

/**
 * Apply every migration the database has not seen.
 *
 * Each runs in its own transaction with its bookkeeping row, so an interrupted
 * run leaves the database at a version that actually exists rather than
 * half-way through one.
 */
export function migrate(db: Database, migrations: Migration[]): Migration[] {
  ensureBookkeeping(db);

  const already = new Set(appliedVersions(db));
  const pending = migrations.filter((m) => !already.has(m.version));

  const record = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    });
    apply();
  }

  return pending;
}
