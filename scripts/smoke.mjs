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

import { spawn, spawnSync } from "node:child_process";
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
  /* Inline script runs by this response's nonce only — so every script the
     page streams must carry it, or the page never starts in a browser. */
  {
    const policy = login.headers.get("content-security-policy") ?? "";
    const scriptSrc = policy.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc)?.[1];
    check(
      "script-src has a nonce and no 'unsafe-inline'",
      Boolean(nonce) && !scriptSrc.includes("'unsafe-inline'"),
      scriptSrc,
    );
    const scripts = (await login.clone().text()).match(/<script\b[^>]*>/g) ?? [];
    const missing = scripts.filter((tag) => !tag.includes(`nonce="${nonce}"`));
    check(
      "every script on the page carries that nonce",
      scripts.length > 0 && missing.length === 0,
      missing.join(" "),
    );
  }
  /* A church's own installation stays findable: the demonstration's header is not here. */
  check(
    "an ordinary installation does not ask not to be indexed",
    login.headers.get("x-robots-tag") === null,
    `got ${login.headers.get("x-robots-tag")}`,
  );

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

  /*
   * The session call answers before anybody signs in — it is how the shell
   * finds out whether anybody has. It must not answer with the directory.
   *
   * Asked of the built server, because this is where the leak lived: a
   * handler that returned every person, with email and access role, to any
   * browser. The function's id is build-specific, so it is read from the
   * build's own resolver.
   */
  {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { default: Database } = await import("better-sqlite3");
    const EMAIL = "directory-probe@smoke.example";

    const writer = new Database(database);
    writer
      .prepare(
        `INSERT INTO person (id, name, initials, role, access_role, email, created_at, active)
         VALUES ('per-smoke-probe', 'Directory Probe', 'DP', '', 'admin', ?, ?, 1)`,
      )
      .run(EMAIL, new Date().toISOString());
    writer.close();

    const resolver = readdirSync(".output/server").find((file) =>
      file.includes("server-fn-resolver"),
    );
    const source = resolver ? readFileSync(join(".output/server", resolver), "utf8") : "";
    const id =
      /"([a-f0-9]{64})":\s*\{\s*functionName:\s*"fetchSession_createServerFn_handler",\s*importer:\s*\(\)\s*=>\s*import\("\.\/_ssr\/organization-api-/.exec(
        source,
      )?.[1];
    check("the build names the organisation session call", Boolean(id));

    if (id) {
      const anonymous = await fetch(`${BASE}/_serverFn/${id}`, {
        headers: { "x-tsr-serverfn": "true", "sec-fetch-site": "same-origin" },
      });
      const body = await anonymous.text();
      check(
        "the session call answers a visitor who is not signed in",
        anonymous.status === 200 && body.includes("setupRequired"),
        `got ${anonymous.status}`,
      );
      check(
        "and shows that visitor nobody from the directory",
        !body.includes(EMAIL) && !body.includes("Directory Probe"),
      );
    }
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

  /*
   * 8. The installation policy, as the built server enforces it.
   *
   *    Signed in as an administrator — a real session in the database, sent as
   *    the real cookie — the same calls are made with OIKONOMIA_DEMO_MODE off
   *    and on. Off, the administrator may change configuration and run a
   *    backup. On, neither happens and nothing is written, while church work
   *    still goes through and reads still answer. The cookie is the same both
   *    times: only the environment differs.
   */
  {
    const { createHash, randomBytes } = await import("node:crypto");
    const { readdirSync, readFileSync } = await import("node:fs");
    const { toJSON } = await import("seroval");
    const { default: Database } = await import("better-sqlite3");

    const MAINTENANCE_TOKEN = randomBytes(24).toString("base64url");
    const sessionToken = randomBytes(32).toString("base64url");
    const now = new Date();
    const writer = new Database(database);
    writer
      .prepare(
        `INSERT INTO account (id, person_id, email, email_verified, status, created_at)
         VALUES ('acc-smoke-admin', 'per-smoke-probe', NULL, 0, 'active', ?)`,
      )
      .run(now.toISOString());
    writer
      .prepare(
        `INSERT INTO auth_session (id, account_id, created_at, last_seen_at, expires_at)
         VALUES (?, 'acc-smoke-admin', ?, ?, ?)`,
      )
      .run(
        createHash("sha256").update(sessionToken).digest("hex"),
        now.toISOString(),
        now.toISOString(),
        new Date(now.getTime() + 3_600_000).toISOString(),
      );
    /* One identity the database designates for a demonstration. With the flag
       off it must open nothing; with it on it is the way in. */
    writer
      .prepare(
        `INSERT INTO person (id, name, initials, role, access_role, created_at, active)
         VALUES ('per-smoke-demo', 'Demo Designate', 'DD', 'Deacon', 'leader', ?, 1)`,
      )
      .run(now.toISOString());
    writer
      .prepare(
        `INSERT INTO account (id, person_id, email, email_verified, status, created_at)
         VALUES ('acc-smoke-demo', 'per-smoke-demo', NULL, 0, 'active', ?)`,
      )
      .run(now.toISOString());
    writer
      .prepare(
        `INSERT INTO demo_identity (id, person_id, kind, display_order, created_at)
         VALUES ('demo-smoke-designate', 'per-smoke-demo', 'designated', 1, ?)`,
      )
      .run(now.toISOString());
    writer.close();

    const resolver = readdirSync(".output/server").find((f) => f.includes("server-fn-resolver"));
    const resolverSource = resolver ? readFileSync(join(".output/server", resolver), "utf8") : "";
    const idOf = (name, api) =>
      new RegExp(
        `"([a-f0-9]{64})":\\s*\\{\\s*functionName:\\s*"${name}_createServerFn_handler",\\s*importer:\\s*\\(\\)\\s*=>\\s*import\\("\\./_ssr/${api}-`,
      ).exec(resolverSource)?.[1];

    const call = async (name, api, data, cookie = `oikonomia_session=${sessionToken}`) => {
      const id = idOf(name, api);
      if (!id) return { status: 0, body: `no ${name} in the build` };
      const response = await fetch(`${BASE}/_serverFn/${id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tsr-serverfn": "true",
          "sec-fetch-site": "same-origin",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(toJSON({ data })),
      });
      const issued = /oikonomia_session=([^;]+)/.exec(
        response.headers.get("set-cookie") ?? "",
      )?.[1];
      return { status: response.status, body: await response.text(), issued };
    };
    /* Who the organisation session call says a cookie belongs to. */
    const sessionBody = async (token) => {
      const response = await fetch(
        `${BASE}/_serverFn/${idOf("fetchSession", "organization-api")}`,
        {
          headers: {
            "x-tsr-serverfn": "true",
            "sec-fetch-site": "same-origin",
            cookie: `oikonomia_session=${token}`,
          },
        },
      );
      return response.text();
    };
    /*
     * What the browser is told about the installation, with no session at all.
     * Read out of the serialised reply by shape — the object whose keys are
     * exactly `demo` and `restricted` — because the whole reply carries nodes
     * seroval will not decode outside the application's own plugins.
     */
    const installationSeen = async () => {
      const response = await fetch(`${BASE}/_serverFn/${idOf("fetchSession", "auth-api")}`, {
        headers: { "x-tsr-serverfn": "true", "sec-fetch-site": "same-origin" },
      });
      const find = (node) => {
        if (!node || typeof node !== "object") return undefined;
        const keys = node.p?.k;
        if (Array.isArray(keys) && keys.join() === "demo,restricted") {
          const [demo, restricted] = node.p.v;
          return {
            demo: demo.t === 2 ? demo.s === 2 : undefined,
            restricted: (restricted.a ?? []).map((item) => item.s),
          };
        }
        for (const child of Object.values(node)) {
          const found = find(child);
          if (found) return found;
        }
        return undefined;
      };
      return find(JSON.parse(await response.text()));
    };
    const siteName = (path = database) => {
      const reader = new Database(path, { readonly: true });
      const row = reader
        .prepare(
          "SELECT value FROM configuration_setting WHERE namespace = 'site.profile' AND field = 'name'",
        )
        .get();
      reader.close();
      return row ? JSON.parse(row.value) : undefined;
    };
    const goalsTitled = (title, path = database) => {
      const reader = new Database(path, { readonly: true });
      const { n } = reader.prepare("SELECT count(*) AS n FROM goal WHERE title = ?").get(title);
      reader.close();
      return n;
    };
    const maintenance = (task = "backup", token = MAINTENANCE_TOKEN) =>
      fetch(`${BASE}/maintenance/run?task=${task}`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    /* Every row of every table: proof a database was not touched at all. */
    const fingerprint = (path) => {
      const reader = new Database(path, { readonly: true });
      const tables = reader
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all();
      const content = tables.map(({ name }) => [
        name,
        reader.prepare(`SELECT * FROM "${name}"`).all(),
      ]);
      reader.close();
      return createHash("sha256").update(JSON.stringify(content)).digest("hex");
    };
    /* A value from a serialised server-function reply, found by its object's keys. */
    const fieldOf = (text, keys, field) => {
      const find = (node) => {
        if (!node || typeof node !== "object") return undefined;
        const names = node.p?.k;
        if (Array.isArray(names) && keys.every((key) => names.includes(key))) {
          return node.p.v[names.indexOf(field)];
        }
        for (const child of Object.values(node)) {
          const found = find(child);
          if (found) return found;
        }
        return undefined;
      };
      return find(JSON.parse(text));
    };
    const demoEntryGeneration = async () => {
      const response = await fetch(`${BASE}/_serverFn/${idOf("fetchDemoEntry", "demo-api")}`, {
        headers: { "x-tsr-serverfn": "true", "sec-fetch-site": "same-origin" },
      });
      const node = fieldOf(await response.text(), ["identities", "generation"], "generation");
      return node?.t === 0 ? node.s : node;
    };
    /* The demonstration's status as one browser sees it: signed in, and presence. */
    const demoStatus = async (token) => {
      const response = await fetch(`${BASE}/_serverFn/${idOf("fetchDemoEntry", "demo-api")}`, {
        headers: {
          "x-tsr-serverfn": "true",
          "sec-fetch-site": "same-origin",
          ...(token ? { cookie: `oikonomia_session=${token}` } : {}),
        },
      });
      const text = await response.text();
      const signedIn = fieldOf(text, ["signedIn", "identities"], "signedIn");
      const active = fieldOf(text, ["id", "current", "active"], "active");
      return {
        text,
        signedIn: signedIn?.t === 2 ? signedIn.s === 2 : undefined,
        active: active?.t === 0 ? active.s : undefined,
      };
    };
    const googleStart = () => fetch(`${BASE}/auth/google/start`, { redirect: "manual" });
    const stop = async () => {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    };

    /* A demonstration has its own database and baseline, beside the ordinary one. */
    const demoBaseline = join(dir, "smoke-demo-baseline.db");
    const demoDatabase = join(dir, "smoke-demo.db");

    const installation = (demo) => ({
      OIKONOMIA_DB: database,
      OIKONOMIA_DEMO_DB: demoDatabase,
      OIKONOMIA_DEMO_BASELINE: demoBaseline,
      OIKONOMIA_URL: PUBLIC_URL,
      OIKONOMIA_MAINTENANCE_TOKEN: MAINTENANCE_TOKEN,
      OIKONOMIA_DEMO_MODE: demo,
    });

    /* Off: an administrator's ordinary powers. */
    start(installation("false"));
    if (await waitForServer()) {
      const set = await call("setConfigurationValue", "configuration-api", {
        namespace: "site.profile",
        field: "name",
        value: "Changed with Demo Mode off",
      });
      const offEntry = await call(
        "enterDemoAs",
        "demo-api",
        { identityId: "demo-smoke-designate" },
        "",
      );
      const offView = await installationSeen();
      check(
        "Demo Mode off: the browser is told this is an ordinary installation",
        offView?.demo === false && offView.restricted.length === 0,
        JSON.stringify(offView),
      );
      check(
        "Demo Mode off: a designated demo identity cannot be entered",
        offEntry.body.includes("disabled-by-installation") && !offEntry.issued,
        `status ${offEntry.status}`,
      );
      check(
        "Demo Mode off: an administrator can change configuration",
        siteName() === "Changed with Demo Mode off",
        `status ${set.status}, stored ${JSON.stringify(siteName())}`,
      );
      const backup = await maintenance();
      check(
        "Demo Mode off: maintenance runs with its token",
        backup.status === 200,
        `got ${backup.status}`,
      );
      const google = await googleStart();
      check(
        "Demo Mode off: Google sign-in is not refused by policy",
        google.status !== 403,
        `got ${google.status}`,
      );
      const untouched = fingerprint(database);
      const offReset = await maintenance("demo-reset");
      const offResetBody = await offReset.json().catch(() => ({}));
      check(
        "Demo Mode off: a demo reset is refused, with the token, and the database is untouched",
        offReset.status === 409 &&
          offResetBody.reason === "demo-mode-off" &&
          fingerprint(database) === untouched,
        `got ${offReset.status} ${JSON.stringify(offResetBody)}`,
      );
      await stop();
    } else {
      check("starts with Demo Mode off", false);
    }

    /*
     * The demonstration's databases: a curated baseline (here, a copy of the
     * ordinary database with its sessions removed, marked demo-baseline) and
     * the live demonstration database the provisioning script creates from it.
     */
    {
      const source = new Database(database, { readonly: true });
      source.prepare("VACUUM INTO ?").run(demoBaseline);
      source.close();
      const curate = new Database(demoBaseline);
      curate.exec(
        "DELETE FROM auth_session; DELETE FROM auth_token; DELETE FROM auth_throttle; DELETE FROM demo_identity WHERE kind = 'visitor';",
      );
      curate.prepare("INSERT INTO demo_state (id, marker) VALUES (1, 'demo-baseline')").run();
      curate.pragma("journal_mode = DELETE");
      curate.close();
    }
    const provision = () =>
      spawnSync(
        process.execPath,
        [
          "scripts/ops/demo-provision.mjs",
          "--baseline",
          demoBaseline,
          "--to",
          demoDatabase,
          "--ordinary",
          database,
        ],
        { encoding: "utf8" },
      );
    const provisioned = provision();
    check(
      "demo-provision creates the demonstration database from its baseline",
      provisioned.status === 0 && existsSync(demoDatabase),
      provisioned.stderr,
    );
    const reprovisioned = provision();
    check(
      "demo-provision never replaces an existing database",
      reprovisioned.status !== 0 && /already exists/.test(reprovisioned.stderr),
      reprovisioned.stderr,
    );
    {
      /* The administrator's cookie works in the demonstration too. */
      const writer = new Database(demoDatabase);
      writer
        .prepare(
          `INSERT INTO auth_session (id, account_id, created_at, last_seen_at, expires_at)
           VALUES (?, 'acc-smoke-admin', ?, ?, ?)`,
        )
        .run(
          createHash("sha256").update(sessionToken).digest("hex"),
          now.toISOString(),
          now.toISOString(),
          new Date(now.getTime() + 3_600_000).toISOString(),
        );
      writer.close();
    }
    const ordinaryFingerprint = fingerprint(database);

    /* Demo Mode never opens the ordinary database, not even as a fallback. */
    for (const [label, env, pattern] of [
      [
        "without OIKONOMIA_DEMO_DB",
        { OIKONOMIA_DEMO_DB: undefined },
        /OIKONOMIA_DEMO_DB is not set/,
      ],
      [
        "with OIKONOMIA_DEMO_DB naming the ordinary database",
        { OIKONOMIA_DEMO_DB: database },
        /same file as OIKONOMIA_DB/,
      ],
    ]) {
      const refused = start({ ...installation("true"), ...env });
      if (await waitForServer()) {
        const health = await fetch(`${BASE}/healthz`);
        check(
          `Demo Mode on ${label}: the server serves nothing, and says why`,
          health.status === 503 && pattern.test(refused.text),
          `got ${health.status}: ${refused.text.slice(0, 200)}`,
        );
        await stop();
      } else {
        check(`starts, to report Demo Mode on ${label}`, false, refused.text);
      }
    }
    check(
      "Demo Mode on, misconfigured: the ordinary database was never touched",
      fingerprint(database) === ordinaryFingerprint,
    );

    /* On: the same administrator, the same cookie, the demonstration's database. */
    start(installation("true"));
    if (await waitForServer()) {
      const set = await call("setConfigurationValue", "configuration-api", {
        namespace: "site.profile",
        field: "name",
        value: "Changed with Demo Mode on",
      });
      check(
        "Demo Mode on: an administrator's configuration change is refused",
        set.body.includes("disabled-by-installation") &&
          siteName(demoDatabase) === "Changed with Demo Mode off",
        `status ${set.status}, stored ${JSON.stringify(siteName(demoDatabase))}`,
      );

      const reset = await call("resetPassword", "auth-api", {
        token: "anything",
        password: "a long enough passphrase",
      });
      check(
        "Demo Mode on: password reset is refused",
        reset.body.includes("disabled-by-installation"),
      );

      const exported = await call("runExport", "data-management-api", {
        scope: { type: "site" },
        format: "json",
      });
      check(
        "Demo Mode on: a site export is refused",
        exported.body.includes("disabled-by-installation"),
      );

      const goal = await call("createGoal", "goals-api", {
        title: "Written with Demo Mode on",
        year: now.getFullYear(),
        scope: "personal",
      });
      check(
        "Demo Mode on: church work still goes through",
        !goal.body.includes("disabled-by-installation") &&
          goalsTitled("Written with Demo Mode on", demoDatabase) === 1,
        `status ${goal.status}`,
      );

      /* What the header and the disabled controls are drawn from. */
      const onView = await installationSeen();
      check(
        "Demo Mode on: the browser is told it is a demonstration, and what is switched off",
        onView?.demo === true &&
          ["authentication", "configuration", "data", "identity", "sessions"].every((group) =>
            onView.restricted.includes(group),
          ),
        JSON.stringify(onView),
      );
      /* The demonstration's entrance, from a browser with no session. */
      const entered = await call(
        "enterDemoAs",
        "demo-api",
        { identityId: "demo-smoke-designate" },
        "",
      );
      check(
        "Demo Mode on: a designated identity opens an ordinary session",
        Boolean(entered.issued) && (await sessionBody(entered.issued)).includes("Demo Designate"),
        `status ${entered.status}`,
      );

      /* Presence: that session counts for its identity, and nothing about it is sent. */
      const asEntered = await demoStatus(entered.issued);
      const anonymous = await demoStatus();
      check(
        "Demo Mode on: the status counts the active session for its identity, and says who is signed in",
        asEntered.active === 1 && asEntered.signedIn === true && anonymous.signedIn === false,
        JSON.stringify({
          asEntered: { ...asEntered, text: undefined },
          anonymous: anonymous.signedIn,
        }),
      );
      check(
        "Demo Mode on: the status carries no session id, token, user agent or email",
        !/user_?agent|userAgent|expires|last_?seen|oikonomia_session|@/i.test(asEntered.text) &&
          !asEntered.text.includes(entered.issued) &&
          !asEntered.text.includes(createHash("sha256").update(entered.issued).digest("hex")),
      );

      const notDesignated = await call(
        "enterDemoAs",
        "demo-api",
        { identityId: "per-smoke-probe" },
        "",
      );
      check(
        "Demo Mode on: a person who is not designated cannot be entered",
        !notDesignated.issued && notDesignated.body.includes("not-found"),
        `status ${notDesignated.status}`,
      );

      const visitor = await call("createDemoVisitor", "demo-api", { name: "Smoke Visitor" }, "");
      const visitorRow = (() => {
        const reader = new Database(demoDatabase, { readonly: true });
        const row = reader
          .prepare(
            `SELECT person.id, person.email, account.status,
                    (SELECT COUNT(*) FROM account_credential WHERE account_id = account.id) AS credentials,
                    (SELECT COUNT(*) FROM onboarding_state WHERE person_id = person.id) AS onboarded
               FROM demo_identity
               JOIN person ON person.id = demo_identity.person_id
               JOIN account ON account.person_id = person.id
              WHERE demo_identity.kind = 'visitor' AND person.name = 'Smoke Visitor'`,
          )
          .get();
        reader.close();
        return row;
      })();
      check(
        "Demo Mode on: a visitor gets a session and a credential-less account, and has onboarding ahead",
        Boolean(visitor.issued) &&
          (await sessionBody(visitor.issued)).includes("Smoke Visitor") &&
          visitorRow?.status === "active" &&
          visitorRow?.email === null &&
          visitorRow?.credentials === 0 &&
          visitorRow?.onboarded === 0,
        `status ${visitor.status}, ${JSON.stringify(visitorRow)}`,
      );

      const switched = await call(
        "enterDemoAs",
        "demo-api",
        { identityId: "demo-smoke-designate" },
        `oikonomia_session=${visitor.issued}`,
      );
      check(
        "Demo Mode on: switching identity ends the browser's previous session",
        Boolean(switched.issued) && !(await sessionBody(visitor.issued)).includes("Smoke Visitor"),
        `status ${switched.status}`,
      );

      const sessionId = idOf("fetchSession", "organization-api");
      const read = await fetch(`${BASE}/_serverFn/${sessionId}`, {
        headers: {
          "x-tsr-serverfn": "true",
          "sec-fetch-site": "same-origin",
          cookie: `oikonomia_session=${sessionToken}`,
        },
      });
      check(
        "Demo Mode on: reads still answer",
        read.status === 200 && (await read.text()).includes("Directory Probe"),
        `got ${read.status}`,
      );

      const backup = await maintenance();
      check(
        "Demo Mode on: maintenance is refused even with its token",
        backup.status === 403 && (await backup.text()).includes("disabled-by-installation"),
        `got ${backup.status}`,
      );
      const google = await googleStart();
      check(
        "Demo Mode on: Google sign-in cannot start",
        google.status === 403,
        `got ${google.status}`,
      );

      const health = await fetch(`${BASE}/healthz`);
      check(
        "Demo Mode on: the health check still answers",
        health.status === 200,
        `got ${health.status}`,
      );

      /* Search engines are asked to skip the demonstration: every page, the
         error pages and the refusals, not only the front door. */
      const robots = {};
      for (const [label, path] of [
        ["/", "/"],
        ["/login", "/login"],
        ["/setup", "/setup"],
        ["a page", "/people"],
        ["a 404", "/no-such-page"],
        ["/healthz", "/healthz"],
        ["a refusal", "/auth/google/start"],
      ]) {
        const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
        robots[label] = response.headers.get("x-robots-tag");
      }
      const unmarked = Object.entries(robots).filter(([, value]) => value !== "noindex, nofollow");
      check(
        "Demo Mode on: pages, errors and refusals carry X-Robots-Tag: noindex, nofollow",
        unmarked.length === 0,
        unmarked.map(([label, value]) => `${label}: ${value}`).join(", "),
      );

      /* The reset: only with the token, in place, and only the demonstration. */
      const liveInode = (await import("node:fs")).statSync(demoDatabase).ino;
      const anonymousReset = await maintenance("demo-reset", "");
      check(
        "Demo Mode on: a demo reset without the maintenance token is refused",
        anonymousReset.status === 401,
        `got ${anonymousReset.status}`,
      );
      const viaSession = await fetch(`${BASE}/maintenance/run?task=demo-reset`, {
        method: "POST",
        headers: { cookie: `oikonomia_session=${sessionToken}` },
      });
      check(
        "Demo Mode on: an administrator's session is not a maintenance token",
        viaSession.status === 401,
        `got ${viaSession.status}`,
      );
      check(
        "Demo Mode on: before a reset, the generation is 0",
        (await demoEntryGeneration()) === 0,
        JSON.stringify(await demoEntryGeneration()),
      );

      const demoReset = await maintenance("demo-reset");
      const demoResetBody = await demoReset.json().catch(() => ({}));
      check(
        "Demo Mode on: the demo reset runs with the token",
        demoReset.status === 200 && demoResetBody.ok === true && demoResetBody.generation === 1,
        `got ${demoReset.status} ${JSON.stringify(demoResetBody)}`,
      );
      check(
        "Demo Mode on: the reset restored the demonstration in the same file",
        goalsTitled("Written with Demo Mode on", demoDatabase) === 0 &&
          (await import("node:fs")).statSync(demoDatabase).ino === liveInode,
      );
      check(
        "Demo Mode on: after a reset, visitors and their sessions are gone",
        !(await sessionBody(visitor.issued)).includes("Smoke Visitor") &&
          !(await sessionBody(switched.issued)).includes("Demo Designate") &&
          (() => {
            const reader = new Database(demoDatabase, { readonly: true });
            const { n } = reader
              .prepare("SELECT COUNT(*) AS n FROM demo_identity WHERE kind = 'visitor'")
              .get();
            reader.close();
            return n === 0;
          })(),
      );
      check(
        "Demo Mode on: after a reset, the browser is told the new generation",
        (await demoEntryGeneration()) === 1,
        JSON.stringify(await demoEntryGeneration()),
      );
      const reentered = await call(
        "enterDemoAs",
        "demo-api",
        { identityId: "demo-smoke-designate" },
        "",
      );
      check(
        "Demo Mode on: after a reset, a designated identity can be entered again",
        Boolean(reentered.issued) &&
          (await sessionBody(reentered.issued)).includes("Demo Designate"),
        `status ${reentered.status}`,
      );
      const notDue = await maintenance("demo-reset&when=due");
      const notDueBody = await notDue.json().catch(() => ({}));
      check(
        "Demo Mode on: a scheduled reset right after one is skipped as not due",
        notDue.status === 200 && notDueBody.skipped === "not-due" && notDueBody.generation === 1,
        `got ${notDue.status} ${JSON.stringify(notDueBody)}`,
      );
      check(
        "Demo Mode on: the ordinary database was never touched",
        fingerprint(database) === ordinaryFingerprint,
      );
      await stop();
    } else {
      check("starts with Demo Mode on", false);
    }

    /* Neither: a value that is not "true" or "false" serves nothing. */
    const misconfigured = start(installation("yes"));
    if (await waitForServer()) {
      const health = await fetch(`${BASE}/healthz`);
      check(
        "OIKONOMIA_DEMO_MODE=yes: the server refuses to serve, and says why",
        health.status === 503 && /OIKONOMIA_DEMO_MODE/.test(misconfigured.text),
        `got ${health.status}`,
      );
      await stop();
    } else {
      check("starts, to report OIKONOMIA_DEMO_MODE=yes", false, misconfigured.text);
    }

    /*
     * A deployment pinned to always be a demonstration
     * (OIKONOMIA_REQUIRE_DEMO_MODE=true — oikosdemo.crishub.com's own
     * configuration) cannot boot as an ordinary installation, whatever the
     * rest of its environment says — including a perfectly ordinary one.
     */
    const pinned = (env) =>
      start({ ...installation("true"), OIKONOMIA_REQUIRE_DEMO_MODE: "true", ...env });

    const pinnedButOrdinary = pinned({ OIKONOMIA_DEMO_MODE: "false" });
    if (await waitForServer()) {
      const health = await fetch(`${BASE}/healthz`);
      check(
        "OIKONOMIA_REQUIRE_DEMO_MODE=true, Demo Mode off: the deployment cannot boot as an ordinary installation",
        health.status === 503 && /OIKONOMIA_REQUIRE_DEMO_MODE=true/.test(pinnedButOrdinary.text),
        `got ${health.status}`,
      );
      await stop();
    } else {
      check("starts, to report the pinned-but-ordinary refusal", false, pinnedButOrdinary.text);
    }

    const pinnedNoBaseline = pinned({ OIKONOMIA_DEMO_BASELINE: undefined });
    if (await waitForServer()) {
      const health = await fetch(`${BASE}/healthz`);
      check(
        "OIKONOMIA_REQUIRE_DEMO_MODE=true, no baseline configured: refuses rather than serving",
        health.status === 503 && /OIKONOMIA_DEMO_BASELINE/.test(pinnedNoBaseline.text),
        `got ${health.status}`,
      );
      await stop();
    } else {
      check("starts, to report the pinned-no-baseline refusal", false, pinnedNoBaseline.text);
    }

    const pinnedNoDemoDb = pinned({ OIKONOMIA_DEMO_DB: undefined });
    if (await waitForServer()) {
      const health = await fetch(`${BASE}/healthz`);
      check(
        "OIKONOMIA_REQUIRE_DEMO_MODE=true, no dedicated Demo database: refuses, no fallback to OIKONOMIA_DB",
        health.status === 503 && /OIKONOMIA_DEMO_DB/.test(pinnedNoDemoDb.text),
        `got ${health.status}`,
      );
      await stop();
    } else {
      check("starts, to report the pinned-no-demo-db refusal", false, pinnedNoDemoDb.text);
    }

    const pinnedCorrect = pinned({});
    if (await waitForServer()) {
      const health = await fetch(`${BASE}/healthz`);
      check(
        "OIKONOMIA_REQUIRE_DEMO_MODE=true, fully configured: boots and serves as a demonstration",
        health.status === 200,
        `got ${health.status}`,
      );
      await stop();
    } else {
      check(
        "starts when the pinned deployment is fully and correctly configured",
        false,
        pinnedCorrect.text,
      );
    }
  }
} finally {
  server?.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nSmoke checks passed.");
