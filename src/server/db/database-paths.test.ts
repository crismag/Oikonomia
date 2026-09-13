import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { artifactRoot } from "../data/storage";
import { databasePath } from "./connection";
import { DatabasePathError, canonicalPath, liveDatabasePath, sameFile } from "./database-paths";

/**
 * A demonstration opens its own database and never the ordinary one.
 *
 * Its reset deletes and restores every row, so the one failure that must be
 * impossible is a demonstration pointed at a church's database. These tests
 * pin the rules that make it so: which variable is read in which mode, that
 * nothing falls back, and that "different" is decided by the file on disk.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-paths-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const env = (values: Record<string, string>) => ({ NODE_ENV: "production", ...values });

describe("which database an installation opens", () => {
  it("is OIKONOMIA_DB with Demo Mode off, whatever else is set", () => {
    const ordinary = join(dir, "oikonomia.db");
    expect(
      liveDatabasePath(
        false,
        env({ OIKONOMIA_DB: ordinary, OIKONOMIA_DEMO_DB: join(dir, "oikonomia-demo.db") }),
      ),
    ).toBe(ordinary);
  });

  it("is OIKONOMIA_DEMO_DB with Demo Mode on", () => {
    const demo = join(dir, "oikonomia-demo.db");
    expect(
      liveDatabasePath(
        true,
        env({ OIKONOMIA_DB: join(dir, "oikonomia.db"), OIKONOMIA_DEMO_DB: demo }),
      ),
    ).toBe(demo);
  });

  it("never falls back to the ordinary database when the demonstration's is not named", () => {
    expect(() => liveDatabasePath(true, env({ OIKONOMIA_DB: join(dir, "oikonomia.db") }))).toThrow(
      /OIKONOMIA_DEMO_DB is not set/,
    );
    expect(() =>
      liveDatabasePath(
        true,
        env({ OIKONOMIA_DB: join(dir, "oikonomia.db"), OIKONOMIA_DEMO_DB: "  " }),
      ),
    ).toThrow(DatabasePathError);
  });

  it("uses a separate development file for a demonstration", () => {
    expect(liveDatabasePath(true, { NODE_ENV: "development" })).toBe(
      join(process.cwd(), ".data", "oikonomia-demo.db"),
    );
    expect(liveDatabasePath(false, { NODE_ENV: "development" })).toBe(
      join(process.cwd(), ".data", "oikonomia.db"),
    );
  });

  it("refuses a demonstration database that is the ordinary one by name", () => {
    const same = join(dir, "oikonomia.db");
    expect(() =>
      liveDatabasePath(true, env({ OIKONOMIA_DB: same, OIKONOMIA_DEMO_DB: same })),
    ).toThrow(/same file as OIKONOMIA_DB/);
  });

  it("refuses one that is the ordinary database by another spelling", () => {
    mkdirSync(join(dir, "data"));
    expect(() =>
      liveDatabasePath(
        true,
        env({
          OIKONOMIA_DB: join(dir, "data", "oikonomia.db"),
          OIKONOMIA_DEMO_DB: `${dir}/data/../data/./oikonomia.db`,
        }),
      ),
    ).toThrow(/same file as OIKONOMIA_DB/);
  });

  it("refuses one that reaches the ordinary database through a symlinked directory, before either exists", () => {
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "alias"));
    expect(() =>
      liveDatabasePath(
        true,
        env({
          OIKONOMIA_DB: join(dir, "real", "oikonomia.db"),
          OIKONOMIA_DEMO_DB: join(dir, "alias", "oikonomia.db"),
        }),
      ),
    ).toThrow(/same file as OIKONOMIA_DB/);
  });

  it("refuses one that is a symlink or a hard link to the ordinary database", () => {
    const ordinary = join(dir, "oikonomia.db");
    writeFileSync(ordinary, "");
    symlinkSync(ordinary, join(dir, "symlinked.db"));
    linkSync(ordinary, join(dir, "hardlinked.db"));
    for (const alias of ["symlinked.db", "hardlinked.db"]) {
      expect(() =>
        liveDatabasePath(
          true,
          env({ OIKONOMIA_DB: ordinary, OIKONOMIA_DEMO_DB: join(dir, alias) }),
        ),
      ).toThrow(/same file as OIKONOMIA_DB/);
    }
  });

  it("refuses a demonstration database that is its own baseline", () => {
    const demo = join(dir, "oikonomia-demo.db");
    writeFileSync(demo, "");
    symlinkSync(demo, join(dir, "baseline-link.db"));
    expect(() =>
      liveDatabasePath(
        true,
        env({ OIKONOMIA_DEMO_DB: demo, OIKONOMIA_DEMO_BASELINE: join(dir, "baseline-link.db") }),
      ),
    ).toThrow(/same file as OIKONOMIA_DEMO_BASELINE/);
  });

  it("accepts three distinct files", () => {
    expect(
      liveDatabasePath(
        true,
        env({
          OIKONOMIA_DB: join(dir, "oikonomia.db"),
          OIKONOMIA_DEMO_DB: join(dir, "oikonomia-demo.db"),
          OIKONOMIA_DEMO_BASELINE: join(dir, "oikonomia-demo-baseline.db"),
        }),
      ),
    ).toBe(join(dir, "oikonomia-demo.db"));
  });
});

describe("the same file", () => {
  it("is decided by canonical path, not by spelling", () => {
    mkdirSync(join(dir, "a"));
    symlinkSync(join(dir, "a"), join(dir, "b"));
    expect(canonicalPath(join(dir, "b", "not-yet.db"))).toBe(
      canonicalPath(join(dir, "a", "not-yet.db")),
    );
    expect(sameFile(join(dir, "a", "x.db"), join(dir, "b", "x.db"))).toBe(true);
    expect(sameFile(join(dir, "a", "x.db"), join(dir, "a", "y.db"))).toBe(false);
  });

  it("is never an in-memory database", () => {
    expect(sameFile(":memory:", ":memory:")).toBe(false);
  });
});

describe("the running process", () => {
  it("opens the demonstration database when the environment says Demo Mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OIKONOMIA_DB", join(dir, "oikonomia.db"));
    vi.stubEnv("OIKONOMIA_DEMO_DB", join(dir, "oikonomia-demo.db"));

    vi.stubEnv("OIKONOMIA_DEMO_MODE", "false");
    expect(databasePath()).toBe(join(dir, "oikonomia.db"));

    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    expect(databasePath()).toBe(join(dir, "oikonomia-demo.db"));
  });

  it("will not open any database in Demo Mode without its own", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    vi.stubEnv("OIKONOMIA_DB", join(dir, "oikonomia.db"));
    vi.stubEnv("OIKONOMIA_DEMO_DB", "");
    expect(() => databasePath()).toThrow(/OIKONOMIA_DEMO_DB is not set/);
  });

  it("keeps a demonstration's artifacts apart from the ordinary installation's", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OIKONOMIA_ARTIFACTS", "");
    vi.stubEnv("OIKONOMIA_DB", join(dir, "oikonomia.db"));
    vi.stubEnv("OIKONOMIA_DEMO_DB", join(dir, "oikonomia-demo.db"));

    vi.stubEnv("OIKONOMIA_DEMO_MODE", "false");
    expect(artifactRoot()).toBe(join(dir, "artifacts"));

    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    expect(artifactRoot()).toBe(join(dir, "demo-artifacts"));
  });
});
