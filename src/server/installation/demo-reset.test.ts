import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedAll } from "@/test/seeds";
import { LocalStorage } from "../data/storage";
import { bundledMigrations } from "../db/bundled-migrations";
import { openDatabase } from "../db/connection";
import {
  DemoResetFailed,
  DemoResetRefused,
  RESET_EXCLUDED_TABLES,
  readDemoState,
  resetDemo,
  restorableTables,
  type DemoResetParts,
  type DemoResetRefusal,
} from "./demo-reset";

/**
 * A demonstration reset, against a database shaped like a real one.
 *
 * The baseline is the full schema with the narrative test data set in it —
 * people, ministries, meetings, reports, gatherings, documents — plus what a
 * demonstration adds: designated identities, a marker, a configured setting.
 * The live database is provisioned from it the way an operator does, then
 * changed the way visitors change it, then reset.
 */

const NOW = "2026-09-13T16:00:05.000Z";

let dir: string;
const opened: Db[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-reset-"));
});

afterEach(() => {
  for (const db of opened.splice(0)) if (db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const track = (db: Db) => {
  opened.push(db);
  return db;
};

/** A curated baseline: realistic data, two designated identities, the marker. */
function buildBaseline(path = join(dir, "oikonomia-demo-baseline.db")): string {
  const db = openDatabase(path);
  seedAll(db);
  const people = db.prepare("SELECT id FROM person ORDER BY id LIMIT 2").all() as { id: string }[];
  people.forEach((person, index) => {
    db.prepare(
      `INSERT INTO account (id, person_id, email, email_verified, status, created_at)
       VALUES (?, ?, NULL, 0, 'active', ?)`,
    ).run(`acc-demo-${index}`, person.id, NOW);
    db.prepare(
      `INSERT INTO demo_identity (id, person_id, kind, display_order, created_at)
       VALUES (?, ?, 'designated', ?, ?)`,
    ).run(`demo-${index}`, person.id, index, NOW);
  });
  db.prepare(
    `INSERT INTO configuration_setting (id, namespace, option_id, field, value, updated_at, updated_by, is_addition)
     VALUES ('cfg-demo-name', 'site.profile', NULL, 'name', '"Baseline Church"', ?, 'system', 0)`,
  ).run(NOW);
  db.prepare("INSERT INTO demo_state (id, marker) VALUES (1, 'demo-baseline')").run();
  db.pragma("journal_mode = DELETE");
  db.close();
  return path;
}

/** The live demonstration database, provisioned from the baseline and marked. */
function provisionLive(baseline: string, path = join(dir, "oikonomia-demo.db")): Db {
  const source = new Database(baseline, { readonly: true });
  source.prepare("VACUUM INTO ?").run(path);
  source.close();
  const db = track(openDatabase(path));
  db.prepare("UPDATE demo_state SET marker = 'demo-installation' WHERE id = 1").run();
  return db;
}

function partsFor(db: Db, overrides: Partial<DemoResetParts> = {}): DemoResetParts {
  const artifactRoot = overrides.artifactRoot ?? join(dir, "demo-artifacts");
  return {
    db,
    demoMode: true,
    ordinaryPath: join(dir, "oikonomia.db"),
    baselinePath: join(dir, "oikonomia-demo-baseline.db"),
    artifactRoot,
    ordinaryArtifactRoot: join(dir, "artifacts"),
    artifacts: new LocalStorage(artifactRoot),
    now: () => new Date(NOW),
    ...overrides,
  };
}

/** Every restorable table's rows, order-independent. */
function snapshot(db: Db): Record<string, string[]> {
  return Object.fromEntries(
    restorableTables(db).map((table) => [
      table,
      (db.prepare(`SELECT * FROM "${table}"`).all() as unknown[])
        .map((row) => JSON.stringify(row))
        .sort(),
    ]),
  );
}

function snapshotOf(path: string): Record<string, string[]> {
  const db = new Database(path, { readonly: true });
  try {
    return snapshot(db);
  } finally {
    db.close();
  }
}

const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The schemas a connection has attached. The baseline must never be left among them. */
const attached = (db: Db) =>
  (db.pragma("database_list") as { name: string }[]).map((entry) => entry.name);

const count = (db: Db, sql: string, ...params: unknown[]) =>
  (db.prepare(sql).get(...params) as { n: number }).n;

/** What visitors do between resets, across many tables. */
function visitorsChange(db: Db): void {
  const person = db.prepare("SELECT id FROM person ORDER BY id LIMIT 1 OFFSET 5").get() as {
    id: string;
  };
  /* Added. */
  /* A person like any other: every column copied, then made someone new. */
  db.prepare("CREATE TEMP TABLE visitor AS SELECT * FROM person WHERE id = ?").run(person.id);
  db.exec(`UPDATE temp.visitor SET id = 'per-visitor', name = 'A Visitor', email = NULL;
           INSERT INTO person SELECT * FROM temp.visitor;
           DROP TABLE temp.visitor;`);
  db.prepare(
    `INSERT INTO account (id, person_id, email, email_verified, status, created_at)
     VALUES ('acc-visitor', 'per-visitor', NULL, 0, 'active', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO demo_identity (id, person_id, kind, display_order, created_at)
     VALUES ('demo-visitor', 'per-visitor', 'visitor', 0, ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO auth_session (id, account_id, created_at, last_seen_at, expires_at)
     VALUES ('ses-hash', 'acc-demo-0', ?, ?, '2099-01-01T00:00:00Z')`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO auth_throttle (key, window_started_at, attempts, updated_at)
     VALUES ('sign-in:someone', ?, 3, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO configuration_setting (id, namespace, option_id, field, value, updated_at, updated_by, is_addition)
     VALUES ('cfg-visitor', 'site.profile', NULL, 'tagline', '"Changed by a visitor"', ?, 'system', 0)`,
  ).run(NOW);
  /* Changed. */
  db.prepare("UPDATE person SET name = 'Renamed by a visitor' WHERE id = ?").run(person.id);
  db.prepare(
    "UPDATE configuration_setting SET value = '\"Visitor Church\"' WHERE id = 'cfg-demo-name'",
  ).run();
  db.prepare("UPDATE goal SET title = 'Rewritten' WHERE id = (SELECT id FROM goal LIMIT 1)").run();
  db.prepare(
    "UPDATE gathering_attendance SET status = 'absent' WHERE rowid IN (SELECT rowid FROM gathering_attendance LIMIT 3)",
  ).run();
  /* Deleted — cascading into their children, as the application would. */
  db.prepare("DELETE FROM meeting_note WHERE id IN (SELECT id FROM meeting_note LIMIT 5)").run();
  db.prepare(
    "DELETE FROM leadership_report WHERE id IN (SELECT id FROM leadership_report LIMIT 7)",
  ).run();
  db.prepare("DELETE FROM document WHERE id IN (SELECT id FROM document LIMIT 4)").run();
}

function expectRefused(work: () => unknown, reason: DemoResetRefusal): void {
  let thrown: unknown;
  try {
    work();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected a refusal: ${reason}`).toBeInstanceOf(DemoResetRefused);
  expect((thrown as DemoResetRefused).reason).toBe(reason);
}

describe("resetting a demonstration", () => {
  it("returns every table to the baseline, in the live file, through the open connection", () => {
    const baseline = buildBaseline();
    const baselineDigest = digest(baseline);
    const live = provisionLive(baseline);
    const liveInode = statSync(live.name).ino;
    const expected = snapshotOf(baseline);

    visitorsChange(live);
    const changed = snapshot(live);
    const differing = Object.keys(expected).filter(
      (table) => JSON.stringify(expected[table]) !== JSON.stringify(changed[table]),
    );
    /* The mutations really did reach many tables, or this proves little. */
    expect(differing.length).toBeGreaterThanOrEqual(10);

    const result = resetDemo(partsFor(live));

    expect(result).toMatchObject({ status: "reset", generation: 1, resetAt: NOW });
    expect(snapshot(live)).toEqual(expected);

    /* Visitors, their accounts and every session are gone; the designated remain. */
    expect(count(live, "SELECT COUNT(*) AS n FROM person WHERE id = 'per-visitor'")).toBe(0);
    expect(count(live, "SELECT COUNT(*) AS n FROM demo_identity WHERE kind = 'visitor'")).toBe(0);
    expect(count(live, "SELECT COUNT(*) AS n FROM demo_identity WHERE kind = 'designated'")).toBe(
      2,
    );
    expect(count(live, "SELECT COUNT(*) AS n FROM auth_session")).toBe(0);
    expect(count(live, "SELECT COUNT(*) AS n FROM auth_throttle")).toBe(0);
    expect(
      live.prepare("SELECT value FROM configuration_setting WHERE id = 'cfg-demo-name'").get(),
    ).toEqual({ value: '"Baseline Church"' });

    /* The database describes itself as before, one reset later. */
    expect(readDemoState(live)).toEqual({
      marker: "demo-installation",
      generation: 1,
      lastResetAt: NOW,
    });
    expect(count(live, "SELECT COUNT(*) AS n FROM schema_migrations")).toBe(
      bundledMigrations().length,
    );
    expect(live.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(live.pragma("foreign_key_check")).toEqual([]);
    expect(attached(live)).not.toContain("demo_baseline");

    /* Same file, same inode; the baseline was only read; no scratch copy is left. */
    expect(statSync(live.name).ino).toBe(liveInode);
    expect(digest(baseline)).toBe(baselineDigest);
    expect(readdirSync(join(dir, "demo-artifacts"))).toEqual([]);
  });

  it("is seen by a connection that was already open, without reopening it", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const other = track(new Database(live.name));
    visitorsChange(live);
    expect(count(other, "SELECT COUNT(*) AS n FROM person WHERE id = 'per-visitor'")).toBe(1);

    resetDemo(partsFor(live));

    expect(count(other, "SELECT COUNT(*) AS n FROM person WHERE id = 'per-visitor'")).toBe(0);
    expect(snapshot(other)).toEqual(snapshotOf(baseline));
  });

  it("counts each reset once, and the count survives the restore", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    let clock = new Date(NOW).getTime();
    const parts = partsFor(live, { now: () => new Date(clock) });

    for (const expected of [1, 2, 3]) {
      clock += 60_000;
      visitorsChange(live);
      expect(resetDemo(parts)).toMatchObject({ status: "reset", generation: expected });
      expect(readDemoState(live)?.generation).toBe(expected);
    }
  });

  it("empties the artifact directory once the restore has committed", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const parts = partsFor(live);
    const store = parts.artifacts as LocalStorage;
    store.put("export.json", "{}");
    store.put("backup.db", "not really");

    const result = resetDemo(parts);

    expect(result).toMatchObject({ status: "reset", artifacts: { removed: 2, failed: [] } });
    expect(readdirSync(join(dir, "demo-artifacts"))).toEqual([]);
  });

  it("reports an artifact it could not remove, and keeps the committed restore", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const parts = partsFor(live);
    (parts.artifacts as LocalStorage).put("export.json", "{}");
    mkdirSync(join(dir, "demo-artifacts", "a-directory"));
    visitorsChange(live);

    const result = resetDemo(parts);

    expect(result).toMatchObject({
      status: "reset",
      generation: 1,
      artifacts: { removed: 1, failed: ["a-directory"] },
    });
    expect(snapshot(live)).toEqual(snapshotOf(baseline));
  });

  describe("on the site's schedule", () => {
    it("resets when a refresh time has passed since the last reset", () => {
      const baseline = buildBaseline();
      const live = provisionLive(baseline);
      /* 12:00 in Toronto was 16:00 UTC; the last reset was before it. */
      live.prepare("UPDATE demo_state SET last_reset_at = '2026-09-13T10:00:30.000Z'").run();

      const result = resetDemo(partsFor(live), { onlyIfDue: { timeZone: "America/Toronto" } });

      expect(result).toMatchObject({ status: "reset", generation: 1 });
    });

    it("does nothing when the site has not reached its next refresh time", () => {
      const baseline = buildBaseline();
      const live = provisionLive(baseline);
      live.prepare("UPDATE demo_state SET last_reset_at = '2026-09-13T16:00:01.000Z'").run();
      visitorsChange(live);
      const before = snapshot(live);

      const result = resetDemo(partsFor(live), { onlyIfDue: { timeZone: "America/Toronto" } });

      expect(result).toEqual({
        status: "not-due",
        generation: 0,
        lastResetAt: "2026-09-13T16:00:01.000Z",
        dueAfter: "2026-09-13T16:00:00.000Z",
      });
      expect(snapshot(live)).toEqual(before);
    });
  });
});

describe("what a reset refuses, before it changes anything", () => {
  /** Run a refusal and prove the live database did not move. */
  function refusesUntouched(
    live: Db,
    parts: DemoResetParts,
    reason: DemoResetRefusal,
    { visited = true }: { visited?: boolean } = {},
  ): void {
    if (visited) visitorsChange(live);
    const before = snapshot(live);
    const state = readDemoState(live);

    expectRefused(() => resetDemo(parts), reason);

    expect(snapshot(live)).toEqual(before);
    expect(readDemoState(live)).toEqual(state);
    expect(attached(live)).not.toContain("demo_baseline");
    expect(readdirSync(parts.artifactRoot).filter((name) => name.startsWith("scratch-"))).toEqual(
      [],
    );
  }

  it("with Demo Mode off", () => {
    const live = provisionLive(buildBaseline());
    refusesUntouched(live, partsFor(live, { demoMode: false }), "demo-mode-off");
  });

  it("for a church's own database, whatever the environment says", () => {
    buildBaseline();
    const church = track(openDatabase(join(dir, "church.db")));
    seedAll(church);
    church
      .prepare(
        "UPDATE person SET name = 'Written by the church' WHERE id = (SELECT id FROM person LIMIT 1)",
      )
      .run();
    refusesUntouched(church, partsFor(church, { demoMode: true }), "live-not-marked", {
      visited: false,
    });
  });

  it("when the live database is the ordinary installation's", () => {
    const live = provisionLive(buildBaseline());
    refusesUntouched(
      live,
      partsFor(live, { ordinaryPath: live.name }),
      "live-database-not-dedicated",
    );
  });

  it("when the ordinary database is the live one through a symlink", () => {
    const live = provisionLive(buildBaseline());
    const link = join(dir, "looks-different.db");
    symlinkSync(live.name, link);
    refusesUntouched(live, partsFor(live, { ordinaryPath: link }), "live-database-not-dedicated");
  });

  it("without a baseline configured", () => {
    const live = provisionLive(buildBaseline());
    refusesUntouched(live, partsFor(live, { baselinePath: undefined }), "baseline-not-configured");
  });

  it("when the baseline does not exist", () => {
    const live = provisionLive(buildBaseline());
    refusesUntouched(
      live,
      partsFor(live, { baselinePath: join(dir, "nowhere.db") }),
      "baseline-missing",
    );
  });

  it("when the baseline is the live database", () => {
    const live = provisionLive(buildBaseline());
    refusesUntouched(live, partsFor(live, { baselinePath: live.name }), "baseline-not-dedicated");
  });

  it("when the baseline is the live database through a symlinked directory", () => {
    const live = provisionLive(buildBaseline());
    const linkedDirectory = join(dir, "linked");
    symlinkSync(dir, linkedDirectory);
    refusesUntouched(
      live,
      partsFor(live, { baselinePath: join(linkedDirectory, "oikonomia-demo.db") }),
      "baseline-not-dedicated",
    );
  });

  it("when the baseline is the ordinary installation's database", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    refusesUntouched(live, partsFor(live, { ordinaryPath: baseline }), "baseline-not-dedicated");
  });

  it("when the artifact directory holds a database", () => {
    const live = provisionLive(buildBaseline());
    refusesUntouched(live, partsFor(live, { artifactRoot: dir }), "artifacts-overlap");
  });

  it("when the artifact directory is the ordinary installation's", () => {
    const live = provisionLive(buildBaseline());
    refusesUntouched(
      live,
      partsFor(live, { ordinaryArtifactRoot: join(dir, "demo-artifacts") }),
      "artifacts-overlap",
    );
  });

  it("when the baseline is not marked", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const edit = new Database(baseline);
    edit.prepare("DELETE FROM demo_state").run();
    edit.close();
    refusesUntouched(live, partsFor(live), "baseline-not-marked");
  });

  it("when the baseline is marked as a live installation rather than a baseline", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const edit = new Database(baseline);
    edit.prepare("UPDATE demo_state SET marker = 'demo-installation'").run();
    edit.close();
    refusesUntouched(live, partsFor(live), "baseline-not-marked");
  });

  it("when the live database is marked as a baseline", () => {
    const live = provisionLive(buildBaseline());
    live.prepare("UPDATE demo_state SET marker = 'demo-baseline'").run();
    refusesUntouched(live, partsFor(live), "live-not-marked");
  });

  it("when the baseline designates nobody", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const edit = new Database(baseline);
    edit.prepare("DELETE FROM demo_identity").run();
    edit.close();
    refusesUntouched(live, partsFor(live), "baseline-has-no-designated-identities");
  });

  it("when the baseline carries a session", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const edit = new Database(baseline);
    edit
      .prepare(
        `INSERT INTO auth_session (id, account_id, created_at, last_seen_at, expires_at)
         VALUES ('baked-in', 'acc-demo-0', ?, ?, '2099-01-01T00:00:00Z')`,
      )
      .run(NOW, NOW);
    edit.close();
    refusesUntouched(live, partsFor(live), "baseline-has-runtime-state");
  });

  it("when the baseline is not a database at all", () => {
    const live = provisionLive(buildBaseline());
    writeFileSync(join(dir, "oikonomia-demo-baseline.db"), "this is not SQLite, it is a note");
    refusesUntouched(live, partsFor(live), "baseline-unreadable");
  });

  it("when the baseline has broken references", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const edit = new Database(baseline);
    edit.pragma("foreign_keys = OFF");
    edit
      .prepare(
        `INSERT INTO demo_identity (id, person_id, kind, display_order, created_at)
         VALUES ('demo-orphan', 'per-does-not-exist', 'designated', 9, ?)`,
      )
      .run(NOW);
    edit.close();
    refusesUntouched(live, partsFor(live), "baseline-integrity-failed");
  });

  it("when the baseline's pages are damaged", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const bytes = readFileSync(baseline);
    /* Scribble over pages past the header, where table b-trees live. */
    for (let offset = 8192; offset < bytes.length; offset += 4096) {
      bytes.fill(0x5a, offset + 16, offset + 400);
    }
    writeFileSync(baseline, bytes);

    visitorsChange(live);
    const before = snapshot(live);
    let thrown: unknown;
    try {
      resetDemo(partsFor(live));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DemoResetRefused);
    expect(["baseline-unreadable", "baseline-integrity-failed", "baseline-not-marked"]).toContain(
      (thrown as DemoResetRefused).reason,
    );
    expect(snapshot(live)).toEqual(before);
  });

  it("when the baseline cannot be migrated to this version's schema", () => {
    const live = provisionLive(buildBaseline());
    const unmigratable = [
      ...bundledMigrations(),
      { version: 999, name: "cannot_apply", sql: "INSERT INTO campus (id) VALUES (NULL);" },
    ];
    refusesUntouched(
      live,
      partsFor(live, { migrations: unmigratable }),
      "baseline-schema-incompatible",
    );
  });

  it("when the baseline comes from a newer schema than the live database", () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    const edit = new Database(baseline);
    edit.prepare("INSERT INTO schema_migrations VALUES (999, 'from_the_future', ?)").run(NOW);
    edit.close();
    refusesUntouched(live, partsFor(live), "schema-mismatch");
  });

  it("when a table's columns differ", () => {
    const live = provisionLive(buildBaseline());
    live.exec("ALTER TABLE venue ADD COLUMN only_here TEXT");
    refusesUntouched(live, partsFor(live), "schema-mismatch");
  });

  it("when the schema has a trigger a row copy would set off", () => {
    const live = provisionLive(buildBaseline());
    live.exec("CREATE TRIGGER audit_person AFTER DELETE ON person BEGIN SELECT 1; END");
    refusesUntouched(live, partsFor(live), "schema-unsupported");
  });
});

describe("a restore that fails part-way", () => {
  it("rolls back: the live data, the generation and the artifacts are as they were", () => {
    const baseline = buildBaseline();
    /* Two venues with one name in the baseline, and a rule against that only in
       the live database: every earlier table has already been emptied and
       refilled when `venue` fails. */
    const edit = new Database(baseline);
    edit
      .prepare(
        "UPDATE venue SET name = 'Same Name' WHERE rowid IN (SELECT rowid FROM venue LIMIT 2)",
      )
      .run();
    edit.close();
    const live = provisionLive(baseline);
    live
      .prepare(
        "DELETE FROM venue WHERE name = 'Same Name' AND rowid = (SELECT MAX(rowid) FROM venue WHERE name = 'Same Name')",
      )
      .run();
    live.exec("CREATE UNIQUE INDEX injected_venue_name ON venue (name)");
    visitorsChange(live);
    const parts = partsFor(live);
    (parts.artifacts as LocalStorage).put("export.json", "{}");
    const before = snapshot(live);

    expect(() => resetDemo(parts)).toThrow(DemoResetFailed);

    expect(snapshot(live)).toEqual(before);
    expect(readDemoState(live)).toEqual({
      marker: "demo-installation",
      generation: 0,
      lastResetAt: null,
    });
    expect(live.inTransaction).toBe(false);
    expect(attached(live)).not.toContain("demo_baseline");
    expect(readdirSync(join(dir, "demo-artifacts"))).toHaveLength(1);
    expect(live.pragma("integrity_check", { simple: true })).toBe("ok");

    /* And the installation is still usable. */
    live
      .prepare(
        "UPDATE person SET name = 'Still writable' WHERE id = (SELECT id FROM person LIMIT 1)",
      )
      .run();
  });
});

describe("the tables a reset restores", () => {
  it("are every application table in the current schema, except the two that describe the database", () => {
    const db = track(openDatabase(join(dir, "schema.db")));
    const all = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);

    expect([...RESET_EXCLUDED_TABLES].sort()).toEqual(["demo_state", "schema_migrations"]);
    expect(restorableTables(db)).toEqual(
      all.filter((name) => !RESET_EXCLUDED_TABLES.includes(name)),
    );
    expect(restorableTables(db).length).toBeGreaterThanOrEqual(45);
  });

  /* A trigger, a virtual table or a generated column would make "delete and
     copy every row" wrong — and the reset refuses them. A migration that adds
     one must change how a demonstration is reset, and this says so first. */
  it("use nothing a row-for-row copy cannot reproduce", () => {
    const db = track(openDatabase(join(dir, "schema.db")));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()).toEqual([]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE 'CREATE VIRTUAL TABLE%'").all(),
    ).toEqual([]);
    for (const table of restorableTables(db)) {
      const hidden = (
        db.prepare(`PRAGMA table_xinfo("${table}")`).all() as { hidden: number }[]
      ).filter((column) => column.hidden !== 0);
      expect(hidden, table).toEqual([]);
    }
  });
});

/**
 * Several connections to one file, each on its own thread — the shape of
 * Passenger's processes, each with its own SQLite handle. `better-sqlite3` is
 * synchronous, so two connections on one thread could never overlap; threads
 * really do.
 */
describe("a reset among other connections", () => {
  const WORKER = String.raw`
    const { workerData, parentPort } = require("node:worker_threads");
    const Database = require("better-sqlite3");
    const flags = new Int32Array(workerData.flags);
    const db = new Database(workerData.path, { timeout: workerData.timeout });
    const insert = (key) =>
      db.prepare("INSERT INTO auth_throttle (key, window_started_at, attempts, updated_at) VALUES (?, 'x', 1, 'x')").run(key);
    const people = () => db.prepare("SELECT COUNT(*) AS n FROM person").get().n;
    const waitFor = (slot) => { while (Atomics.load(flags, slot) === 0) Atomics.wait(flags, slot, 0, 50); };

    if (workerData.role === "holder") {
      db.exec("BEGIN IMMEDIATE");
      insert("held-before-reset");
      Atomics.store(flags, 0, 1); Atomics.notify(flags, 0);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.holdMs);
      db.exec("COMMIT");
      parentPort.postMessage({ role: "holder", committedAt: Date.now() });
    }
    if (workerData.role === "impatient") {
      people();
      parentPort.postMessage({ role: "ready" });
      waitFor(0);
      try { insert("impatient"); parentPort.postMessage({ role: "impatient", busy: false }); }
      catch (error) { parentPort.postMessage({ role: "impatient", busy: error.code === "SQLITE_BUSY" }); }
    }
    if (workerData.role === "patient") {
      people();
      parentPort.postMessage({ role: "ready" });
      waitFor(0);
      const started = Date.now();
      insert("patient");
      parentPort.postMessage({ role: "patient", waitedMs: Date.now() - started, at: Date.now() });
    }
    if (workerData.role === "reader") {
      people();
      parentPort.postMessage({ role: "ready" });
      waitFor(0);
      const during = people();
      waitFor(1);
      parentPort.postMessage({ role: "reader", during, after: people() });
    }
    db.close();
  `;

  const start = (data: Record<string, unknown>) => {
    const worker = new Worker(WORKER, { eval: true, workerData: data });
    const messages: Record<string, unknown>[] = [];
    const ready = new Promise<void>((resolve) =>
      worker.on("message", (message: Record<string, unknown>) => {
        messages.push(message);
        if (message["role"] === "ready") resolve();
      }),
    );
    const exited = new Promise<void>((resolve, reject) => {
      worker.on("error", reject);
      worker.on("exit", () => resolve());
    });
    return { ready, exited, messages };
  };

  it("waits for a writer that holds the lock, then restores everything, its write included", async () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    visitorsChange(live);
    const flags = new SharedArrayBuffer(8);
    const holder = start({ role: "holder", path: live.name, timeout: 5000, flags, holdMs: 400 });

    /* Block until the other connection really holds the write lock. */
    Atomics.wait(new Int32Array(flags), 0, 0, 5000);
    expect(Atomics.load(new Int32Array(flags), 0)).toBe(1);
    const began = Date.now();
    const result = resetDemo(partsFor(live));
    const tookMs = Date.now() - began;
    await holder.exited;

    expect(result).toMatchObject({ status: "reset", generation: 1 });
    expect(tookMs).toBeGreaterThanOrEqual(250);
    /* The competing transaction committed first, and was restored away with the rest. */
    expect(snapshot(live)).toEqual(snapshotOf(baseline));
    expect(live.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(live.pragma("foreign_key_check")).toEqual([]);
  });

  it("gives up without touching anything when the lock is never released in time", async () => {
    const baseline = buildBaseline();
    provisionLive(baseline).close();
    const livePath = join(dir, "oikonomia-demo.db");
    const impatientReset = track(new Database(livePath, { timeout: 100 }));
    impatientReset.pragma("foreign_keys = ON");
    visitorsChange(impatientReset);
    const before = snapshot(impatientReset);
    const flags = new SharedArrayBuffer(8);
    const holder = start({ role: "holder", path: livePath, timeout: 5000, flags, holdMs: 1500 });
    Atomics.wait(new Int32Array(flags), 0, 0, 5000);

    expect(() => resetDemo(partsFor(impatientReset))).toThrow(DemoResetFailed);
    await holder.exited;

    /* Only the holder's own committed row differs. */
    const after = snapshot(impatientReset);
    expect({ ...after, auth_throttle: [] }).toEqual({ ...before, auth_throttle: [] });
    expect(readDemoState(impatientReset)?.generation).toBe(0);
  });

  it("holds other writers off while it runs, and every open connection sees the result", async () => {
    const baseline = buildBaseline();
    const live = provisionLive(baseline);
    visitorsChange(live);
    const peopleBefore = count(live, "SELECT COUNT(*) AS n FROM person");
    const peopleInBaseline = count(
      new Database(baseline, { readonly: true }),
      "SELECT COUNT(*) AS n FROM person",
    );
    const flags = new SharedArrayBuffer(8);
    const shared = { path: live.name, flags };
    const impatient = start({ ...shared, role: "impatient", timeout: 0 });
    const patient = start({ ...shared, role: "patient", timeout: 5000 });
    const reader = start({ ...shared, role: "reader", timeout: 5000 });
    await Promise.all([impatient.ready, patient.ready, reader.ready]);

    let committedAround = 0;
    const result = resetDemo(
      partsFor(live, {
        /* Asked for the reset's own timestamp: inside the transaction, every
           row already restored, just before COMMIT. Let the others try now. */
        now: () => {
          const view = new Int32Array(flags);
          Atomics.store(view, 0, 1);
          Atomics.notify(view, 0);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
          committedAround = Date.now();
          return new Date(NOW);
        },
      }),
    );
    Atomics.store(new Int32Array(flags), 1, 1);
    Atomics.notify(new Int32Array(flags), 1);
    await Promise.all([impatient.exited, patient.exited, reader.exited]);

    expect(result).toMatchObject({ status: "reset", generation: 1 });

    const said = (role: string) =>
      [...impatient.messages, ...patient.messages, ...reader.messages].find(
        (message) => message["role"] === role,
      )!;
    /* A writer that will not wait is refused, not interleaved. */
    expect(said("impatient")).toMatchObject({ busy: true });
    /* A writer that waits gets in after the reset — a later write, not a torn one. */
    expect(said("patient")["waitedMs"] as number).toBeGreaterThanOrEqual(200);
    expect(said("patient")["at"] as number).toBeGreaterThanOrEqual(committedAround);
    /* A reader on its own, already-open handle saw the old data during the
       reset and the restored data after it, without reopening. */
    expect(said("reader")).toEqual({
      role: "reader",
      during: peopleBefore,
      after: peopleInBaseline,
    });

    const after = snapshot(live);
    expect(after["auth_throttle"]!.map((row) => JSON.parse(row).key)).toEqual(["patient"]);
    expect({ ...after, auth_throttle: [] }).toEqual({ ...snapshotOf(baseline), auth_throttle: [] });
    expect(live.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(live.pragma("foreign_key_check")).toEqual([]);
  });
});
