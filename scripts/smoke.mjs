/**
 * Does the thing we just built actually serve a request?
 *
 * ## Why this exists
 *
 * The release readiness audit found a P0 that every other check passed: the
 * production build did not carry the SQL migrations, so a deployed Oikonomia
 * could not open its own database and every page said "Oikonomia could not be
 * reached". Tests, typecheck, lint and the build itself were all green.
 *
 * The gap was that nothing ever *ran* the built server. This does: it starts
 * `.output/server/index.mjs` against a database file that does not exist yet,
 * asks for a page, and insists the schema was created. That is the exact
 * failure mode, reproduced in about ten seconds.
 *
 * Deliberately not a test framework. It runs after `npm run build` against
 * build output, which is not what vitest is pointed at, and it must be
 * runnable by hand when a deployment misbehaves.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 8123);
const BASE = `http://127.0.0.1:${PORT}`;
const ENTRY = ".output/server/index.mjs";

const dir = mkdtempSync(join(tmpdir(), "oikonomia-smoke-"));
const database = join(dir, "smoke.db");

let server;
const failures = [];

const check = (name, condition, detail = "") => {
  if (condition) console.log(`  ok    ${name}`);
  else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
};

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(BASE + "/login");
      return true;
    } catch {
      if (server?.exitCode !== null && server?.exitCode !== undefined) return false;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

try {
  if (!existsSync(ENTRY)) {
    console.error(`No ${ENTRY}. Run \`npm run build\` first.`);
    process.exit(1);
  }

  console.log("Starting the built server against an empty database…");
  server = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      OIKONOMIA_DB: database,
      OIKONOMIA_URL: BASE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  server.stdout.on("data", (chunk) => (output += chunk));
  server.stderr.on("data", (chunk) => (output += chunk));

  if (!(await waitForServer())) {
    console.error("The built server never started listening.\n" + output);
    process.exit(1);
  }

  /* 1. It serves. */
  const login = await fetch(BASE + "/login");
  check("GET /login responds 200", login.status === 200, `got ${login.status}`);

  /* 2. Security headers reach a real response. */
  check("sends X-Content-Type-Options", login.headers.get("x-content-type-options") === "nosniff");
  check("sends a Content-Security-Policy", Boolean(login.headers.get("content-security-policy")));
  check("cannot be framed", login.headers.get("x-frame-options") === "DENY");

  /*
   * 3. The one that matters most.
   *
   *    Ordinary routes return the application shell without touching
   *    persistence — the data arrives later, from the browser — so a 200 from
   *    /people says nothing about whether the schema exists. `/healthz` opens
   *    the database, which is the exact operation that failed with ENOENT when
   *    the build carried no migrations.
   */
  const health = await fetch(BASE + "/healthz");
  check("GET /healthz responds 200", health.status === 200, `got ${health.status}`);

  const reported = health.status === 200 ? await health.json() : { ok: false };
  check("the server can open its database", reported.ok === true);

  /*
   * Inspecting the file the server just created.
   *
   * Every read here is guarded, because the failure this script exists to
   * catch makes all of them throw: with no bundled migrations there is no
   * database file, no `schema_migrations`, and no `person`. A crash would
   * still fail the build, but "no such table" as an unhandled exception tells
   * whoever reads the log much less than a named check does.
   */
  const inspect = (name, read, verdict, describe = String) => {
    try {
      const value = read();
      check(name, verdict(value), describe(value));
    } catch (error) {
      check(name, false, error instanceof Error ? error.message : String(error));
    }
  };

  const { default: Database } = await import("better-sqlite3");
  const { readdirSync } = await import("node:fs");
  const onDisk = readdirSync("src/server/db/migrations").filter((f) => f.endsWith(".sql")).length;

  let db;
  try {
    db = new Database(database, { readonly: true, fileMustExist: true });
  } catch (error) {
    check(
      "the server created its database file",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (db) {
    inspect(
      "the database was created and migrated",
      () => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n,
      (tables) => tables > 40,
      (tables) => `${tables} tables`,
    );

    inspect(
      "every migration in the repository was applied",
      () => db.prepare("SELECT count(*) AS n FROM schema_migrations").get().n,
      (applied) => applied === onDisk,
      (applied) => `applied ${applied}, on disk ${onDisk}`,
    );

    /* And the server agrees with the file, so a build serving a stale bundle
       is visible rather than merely unlucky. */
    inspect(
      "the server reports the schema the file actually has",
      () => db.prepare("SELECT count(*) AS n FROM schema_migrations").get().n,
      (applied) => reported.migrations === applied,
      (applied) => `reported ${reported.migrations}, applied ${applied}`,
    );

    /* A fresh installation invents nothing. */
    inspect(
      "a fresh installation has no sample data",
      () => db.prepare("SELECT count(*) AS n FROM person").get().n,
      (people) => people === 0,
      (people) => `${people} people`,
    );

    db.close();
  }

  /* Nothing was logged that should never be logged. */
  const leaked = /password|secret|token|hash/i.test(output) && !/OIKONOMIA/i.test(output);
  check("no secret-shaped output on startup", !leaked);
} finally {
  server?.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nSmoke checks passed.");
