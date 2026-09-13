import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "@/server/db/connection";
import { seedAll } from "@/test/seeds";

/**
 * The two scripts that stand between "the current schema" and "a curated
 * Demo baseline the separate content project can hand back to Slice 8":
 *
 *   create-demo-baseline-builder.mjs — a clean, schema-only database;
 *   mark-demo-baseline.mjs — validates one that has been populated, and
 *   turns it into the file `demo-provision.mjs` and every reset expect.
 *
 * `seedAll` here stands in for the separate project's curated content — it is
 * the test-only fixture the rest of the suite already uses, never anything
 * that ships. Nothing here builds or approves real Demo content.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-baseline-scripts-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (script: string, args: string[]) =>
  spawnSync(process.execPath, [join(process.cwd(), "scripts", "ops", script), ...args], {
    encoding: "utf8",
  });

const buildBuilder = (to: string) => run("create-demo-baseline-builder.mjs", ["--to", to]);

/** A candidate the way a content project would leave one: curated content, plus
 * the runtime residue of actually having used the application to build it. */
function populatedCandidate(path: string): { personId: string } {
  const db = openDatabase(path);
  seedAll(db);
  const person = db.prepare("SELECT id FROM person ORDER BY id LIMIT 1").get() as { id: string };
  db.prepare(
    "INSERT INTO account (id, person_id, status, created_at) VALUES ('acc-1', ?, 'active', '2026-01-01T00:00:00Z')",
  ).run(person.id);
  db.prepare(
    "INSERT INTO account_credential (id, account_id, provider, secret, salt, algorithm, created_at, updated_at) VALUES ('cred-1', 'acc-1', 'password', 'x', 'y', 'scrypt', 'z', 'z')",
  ).run();
  db.prepare(
    "INSERT INTO auth_session (id, account_id, created_at, last_seen_at, expires_at) VALUES ('ses-1', 'acc-1', 'z', 'z', '2099-01-01T00:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO auth_token (id, account_id, purpose, created_at, expires_at) VALUES ('tok-1', 'acc-1', 'magic-link', 'z', '2099-01-01T00:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO auth_throttle (key, window_started_at, attempts, updated_at) VALUES ('sign-in:x', 'z', 1, 'z')",
  ).run();
  db.pragma("journal_mode = DELETE");
  db.close();
  return { personId: person.id };
}

describe("create-demo-baseline-builder.mjs", () => {
  it("creates a database at the current schema, with nothing but the seeded defaults", () => {
    const to = join(dir, "builder.db");
    const result = buildBuilder(to);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(to)).toBe(true);

    const db = new Database(to, { readonly: true, fileMustExist: true });
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((row) => row.name);

    expect(tables).toContain("demo_state");
    expect(tables).toContain("demo_identity");
    for (const table of tables) {
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
      if (!["retention_policy", "schema_migrations"].includes(table)) {
        expect(n, table).toBe(0);
      }
    }
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    /* Not yet a baseline: unmarked, designates nobody. */
    expect(db.prepare("SELECT * FROM demo_state").get()).toBeUndefined();
    db.close();
  });

  it("refuses to create where a file already exists", () => {
    const to = join(dir, "builder.db");
    expect(buildBuilder(to).status).toBe(0);
    const second = buildBuilder(to);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already exists/);
  });
});

describe("mark-demo-baseline.mjs", () => {
  it("validates only, and writes nothing, without --to or --in-place", () => {
    const candidate = join(dir, "candidate.db");
    expect(buildBuilder(candidate).status).toBe(0);

    const result = run("mark-demo-baseline.mjs", ["--candidate", candidate]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/designates nobody/);
    const db = new Database(candidate, { readonly: true });
    expect(db.prepare("SELECT * FROM demo_state").get()).toBeUndefined();
    db.close();
  });

  it("refuses --designate or --sanitize without --to or --in-place", () => {
    const candidate = join(dir, "candidate.db");
    expect(buildBuilder(candidate).status).toBe(0);

    const result = run("mark-demo-baseline.mjs", ["--candidate", candidate, "--sanitize"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/pass --to|--in-place/);
  });

  it("designates, sanitizes and marks a copy with --to, leaving the candidate untouched", () => {
    const candidate = join(dir, "candidate.db");
    const { personId } = populatedCandidate(candidate);
    const candidateBefore = readFileSync(candidate);
    const out = join(dir, "oikonomia-demo-baseline.db");

    const result = run("mark-demo-baseline.mjs", [
      "--candidate",
      candidate,
      "--designate",
      personId,
      "--sanitize",
      "--to",
      out,
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Marked/);

    /* The candidate was only ever read: VACUUM INTO doesn't touch its
       bytes, and neither --designate nor --sanitize ran against it. */
    expect(readFileSync(candidate)).toEqual(candidateBefore);
    const before = new Database(candidate, { readonly: true });
    expect((before.prepare("SELECT COUNT(*) n FROM auth_session").get() as { n: number }).n).toBe(
      1,
    );
    before.close();

    const baseline = new Database(out, { readonly: true, fileMustExist: true });
    expect(baseline.prepare("SELECT marker FROM demo_state WHERE id = 1").get()).toEqual({
      marker: "demo-baseline",
    });
    expect(
      (
        baseline
          .prepare(
            "SELECT COUNT(*) n FROM demo_identity WHERE kind = 'designated' AND person_id = ?",
          )
          .get(personId) as { n: number }
      ).n,
    ).toBe(1);
    for (const table of ["auth_session", "auth_token", "auth_throttle", "account_credential"]) {
      expect(
        (baseline.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as { n: number }).n,
        table,
      ).toBe(0);
    }
    expect(baseline.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(baseline.pragma("foreign_key_check")).toEqual([]);
    expect(String(baseline.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("delete");
    baseline.close();
  });

  it("marks the candidate itself with --in-place", () => {
    const candidate = join(dir, "candidate.db");
    const { personId } = populatedCandidate(candidate);

    const result = run("mark-demo-baseline.mjs", [
      "--candidate",
      candidate,
      "--designate",
      personId,
      "--sanitize",
      "--in-place",
    ]);

    expect(result.status, result.stderr).toBe(0);
    const db = new Database(candidate, { readonly: true });
    expect(db.prepare("SELECT marker FROM demo_state WHERE id = 1").get()).toEqual({
      marker: "demo-baseline",
    });
    expect((db.prepare("SELECT COUNT(*) n FROM auth_session").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("refuses an already-designated but still-sanitized-short candidate, and leaves --to unwritten", () => {
    const candidate = join(dir, "candidate.db");
    const { personId } = populatedCandidate(candidate);
    const out = join(dir, "out.db");

    const result = run("mark-demo-baseline.mjs", [
      "--candidate",
      candidate,
      "--designate",
      personId,
      "--to",
      out,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/session|token|throttle|credential/);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a database marked as a live installation, not a baseline", () => {
    const candidate = join(dir, "candidate.db");
    const { personId } = populatedCandidate(candidate);
    const db = new Database(candidate);
    db.exec(
      "DELETE FROM auth_session; DELETE FROM auth_token; DELETE FROM auth_throttle; DELETE FROM account_credential;",
    );
    db.prepare(
      "INSERT INTO demo_identity (id, person_id, kind, display_order, created_at) VALUES ('demo-1', ?, 'designated', 0, 'z')",
    ).run(personId);
    db.prepare("INSERT INTO demo_state (id, marker) VALUES (1, 'demo-installation')").run();
    db.close();

    const result = run("mark-demo-baseline.mjs", ["--candidate", candidate]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/demo-installation/);
  });

  it("refuses a candidate whose schema has drifted from the current migrations", () => {
    const candidate = join(dir, "candidate.db");
    const { personId } = populatedCandidate(candidate);
    const db = new Database(candidate);
    db.exec(
      "DELETE FROM auth_session; DELETE FROM auth_token; DELETE FROM auth_throttle; DELETE FROM account_credential;",
    );
    db.prepare(
      "INSERT INTO demo_identity (id, person_id, kind, display_order, created_at) VALUES ('demo-1', ?, 'designated', 0, 'z')",
    ).run(personId);
    db.exec("ALTER TABLE venue ADD COLUMN unexpected TEXT");
    db.close();

    const result = run("mark-demo-baseline.mjs", ["--candidate", candidate]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/venue/);
  });

  it("refuses to overwrite an existing --to target", () => {
    const candidate = join(dir, "candidate.db");
    const { personId } = populatedCandidate(candidate);
    const out = join(dir, "out.db");
    expect(buildBuilder(out).status).toBe(0);

    const result = run("mark-demo-baseline.mjs", [
      "--candidate",
      candidate,
      "--designate",
      personId,
      "--to",
      out,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already exists/);
  });

  it("refuses to designate a person id that does not exist in the candidate", () => {
    const candidate = join(dir, "candidate.db");
    populatedCandidate(candidate);
    const out = join(dir, "out.db");

    const result = run("mark-demo-baseline.mjs", [
      "--candidate",
      candidate,
      "--designate",
      "per-nobody",
      "--to",
      out,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/does not exist/);
    expect(existsSync(out)).toBe(false);
  });
});
