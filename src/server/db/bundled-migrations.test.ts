import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bundledMigrations } from "./bundled-migrations";
import { loadMigrations } from "./migrate";

const DIR = new URL("./migrations/", import.meta.url).pathname;

/**
 * The guard on a deployment failure that development cannot show you.
 *
 * Reading migrations from disk works in the repository and produces an
 * application that cannot open its database once built, because the bundler
 * never saw the dependency. These tests fail the moment the schema stops being
 * carried inside the build.
 */
describe("the migrations carried inside the build", () => {
  it("includes every migration file in the repository", () => {
    const onDisk = readdirSync(DIR).filter((name) => name.endsWith(".sql"));

    expect(bundledMigrations()).toHaveLength(onDisk.length);
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it("carries the same versions, names and SQL as the files themselves", () => {
    expect(bundledMigrations()).toEqual(loadMigrations(DIR));
  });

  it("is ordered by version, so the schema is built in the order it was written", () => {
    const versions = bundledMigrations().map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  /* Non-empty SQL, because a glob that resolved to module stubs rather than raw
     text would satisfy every count above and apply nothing. */
  it("carries real SQL rather than module wrappers", () => {
    for (const migration of bundledMigrations()) {
      expect(typeof migration.sql, migration.name).toBe("string");
      expect(migration.sql.trim().length, migration.name).toBeGreaterThan(0);
      expect(migration.sql, migration.name).toMatch(/CREATE|ALTER|INSERT|UPDATE|DROP/i);
    }
  });
});
