import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appliedVersions, loadMigrations, migrate } from "./migrate";

/**
 * Migration behaviour.
 *
 * The machinery is tested before there is a schema to migrate, because the
 * first real schema change should not also be the first time the runner is
 * exercised. The cases that matter are the ones that corrupt a database
 * quietly: running a migration twice, running them out of order, and leaving
 * bookkeeping behind after a failure.
 */

let dir: string;

const write = (name: string, sql: string) => writeFileSync(join(dir, name), sql);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-migrations-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("reading migrations", () => {
  it("orders by version, not by filename", () => {
    /* "10" sorts before "2" as a string, which is how a tenth migration runs
       before the second one and nobody notices until production. */
    write("002_second.sql", "SELECT 1");
    write("010_tenth.sql", "SELECT 1");
    write("001_first.sql", "SELECT 1");

    expect(loadMigrations(dir).map((m) => m.version)).toEqual([1, 2, 10]);
  });

  it("refuses a file whose order is undefined", () => {
    write("add-calendar.sql", "SELECT 1");
    expect(() => loadMigrations(dir)).toThrow(/NNN_description/);
  });

  it("refuses two migrations claiming the same version", () => {
    write("001_first.sql", "SELECT 1");
    write("001_also_first.sql", "SELECT 1");
    expect(() => loadMigrations(dir)).toThrow(/Duplicate migration version/);
  });

  it("ignores files that are not SQL, so the directory can be documented", () => {
    write("001_first.sql", "SELECT 1");
    write("README.md", "# Migrations");
    expect(loadMigrations(dir)).toHaveLength(1);
  });
});

describe("applying migrations", () => {
  const db = () => new Database(":memory:");

  it("applies pending migrations and records them", () => {
    write("001_people.sql", "CREATE TABLE person (id TEXT PRIMARY KEY)");
    const conn = db();

    const applied = migrate(conn, loadMigrations(dir));

    expect(applied.map((m) => m.name)).toEqual(["people"]);
    expect(appliedVersions(conn)).toEqual([1]);
  });

  /** The whole point of bookkeeping: the second run must be a no-op. */
  it("never runs a migration twice", () => {
    write("001_people.sql", "CREATE TABLE person (id TEXT PRIMARY KEY)");
    const conn = db();
    const migrations = loadMigrations(dir);

    migrate(conn, migrations);
    const second = migrate(conn, migrations);

    /* A re-run would throw "table person already exists" long before this. */
    expect(second).toEqual([]);
    expect(appliedVersions(conn)).toEqual([1]);
  });

  it("applies only what is new when a migration is added later", () => {
    write("001_people.sql", "CREATE TABLE person (id TEXT PRIMARY KEY)");
    const conn = db();
    migrate(conn, loadMigrations(dir));

    write("002_ministries.sql", "CREATE TABLE ministry (id TEXT PRIMARY KEY)");
    const applied = migrate(conn, loadMigrations(dir));

    expect(applied.map((m) => m.version)).toEqual([2]);
    expect(appliedVersions(conn)).toEqual([1, 2]);
  });

  it("runs them in version order", () => {
    write("001_people.sql", "CREATE TABLE person (id TEXT PRIMARY KEY)");
    /* Only valid if 001 ran first. */
    write("002_link.sql", "ALTER TABLE person ADD COLUMN campus_id TEXT");
    const conn = db();

    expect(() => migrate(conn, loadMigrations(dir))).not.toThrow();
  });

  /**
   * A failure must leave the database at a version that exists. Recording a
   * migration that did not finish is worse than not running it at all: the
   * next run skips it and the schema is permanently wrong.
   */
  it("records nothing when a migration fails", () => {
    write("001_people.sql", "CREATE TABLE person (id TEXT PRIMARY KEY)");
    write("002_broken.sql", "CREATE TABLE person (id TEXT PRIMARY KEY)");
    const conn = db();

    expect(() => migrate(conn, loadMigrations(dir))).toThrow();
    expect(appliedVersions(conn)).toEqual([1]);
  });

  it("rolls back the statements of a failed migration", () => {
    write(
      "001_partial.sql",
      `CREATE TABLE good (id TEXT PRIMARY KEY);
       CREATE TABLE good (id TEXT PRIMARY KEY);`,
    );
    const conn = db();

    expect(() => migrate(conn, loadMigrations(dir))).toThrow();

    const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    expect(tables.map((t) => t.name)).not.toContain("good");
  });

  it("starts from nothing on an empty database", () => {
    expect(appliedVersions(db())).toEqual([]);
  });
});
