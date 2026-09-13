import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { SERVER_FUNCTIONS } from "@/server/installation/operations";
import { MAINTENANCE_TASKS, ROUTE_HANDLERS } from "@/server/installation/policy";

/**
 * Nothing reaches a public demonstration by default.
 *
 * Every server function in the source must have a decision in
 * `src/server/installation/operations.ts`, and every decision must name a
 * function that exists. Adding a mutation therefore means deciding — in the
 * same change — whether a public demonstration may run it. (A POST that slips
 * past this test is still refused at runtime; this test is what makes the
 * refusal a conscious choice rather than a surprise.)
 *
 * Discovered from source rather than counted, so the test follows the code
 * instead of a number somebody has to remember to update.
 */

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const files = sourceFiles(join(ROOT, "src")).map((path) => ({
  path: relative(ROOT, path).replaceAll("\\", "/"),
  source: readFileSync(path, "utf8"),
}));

/** `export const name = createServerFn({ method: "GET" | "POST" })`, the one form used. */
const DECLARATION = /export const (\w+) = createServerFn\(\{ method: "(GET|POST)" \}\)/g;

const declared = files.flatMap(({ path, source }) =>
  [...source.matchAll(DECLARATION)].map(([, name, method]) => ({
    key: `${path}#${name}`,
    method: method as "GET" | "POST",
  })),
);

describe("every server function has an installation-policy decision", () => {
  /* If a function is declared some other way, the discovery above cannot see
     it — so that is a failure too, not a silent gap. */
  it("finds every createServerFn call in the source", () => {
    const calls = files.flatMap(({ path, source }) =>
      [...source.matchAll(/createServerFn\(/g)].map(() => path),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(declared.length).toBe(calls.length);
  });

  it("has an entry for every server function", () => {
    const unclassified = declared
      .filter(({ key }) => !(key in SERVER_FUNCTIONS))
      .map(({ key, method }) => `${key} (${method})`);
    expect(unclassified, "classify these in src/server/installation/operations.ts").toEqual([]);
  });

  it("names no function that no longer exists", () => {
    const keys = new Set(declared.map(({ key }) => key));
    const stale = Object.keys(SERVER_FUNCTIONS).filter((key) => !keys.has(key));
    expect(stale).toEqual([]);
  });

  it("records the method each function actually declares", () => {
    const mismatched = declared
      .filter(({ key, method }) => SERVER_FUNCTIONS[key] && SERVER_FUNCTIONS[key].method !== method)
      .map(({ key }) => key);
    expect(mismatched).toEqual([]);
  });

  it("calls only GETs reads, and every POST allowed or denied", () => {
    for (const [key, policy] of Object.entries(SERVER_FUNCTIONS)) {
      if (policy.demo === "read") expect(policy.method, key).toBe("GET");
    }
  });

  it("gives every denial a reason", () => {
    for (const [key, policy] of Object.entries(SERVER_FUNCTIONS)) {
      if (policy.demo === "denied") expect(policy.because, key).toBeDefined();
      else expect(policy.because, key).toBeUndefined();
    }
  });
});

describe("every route handler has an installation-policy decision", () => {
  /* Route files that answer requests themselves (`server: { handlers }`)
     rather than render a page. */
  const handlers = files
    .filter(({ path, source }) => path.startsWith("src/routes/") && /\bhandlers\s*:/.test(source))
    .map(({ path, source }) => ({
      path,
      route: /createFileRoute\("([^"]+)"\)/.exec(source)?.[1],
    }));

  it("finds the route handlers", () => {
    expect(handlers.length).toBeGreaterThan(0);
    for (const { path, route } of handlers) expect(route, path).toBeDefined();
  });

  it("has an entry for every one, and none for a route that does not exist", () => {
    expect(handlers.map(({ route }) => route).sort()).toEqual(Object.keys(ROUTE_HANDLERS).sort());
  });

  it("has an entry for every maintenance task, and none for one that does not exist", () => {
    const maintenance = files.find(({ path }) => path === "src/routes/maintenance.run.tsx");
    const declaredTasks = /const TASKS = \[([^\]]*)\]/.exec(maintenance?.source ?? "")?.[1];
    expect(declaredTasks, "maintenance.run.tsx declares its TASKS").toBeDefined();

    const tasks = [...declaredTasks!.matchAll(/"([^"]+)"/g)].map(([, task]) => task!).sort();
    expect(tasks).toEqual(Object.keys(MAINTENANCE_TASKS).sort());
  });
});
