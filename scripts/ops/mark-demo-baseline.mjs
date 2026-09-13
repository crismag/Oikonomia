/**
 * Validate a populated builder database, and — asked to — turn it into the
 * canonical Demo baseline.
 *
 *   node scripts/ops/mark-demo-baseline.mjs --candidate <populated.db>
 *        [--designate <personId>[,<personId>...]]
 *        [--sanitize]
 *        [--to <oikonomia-demo-baseline.db> | --in-place]
 *        [--sqlite <path to better-sqlite3>]
 *
 * With only `--candidate`, this **validates and writes nothing** — the
 * command to run before handing a candidate back for Slice 8's deployment, or
 * at any point while curating one. It checks everything
 * `src/server/installation/demo-reset.ts` and `demo-provision.mjs` require of
 * a baseline before either will touch it, so a candidate that passes here
 * will not be refused there:
 *
 *   - opens as SQLite; passes `integrity_check` and `foreign_key_check`;
 *   - its schema — tables, columns, the applied migrations — matches this
 *     build's, built fresh with `create-demo-baseline-builder.mjs` for the
 *     comparison rather than assumed;
 *   - `demo_identity` designates at least one person;
 *   - no session, sign-in token, throttle row, or temporary visitor;
 *   - no `account_credential` row at all — a demonstration is entered only
 *     through the demo entrance (migration 035's `demo_identity`), never with
 *     a password or a Google identity, so a credential in the baseline is
 *     either a leftover from setting it up or, worse, a real one;
 *   - `demo_state` is not already marked `demo-installation` — that would be
 *     a live database, not a baseline, and marking it `demo-baseline` too
 *     would let a reset attach a live database to itself.
 *
 * ## Finalizing
 *
 * `--designate` and `--sanitize` prepare a candidate that already holds
 * curated content but has not yet had its Demo-specific rows set:
 *
 *   - `--designate` inserts `demo_identity` rows (`kind = 'designated'`) for
 *     the given person ids, in the order given, for whichever of them are not
 *     already designated. Nothing else about who may be explored as is
 *     decided here — that is curatorial content, and this script only records
 *     the decision once it is made.
 *   - `--sanitize` removes every session, sign-in token, throttle row,
 *     temporary visitor, and credential — the runtime and sign-in state a
 *     database accumulates while somebody was actually using it (`/setup`,
 *     the admin screens) to build the content, which a baseline must not
 *     carry.
 *
 * With `--to` or `--in-place`, once validation passes: `--to` takes a
 * consistent copy (`VACUUM INTO`, refusing an existing target) and marks the
 * copy; `--in-place` marks the candidate itself. Marking sets
 * `demo_state.marker = 'demo-baseline'` and `journal_mode = DELETE`, so
 * reading the baseline later — every reset does — does not leave a `-shm`
 * beside it. The candidate is never written to unless `--in-place` names it.
 */

import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.umask(0o077);

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const flag = (name) => args.includes(`--${name}`);

const fail = (message) => {
  console.error(`mark-demo-baseline: ${message}`);
  process.exit(1);
};

const candidatePath = option("candidate") && resolve(option("candidate"));
if (!candidatePath)
  fail(
    "usage: --candidate <populated.db> [--designate id,id,…] [--sanitize] [--to <out.db> | --in-place]",
  );
if (!existsSync(candidatePath)) fail(`no database at ${candidatePath}.`);

const to = option("to") && resolve(option("to"));
const inPlace = flag("in-place");
if (to && inPlace) fail("--to and --in-place do the same job differently; pass one.");
if (to && existsSync(to))
  fail(`${to} already exists. Choose a new name — a baseline is not overwritten.`);

const require = createRequire(join(process.cwd(), "noop.js"));
const Database = require(option("sqlite") ? resolve(option("sqlite")) : "better-sqlite3");

const here = dirname(fileURLToPath(import.meta.url));

/* A fresh, current-schema database, built the same way a builder is — so
   "matches the current schema" is answered by comparison, not restated here. */
const scratch = mkdtempSync(join(tmpdir(), "oikonomia-mark-baseline-"));
const referencePath = join(scratch, "reference.db");
const built = spawnSync(
  process.execPath,
  [join(here, "create-demo-baseline-builder.mjs"), "--to", referencePath, "--quiet"],
  {
    encoding: "utf8",
  },
);
if (built.status !== 0) {
  rmSync(scratch, { recursive: true, force: true });
  fail(`could not build a reference schema to compare against: ${built.stderr || built.stdout}`);
}

const tableSql = (db) =>
  new Map(
    db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
      )
      .all()
      .map((row) => [row.name, row.sql]),
  );
const migrationVersions = (db) =>
  db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((r) => r.version);
const count = (db, sql) => db.prepare(sql).get().n;

/* --designate / --sanitize prepare the file that is then validated, so a
   candidate curated in one pass does not need a second run to pass. In-place
   when marking in place; otherwise on a disposable copy, so a candidate that
   fails these steps or the checks after them is left exactly as it was. */
const workingPath = to ? join(scratch, "working.db") : candidatePath;
if (to) {
  const source = new Database(candidatePath, { readonly: true, fileMustExist: true });
  source.prepare("VACUUM INTO ?").run(workingPath);
  source.close();
}

const designate = option("designate");
if ((designate || flag("sanitize")) && !to && !inPlace) {
  fail("--designate and --sanitize change the database; pass --to <out.db> or --in-place.");
}
if (designate || flag("sanitize")) {
  const db = new Database(workingPath);
  try {
    if (flag("sanitize")) {
      db.exec(
        "DELETE FROM auth_session; DELETE FROM auth_token; DELETE FROM auth_throttle; " +
          "DELETE FROM account_credential; DELETE FROM demo_identity WHERE kind = 'visitor';",
      );
    }
    if (designate) {
      const personIds = designate
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const existing = new Set(
        db
          .prepare("SELECT person_id FROM demo_identity WHERE kind = 'designated'")
          .all()
          .map((r) => r.person_id),
      );
      const order = db
        .prepare(
          "SELECT COALESCE(MAX(display_order), -1) AS n FROM demo_identity WHERE kind = 'designated'",
        )
        .get().n;
      const insert = db.prepare(
        "INSERT INTO demo_identity (id, person_id, kind, display_order, created_at) VALUES (?, ?, 'designated', ?, ?)",
      );
      let next = order + 1;
      const now = new Date().toISOString();
      for (const personId of personIds) {
        if (existing.has(personId)) continue;
        const person = db.prepare("SELECT id FROM person WHERE id = ?").get(personId);
        if (!person) {
          db.close();
          if (to) rmSync(scratch, { recursive: true, force: true });
          fail(`--designate names a person that does not exist in the candidate: ${personId}.`);
        }
        insert.run(`demo-${personId}`, personId, next, now);
        next += 1;
      }
    }
  } finally {
    db.close();
  }
}

/* Validation, on the file that will actually become the baseline. */
const db = new Database(workingPath, { readonly: true, fileMustExist: true });
const problems = [];

const integrity = db.pragma("integrity_check", { simple: true });
if (integrity !== "ok") problems.push(`integrity check failed: ${integrity}`);
const foreignKeys = db.pragma("foreign_key_check");
if (foreignKeys.length > 0) problems.push(`${foreignKeys.length} broken foreign-key reference(s)`);

const reference = new Database(referencePath, { readonly: true, fileMustExist: true });
const [candidateVersions, referenceVersions] = [
  migrationVersions(db),
  migrationVersions(reference),
];
if (JSON.stringify(candidateVersions) !== JSON.stringify(referenceVersions)) {
  problems.push(
    `schema is not at the current migrations (candidate ${candidateVersions.at(-1) ?? 0}, current ${referenceVersions.at(-1) ?? 0})`,
  );
}
const [candidateTables, referenceTables] = [tableSql(db), tableSql(reference)];
const tableNames = new Set([...candidateTables.keys(), ...referenceTables.keys()]);
const differingTables = [...tableNames].filter(
  (name) => candidateTables.get(name) !== referenceTables.get(name),
);
if (differingTables.length > 0)
  problems.push(`table definitions differ from the current schema: ${differingTables.join(", ")}`);
const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
if (triggers.length > 0) problems.push(`has trigger(s): ${triggers.map((t) => t.name).join(", ")}`);
reference.close();

let demoState;
if (candidateTables.has("demo_state")) {
  demoState = db.prepare("SELECT marker FROM demo_state WHERE id = 1").get();
}
if (demoState?.marker === "demo-installation") {
  problems.push("marked demo-installation — this is a live database, not a baseline candidate");
}

const designated = candidateTables.has("demo_identity")
  ? count(db, "SELECT COUNT(*) AS n FROM demo_identity WHERE kind = 'designated'")
  : 0;
if (designated === 0) problems.push("designates nobody (demo_identity has no 'designated' row)");
const visitors = candidateTables.has("demo_identity")
  ? count(db, "SELECT COUNT(*) AS n FROM demo_identity WHERE kind = 'visitor'")
  : 0;
if (visitors > 0) problems.push(`${visitors} temporary visitor(s) — sanitize before marking`);
const sessions = count(db, "SELECT COUNT(*) AS n FROM auth_session");
if (sessions > 0) problems.push(`${sessions} session(s) — sanitize before marking`);
const tokens = count(db, "SELECT COUNT(*) AS n FROM auth_token");
if (tokens > 0) problems.push(`${tokens} sign-in token(s) — sanitize before marking`);
const throttles = count(db, "SELECT COUNT(*) AS n FROM auth_throttle");
if (throttles > 0) problems.push(`${throttles} throttle row(s) — sanitize before marking`);
const credentials = count(db, "SELECT COUNT(*) AS n FROM account_credential");
if (credentials > 0)
  problems.push(
    `${credentials} credential(s) (password or Google) — sanitize before marking; a demonstration is entered only through demo_identity`,
  );

db.close();

const report = {
  candidate: to ? candidatePath : workingPath,
  schema: candidateVersions.at(-1) ?? 0,
  designated,
  problems,
};
console.log(JSON.stringify(report, null, 1));

if (problems.length > 0) {
  if (to) rmSync(scratch, { recursive: true, force: true });
  fail(`not a valid Demo baseline:\n  - ${problems.join("\n  - ")}`);
}

if (!to && !inPlace) {
  rmSync(scratch, { recursive: true, force: true });
  console.log("\nValid. Nothing was written — pass --to <out.db> or --in-place to mark it.");
  process.exit(0);
}

const target = new Database(workingPath);
target
  .prepare(
    "INSERT INTO demo_state (id, marker) VALUES (1, 'demo-baseline') ON CONFLICT (id) DO UPDATE SET marker = 'demo-baseline'",
  )
  .run();
target.pragma("journal_mode = DELETE");
const finalIntegrity = target.pragma("integrity_check", { simple: true });
target.close();
chmodSync(workingPath, 0o600);

if (to) {
  /* workingPath was a scratch copy; move its bytes into the real target rather
     than leaving the marked file in the temp directory. */
  const finished = new Database(workingPath, { readonly: true, fileMustExist: true });
  finished.prepare("VACUUM INTO ?").run(to);
  finished.close();
  chmodSync(to, 0o600);
  rmSync(scratch, { recursive: true, force: true });
}

const finalPath = to ?? candidatePath;
if (finalIntegrity !== "ok")
  fail(`marked ${finalPath}, but its final integrity check said: ${finalIntegrity}`);
console.log(
  `\nMarked ${finalPath} as demo-baseline. Integrity: ${finalIntegrity}. Ready for demo-provision.mjs.`,
);
