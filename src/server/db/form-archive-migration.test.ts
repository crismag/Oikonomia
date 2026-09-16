import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { loadMigrations, migrate } from "./migrate";

/**
 * Migration 040 rebuilds `form_record` to drop its cascading foreign key. A
 * rebuild copies rows, so this checks that an installation that already has
 * filled-in forms keeps every one — and that afterwards deleting their form is
 * refused rather than taking them with it.
 */
describe("migration 040: records outlive their form", () => {
  const all = loadMigrations(join(__dirname, "migrations"));

  it("keeps existing records and stops the cascade", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(
      db,
      all.filter((m) => m.version < 40),
    );

    const at = "2026-09-01T00:00:00.000Z";
    db.prepare(
      "INSERT INTO form_definition (id, title, owner_id, created_at, updated_at) VALUES ('d1', 'Check', 'p1', ?, ?)",
    ).run(at, at);
    db.prepare(
      `INSERT INTO form_record (id, definition_id, form_version, title, created_by, created_at, updated_at, status)
       VALUES ('r1', 'd1', 1, 'September', 'p1', ?, ?, 'completed')`,
    ).run(at, at);

    migrate(db, all);

    expect(db.prepare("SELECT id, status FROM form_record").all()).toEqual([
      { id: "r1", status: "completed" },
    ]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(() => db.prepare("DELETE FROM form_definition WHERE id = 'd1'").run()).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM form_record").get()).toEqual({ n: 1 });
    db.close();
  });
});
