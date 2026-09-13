import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { artifactRoot } from "../data/storage";
import { databasePath, openDatabase } from "./connection";

/**
 * The database actually opens.
 *
 * A small test with a large job: it proves that the native driver loads, that
 * the migrations directory resolves from this module's own URL rather than
 * from whatever the working directory happens to be, and that the pragmas the
 * rest of the code assumes are really on. Each of those fails in a way that is
 * confusing hours later and obvious here.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-db-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("opening a database", () => {
  it("creates the file and its directory", () => {
    const db = openDatabase(join(dir, "nested", "oikonomia.db"));
    expect(db.open).toBe(true);
    db.close();
  });

  it("enforces foreign keys, which SQLite otherwise ignores entirely", () => {
    const db = openDatabase(join(dir, "fk.db"));
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
  });

  it("uses write-ahead logging so a read does not block behind a write", () => {
    const db = openDatabase(join(dir, "wal.db"));
    expect(String(db.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("wal");
    db.close();
  });

  /** Resolved from `import.meta.url`, so it does not depend on the cwd. */
  it("finds and applies the project's migrations", () => {
    const db = openDatabase(join(dir, "migrated.db"));
    const bookkeeping = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    expect(bookkeeping).toBeDefined();
    db.close();
  });

  it("re-opens an existing database without re-running its migrations", () => {
    const path = join(dir, "twice.db");
    openDatabase(path).close();
    expect(() => openDatabase(path).close()).not.toThrow();
  });

  it("persists what was written to it", () => {
    const path = join(dir, "durable.db");

    const first = openDatabase(path);
    first.exec("CREATE TABLE note (id TEXT PRIMARY KEY, body TEXT)");
    first.prepare("INSERT INTO note VALUES (?, ?)").run("n-1", "still here");
    first.close();

    const second = openDatabase(path);
    const row = second.prepare("SELECT body FROM note WHERE id = ?").get("n-1") as {
      body: string;
    };
    expect(row.body).toBe("still here");
    second.close();
  });
});

describe("where the database lives", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is wherever OIKONOMIA_DB says", () => {
    vi.stubEnv("OIKONOMIA_DB", "/srv/oikonomia/data.db");
    expect(databasePath()).toBe("/srv/oikonomia/data.db");
  });

  it("defaults to .data/ under the working directory in development", () => {
    vi.stubEnv("OIKONOMIA_DB", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(databasePath()).toBe(join(process.cwd(), ".data", "oikonomia.db"));
  });

  /* A redeploy replaces the application directory; a guessed path inside it
     is a database the next deploy deletes. */
  it("refuses to guess in production", () => {
    vi.stubEnv("OIKONOMIA_DB", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => databasePath()).toThrow(/OIKONOMIA_DB is not set/);
  });

  it("keeps artifacts beside the database unless told otherwise", () => {
    vi.stubEnv("OIKONOMIA_DB", "/srv/oikonomia/data.db");
    vi.stubEnv("OIKONOMIA_ARTIFACTS", "");
    expect(artifactRoot()).toBe(join("/srv/oikonomia", "artifacts"));

    vi.stubEnv("OIKONOMIA_ARTIFACTS", "/mnt/artifacts");
    expect(artifactRoot()).toBe("/mnt/artifacts");
  });
});
