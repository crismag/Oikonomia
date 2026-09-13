import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bundledMigrations } from "../db/bundled-migrations";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { createConfigurationRepository } from "./configuration-repository";
import { applyOptionOverrides, applyScalarOverrides } from "@/config/overrides";

/**
 * One stored value per configuration key.
 *
 * The table's original uniqueness constraint contained a NULL on every row and
 * so never matched: each save added a row, and reads returned whichever copy
 * SQLite found first. Migration 034 keys the table on what `find()` always
 * meant, and collapses the duplicates an installation already has without
 * changing what its configuration says.
 */

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-config-"));
});

afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const rowsFor = (namespace: string) =>
  db
    .prepare(
      "SELECT option_id, field, value, is_addition FROM configuration_setting WHERE namespace = ?",
    )
    .all(namespace) as {
    option_id: string | null;
    field: string | null;
    value: string;
    is_addition: number;
  }[];

describe("saving configuration", () => {
  beforeEach(() => {
    db = openDatabase(join(dir, "current.db"));
  });

  it("updates an option override in place when it is saved again", () => {
    const repo = createConfigurationRepository(db);
    repo.set({
      namespace: "reports.statuses",
      optionId: "draft",
      value: { label: "Draft" },
      actorId: "per-1",
    });
    repo.set({
      namespace: "reports.statuses",
      optionId: "draft",
      value: { label: "Being written" },
      actorId: "per-2",
    });

    expect(rowsFor("reports.statuses")).toHaveLength(1);
    expect(repo.find("reports.statuses", "draft")).toMatchObject({
      value: { label: "Being written" },
      updatedById: "per-2",
    });
  });

  it("updates a scalar setting in place when it is saved again", () => {
    const repo = createConfigurationRepository(db);
    repo.set({
      namespace: "site.profile",
      field: "timezone",
      value: "America/Toronto",
      actorId: "per-1",
    });
    repo.set({
      namespace: "site.profile",
      field: "timezone",
      value: "Europe/London",
      actorId: "per-1",
    });

    expect(rowsFor("site.profile")).toHaveLength(1);
    expect(repo.find("site.profile", undefined, "timezone")?.value).toBe("Europe/London");
  });

  it("keeps different keys apart", () => {
    const repo = createConfigurationRepository(db);
    repo.set({ namespace: "site.profile", field: "timezone", value: "UTC", actorId: "per-1" });
    repo.set({ namespace: "site.profile", field: "name", value: "Grace", actorId: "per-1" });
    repo.set({
      namespace: "reports.statuses",
      optionId: "draft",
      value: { label: "D" },
      actorId: "per-1",
    });
    repo.set({
      namespace: "reports.statuses",
      optionId: "final",
      value: { label: "F" },
      actorId: "per-1",
    });

    expect(rowsFor("site.profile")).toHaveLength(2);
    expect(rowsFor("reports.statuses")).toHaveLength(2);
  });

  it("keeps an added option added when it is edited afterwards", () => {
    const repo = createConfigurationRepository(db);
    repo.set({
      namespace: "people.roles",
      optionId: "deacon",
      value: { label: "Deacon" },
      isAddition: true,
      actorId: "per-1",
    });
    repo.set({
      namespace: "people.roles",
      optionId: "deacon",
      value: { label: "Deacon", active: false },
      actorId: "per-1",
    });

    expect(repo.find("people.roles", "deacon")).toMatchObject({
      isAddition: true,
      value: { active: false },
    });
  });

  it("refuses a second row for the same key at the database, not only in the repository", () => {
    const insert = db.prepare(
      `INSERT INTO configuration_setting (id, namespace, option_id, field, value, updated_at, updated_by)
       VALUES (?, 'site.profile', NULL, 'timezone', '"UTC"', '2026-01-01', 'per-1')`,
    );
    insert.run("cfg-a");
    expect(() => insert.run("cfg-b")).toThrow(/UNIQUE/);
  });
});

describe("an installation that already has duplicates", () => {
  const OPTIONS = [
    { id: "draft", label: "Draft", active: true, sortOrder: 1 },
    { id: "final", label: "Final", active: true, sortOrder: 2 },
  ];
  const SCALARS = { timezone: "America/Toronto", name: "Oikonomia" };

  /** Open a database at the schema before 034, so duplicates can exist. */
  const before034 = () => {
    const path = join(dir, "existing.db");
    const raw = new Database(path);
    raw.pragma("foreign_keys = ON");
    migrate(
      raw,
      bundledMigrations().filter((migration) => migration.version < 34),
    );
    return raw;
  };

  const put = (raw: Db, rows: [string, string | null, string | null, string, number?][]) => {
    const insert = raw.prepare(
      `INSERT INTO configuration_setting (id, namespace, option_id, field, value, is_addition, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', 'per-1')`,
    );
    rows.forEach(([namespace, optionId, field, value, addition], index) =>
      insert.run(`cfg-${index}`, namespace, optionId, field, value, addition ?? 0),
    );
  };

  /** What the registry makes of the stored rows — the meaning that must not change. */
  const effective = (raw: Db) => {
    const overrides = createConfigurationRepository(raw).all();
    return {
      statuses: applyOptionOverrides("reports.statuses", OPTIONS, overrides),
      roles: applyOptionOverrides("people.roles", [], overrides),
      site: applyScalarOverrides("site.profile", SCALARS, overrides),
    };
  };

  it("collapses them into one row per key without changing what the configuration says", () => {
    const raw = before034();
    put(raw, [
      /* An option edited three times; `find()` used to return the first copy,
         so each save carried only part of the history. */
      ["reports.statuses", "draft", null, JSON.stringify({ label: "Drafting" }), 0],
      ["reports.statuses", "draft", null, JSON.stringify({ active: false }), 0],
      ["reports.statuses", "draft", null, JSON.stringify({ label: "Being written" }), 0],
      /* A row nothing can parse sits between two good ones. */
      ["reports.statuses", "final", null, JSON.stringify({ label: "Done" }), 0],
      ["reports.statuses", "final", null, "{not json", 0],
      /* An added option whose later edit was written without the flag. */
      ["people.roles", "deacon", null, JSON.stringify({ label: "Deacon" }), 1],
      ["people.roles", "deacon", null, JSON.stringify({ capabilities: ["campus-oversight"] }), 0],
      /* A scalar saved twice, and one saved once. */
      ["site.profile", null, "timezone", JSON.stringify("Europe/London"), 0],
      ["site.profile", null, "timezone", JSON.stringify("Africa/Lagos"), 0],
      ["site.profile", null, "name", JSON.stringify("Grace Fellowship"), 0],
    ]);

    const meaningBefore = effective(raw);
    migrate(raw, bundledMigrations());
    db = raw;

    expect(effective(raw)).toEqual(meaningBefore);

    expect(rowsFor("reports.statuses")).toHaveLength(2);
    expect(rowsFor("people.roles")).toHaveLength(1);
    expect(rowsFor("site.profile")).toHaveLength(2);

    const repo = createConfigurationRepository(raw);
    expect(repo.find("reports.statuses", "draft")?.value).toEqual({
      label: "Being written",
      active: false,
    });
    expect(repo.find("reports.statuses", "final")?.value).toEqual({ label: "Done" });
    expect(repo.find("people.roles", "deacon")).toMatchObject({
      isAddition: true,
      value: { label: "Deacon", capabilities: ["campus-oversight"] },
    });
    expect(repo.find("site.profile", undefined, "timezone")?.value).toBe("Africa/Lagos");
  });

  it("leaves an installation without duplicates exactly as it was", () => {
    const raw = before034();
    put(raw, [
      ["reports.statuses", "draft", null, JSON.stringify({ label: "Drafting" }), 0],
      ["site.profile", null, "timezone", JSON.stringify("Europe/London"), 0],
    ]);
    const stored = raw.prepare("SELECT * FROM configuration_setting ORDER BY id").all();

    migrate(raw, bundledMigrations());
    db = raw;

    expect(raw.prepare("SELECT * FROM configuration_setting ORDER BY id").all()).toEqual(stored);
  });

  it("migrates an empty installation", () => {
    const raw = before034();
    migrate(raw, bundledMigrations());
    db = raw;
    expect(rowsFor("site.profile")).toEqual([]);
    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE name = 'configuration_setting_key'").get(),
    ).toBeDefined();
  });
});
