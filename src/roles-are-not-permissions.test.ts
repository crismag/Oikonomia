import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { roles } from "@/domain/roles";
import { capabilities } from "@/domain/capabilities";

/**
 * A role is not a permission.
 *
 * Oikonomia distinguishes three things that are easy to collapse into one:
 *
 * - a person's **title** — "LifeGroup Leader · Music Ministry" — which is free
 *   text the church writes for its own reading and which authorizes nothing;
 * - an **access role** — a named bundle a church assigns and may rename;
 * - a **capability** — the closed set the application actually enforces.
 *
 * The failure this guards is the one the audit found twice: code that asks
 * *which role is this?* instead of *what may they do?*. That question turns a
 * name into protocol, so renaming a role silently changes who may act, and a
 * church that wants a fifth role finds it has no permissions at all.
 *
 * > Deleting this test does not make the rule go away; it makes it unenforced.
 * > If a legitimate exception appears, add it to `ALLOWED` with the reason.
 */

const ROOT = new URL("./", import.meta.url).pathname;

/** Directories whose contents decide or display what somebody may do. */
const RUNTIME = ["routes", "components", "lib", "domain", "server"];

/**
 * Where a role id is legitimately a value rather than a rule.
 *
 * `roles.ts` defines the bundles; `capabilities.ts` defines the closed set the
 * bundles draw from. Both must name them.
 */
const ALLOWED = ["domain/roles.ts", "domain/capabilities.ts"];

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

/** `persona.id === "bishop"`, `accessRole !== 'admin'`, and their relatives. */
const comparisons = roles.map(
  (role) =>
    new RegExp(String.raw`(persona\.id|accessRole|role\.id|roleId)\s*[!=]==?\s*["']${role.id}["']`),
);

describe("authorization asks what somebody may do, never who they are", () => {
  it("has runtime files to check", () => {
    expect(runtimeFiles.length).toBeGreaterThan(100);
  });

  it("compares no role id anywhere that runs", () => {
    const offenders = runtimeFiles.filter((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return comparisons.some((pattern) => pattern.test(source));
    });

    expect(offenders).toEqual([]);
  });

  /**
   * The other half of the separation: every capability a role claims has to be
   * one the application actually enforces. A typo in a bundle would otherwise
   * be a permission that silently does nothing.
   */
  it("gives every role only capabilities the application defines", () => {
    for (const role of roles) {
      for (const capability of role.capabilities) {
        expect(
          capabilities.map((c) => c.id),
          role.id,
        ).toContain(capability);
      }
    }
  });

  /** Somebody must be able to administer the installation. */
  it("leaves at least one role able to administer", () => {
    expect(roles.some((role) => role.capabilities.includes("administration"))).toBe(true);
  });
});
