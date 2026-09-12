import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The application contains no sample data.
 *
 * This is the guard that makes the claim checkable rather than aspirational.
 * Oikonomia used to ship with a church inside it — three campuses, four
 * ministries, ninety-one people, a year of meetings — imported directly by
 * forty files and written into the database on the first request. A fresh
 * installation displayed a congregation nobody had entered.
 *
 * The fixtures still exist, because tests need something recognisable to
 * assert against. They live under `src/test/`, and this file fails if anything
 * that can run in the application reaches for them.
 *
 * > Deleting these tests does not make the rule go away; it makes it
 * > unenforced. If a legitimate exception ever appears, add it to `ALLOWED`
 * > with the reason, so the exception is a decision somebody made rather than
 * > a drift nobody noticed.
 */

const ROOT = new URL("./", import.meta.url).pathname;

/** Directories whose contents run in the application. */
const RUNTIME = ["routes", "components", "lib", "domain", "server"];

/** Imports that would put fixture data into the running application. */
const FORBIDDEN = [
  /from\s+["'][^"']*\/test\/fixtures["']/,
  /from\s+["'][^"']*\/test\/form-fixtures["']/,
  /from\s+["'][^"']*\/test\/fixtures\.bulk["']/,
  /from\s+["'][^"']*\/test\/seeds["']/,
  /from\s+["'][^"']*\/test\/viewer["']/,
  /from\s+["']@\/domain\/fixtures["']/,
  /from\s+["']@\/domain\/form-fixtures["']/,
  /from\s+["'][^"']*seed-[a-z-]+["']/,
];

const ALLOWED: string[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const runtimeFiles = RUNTIME.flatMap((dir) => walk(join(ROOT, dir)))
  .map((file) => relative(ROOT, file))
  .filter((file) => !ALLOWED.includes(file));

describe("no sample data reaches the application", () => {
  it("has runtime files to check", () => {
    /* A path change that silently emptied this list would turn every test
       below into a test of nothing. */
    expect(runtimeFiles.length).toBeGreaterThan(100);
  });

  it("imports no fixture, seed or test helper anywhere it could run", () => {
    const offenders = runtimeFiles.filter((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return FORBIDDEN.some((pattern) => pattern.test(source));
    });

    expect(offenders).toEqual([]);
  });

  /**
   * Seeding used to happen inside the request path: every API module called
   * its section's seed before answering, so the first page view of a fresh
   * installation created a fictional church.
   */
  it("never seeds from a request handler", () => {
    const offenders = runtimeFiles.filter((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return /\bseed[A-Z]\w*\s*\(/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
