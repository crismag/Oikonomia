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
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 8123);
const BASE = `http://127.0.0.1:${PORT}`;
/* The file a host is told to start — not the bundle behind it — so a broken
   entry fails here rather than on the host. */
const ENTRY = ".output/server.js";
/* The address the installation believes it has. Deliberately not BASE: behind
   a TLS-terminating proxy the browser's origin is https while the server is
   spoken to over http, and server functions must still be accepted. */
const PUBLIC_URL = "https://oikonomia.example";

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
  /* NODE_ENV is left to the entry: a host may not set it. */
  const { NODE_ENV: _ignored, ...inherited } = process.env;
  const start = (env) => {
    /* `undefined` removes a variable, so a check can prove where a value came from. */
    const merged = { ...inherited, PORT: String(PORT), ...env };
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    server = spawn(process.execPath, [ENTRY], {
      env: merged,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const captured = { text: "" };
    server.stdout.on("data", (chunk) => (captured.text += chunk));
    server.stderr.on("data", (chunk) => (captured.text += chunk));
    return captured;
  };

  const captured = start({ OIKONOMIA_DB: database, OIKONOMIA_URL: PUBLIC_URL });

  if (!(await waitForServer())) {
    console.error("The built server never started listening.\n" + captured.text);
    process.exit(1);
  }
  const output = () => captured.text;

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

  /* What the server writes is this account's alone. */
  if (process.platform !== "win32") {
    const { statSync } = await import("node:fs");
    const modes = [database, `${database}-wal`, `${database}-shm`]
      .filter((file) => existsSync(file))
      .map((file) => `${file.slice(dir.length + 1)}=${(statSync(file).mode & 0o777).toString(8)}`);
    check(
      "the database files it created are readable by this account only",
      modes.length > 0 && modes.every((entry) => entry.endsWith("=600")),
      modes.join(" "),
    );
  }

  /* 4. The pieces a browser needs, served by the same process. */
  const shell = await login.text();
  const asset = /\/assets\/[^"']+\.js/.exec(shell)?.[0];
  check("the page references a built script", Boolean(asset));
  if (asset) {
    const script = await fetch(BASE + asset);
    check(
      `GET ${asset} is served as JavaScript`,
      script.status === 200 && /javascript/.test(script.headers.get("content-type") ?? ""),
      `got ${script.status} ${script.headers.get("content-type")}`,
    );
  }

  /* A route opened directly, as a bookmark or a pasted link would. */
  const direct = await fetch(BASE + "/people", { redirect: "manual" });
  check(
    "a client route opened directly is answered by the application",
    [200, 302, 307].includes(direct.status),
    `got ${direct.status}`,
  );

  /* An address that is nothing is a 404, not the application shell with a 200. */
  const nothing = await fetch(BASE + "/no-such-page");
  check("an unknown page is a 404", nothing.status === 404, `got ${nothing.status}`);

  /* Answered by the error page rather than a JSON envelope — the framework
     throws before any handler runs — but never by a page that says 200. */
  const noFunction = await fetch(BASE + "/_serverFn/no-such-function", {
    headers: { "x-tsr-serverfn": "true", "sec-fetch-site": "same-origin" },
  });
  check(
    "an unknown server function is an error, not the application shell",
    noFunction.status >= 400,
    `got ${noFunction.status}`,
  );

  /* 5. Cross-site protection, as a browser behind a TLS-terminating proxy
        meets it: the request reaches the server over http, the page's origin
        is the configured https address. */
  const csrf = (origin) =>
    fetch(BASE + "/_serverFn/no-such-function", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: "{}",
    });
  const sameSite = await csrf(PUBLIC_URL);
  check(
    "a server function called from the configured origin passes the CSRF check",
    sameSite.status !== 403,
    `got ${sameSite.status}`,
  );
  const crossSite = await csrf("https://attacker.example");
  check(
    "a server function called from another origin is refused",
    crossSite.status === 403,
    `got ${crossSite.status}`,
  );

  /* Nothing was logged that should never be logged. */
  const leaked = /password|secret|token|hash/i.test(output()) && !/OIKONOMIA/i.test(output());
  check("no secret-shaped output on startup", !leaked);

  /* 6. A production process that has not been told where its data lives
        refuses, rather than creating a database a redeploy would delete. */
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  check("stops cleanly on SIGTERM", server.signalCode === "SIGTERM" || server.exitCode === 0);

  const unconfigured = start({ OIKONOMIA_URL: PUBLIC_URL, OIKONOMIA_DB: "" });
  if (await waitForServer()) {
    const refused = await fetch(BASE + "/healthz");
    check(
      "without OIKONOMIA_DB the server reports itself unhealthy",
      refused.status === 503,
      `got ${refused.status}`,
    );
    check(
      "and says why",
      /OIKONOMIA_DB is not set/.test(unconfigured.text),
      unconfigured.text.slice(0, 200),
    );
  } else {
    check("starts without OIKONOMIA_DB so it can say what is missing", false, unconfigured.text);
  }

  /* 7. Settings from a private file named by OIKONOMIA_ENV_FILE, the way a
        host's panel supplies one variable and the secrets stay on disk. */
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));

  const SECRET = "smoke-secret-value-never-logged";
  const envFile = join(dir, "private.env");
  writeFileSync(
    envFile,
    [
      `OIKONOMIA_DB=${database}`,
      `OIKONOMIA_URL=https://from-file.example`,
      `OIKONOMIA_MAINTENANCE_TOKEN=${SECRET}`,
    ].join("\n") + "\n",
    { mode: 0o600 },
  );

  /* OIKONOMIA_URL is also set in the environment, which must win. */
  const fromFile = start({
    OIKONOMIA_ENV_FILE: envFile,
    OIKONOMIA_DB: undefined,
    OIKONOMIA_URL: PUBLIC_URL,
    OIKONOMIA_MAINTENANCE_TOKEN: undefined,
  });
  if (await waitForServer()) {
    const healthy = await fetch(BASE + "/healthz");
    check(
      "OIKONOMIA_ENV_FILE supplies the database location",
      healthy.status === 200,
      `got ${healthy.status}`,
    );
    const token = await fetch(BASE + "/maintenance/run?task=nothing", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    check(
      "and the secrets in it",
      token.status === 400,
      `got ${token.status} (401 means the token was not read)`,
    );
    const envWins = await csrf(PUBLIC_URL);
    const fileLoses = await csrf("https://from-file.example");
    check(
      "a variable set in the environment wins over the file",
      envWins.status !== 403 && fileLoses.status === 403,
      `environment origin ${envWins.status}, file origin ${fileLoses.status}`,
    );
    check("the file's values are never logged", !fromFile.text.includes(SECRET));
  } else {
    check("starts with OIKONOMIA_ENV_FILE", false, fromFile.text);
  }
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));

  const missing = start({ OIKONOMIA_ENV_FILE: join(dir, "missing.env") });
  const code = await new Promise((resolve) => server.once("exit", resolve));
  check(
    "a named OIKONOMIA_ENV_FILE that cannot be read stops the server",
    code !== 0 && /could not read OIKONOMIA_ENV_FILE/.test(missing.text),
    `exit ${code}: ${missing.text.slice(0, 200)}`,
  );
} finally {
  server?.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nSmoke checks passed.");
