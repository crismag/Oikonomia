/**
 * Copy an Oikonomia database to a new location, safely.
 *
 *   node scripts/ops/copy-database.mjs --from <source.db> --to <target.db>
 *        [--replace-empty] [--artifacts-from <dir> --artifacts-to <dir>]
 *        [--sqlite <path to better-sqlite3>]
 *
 * ## What it guarantees
 *
 * - The copy is a consistent snapshot, taken with SQLite's `VACUUM INTO` from a
 *   read-only connection — safe while the application is still writing to the
 *   source. Copying the `.db` file directly would capture it mid-transaction
 *   and leave the `-wal` behind.
 * - It never writes to a database any process has open. A database file
 *   replaced under a running process is a corruption, not a move.
 * - It never overwrites data. A target that holds people is refused outright;
 *   an empty target (one a server created on first start) is moved aside only
 *   with `--replace-empty`, and kept, not deleted.
 * - Everything it creates is readable by this account alone.
 * - It proves the copy: integrity check, foreign-key check, and the row count
 *   of every table against the source.
 *
 * What it does not do is switch the application over. That is a restart with
 * OIKONOMIA_DB pointing at the target, and anything written to the source
 * between this copy and that restart stays behind — so run it in a quiet
 * moment, or stop the application first.
 */

import { createRequire } from "node:module";
import {
  chmodSync,
  cpSync,
  existsSync,
  readdirSync,
  readlinkSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

process.umask(0o077);

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const flag = (name) => args.includes(`--${name}`);

const fail = (message) => {
  console.error(`copy-database: ${message}`);
  process.exit(1);
};

const from = option("from") && resolve(option("from"));
const to = option("to") && resolve(option("to"));
if (!from || !to) {
  fail("usage: --from <source.db> --to <target.db> [--replace-empty] [--artifacts-from <dir> --artifacts-to <dir>] [--sqlite <better-sqlite3 dir>]");
}
if (from === to) fail("source and target are the same file.");
if (!existsSync(from)) fail(`no database at ${from}.`);

const require = createRequire(join(process.cwd(), "noop.js"));
const Database = require(option("sqlite") ? resolve(option("sqlite")) : "better-sqlite3");

/** Processes holding any of these files open (Linux; elsewhere, nothing is known). */
function holders(files) {
  if (process.platform !== "linux") return [];
  const found = new Set();
  for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
    if (Number(pid) === process.pid) continue;
    let fds;
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        if (files.includes(readlinkSync(`/proc/${pid}/fd/${fd}`))) found.add(pid);
      } catch {
        /* closed while we looked */
      }
    }
  }
  return [...found];
}

const sidecars = (file) => [file, `${file}-wal`, `${file}-shm`];
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const tablesOf = (db) =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);

/* 1. The target must be free, and must not hold anybody's data. */
const busy = holders(sidecars(to));
if (busy.length) fail(`${to} is open by process ${busy.join(", ")}. Stop the application first.`);

if (existsSync(to)) {
  const target = new Database(to, { readonly: true, fileMustExist: true });
  const hasPeople = tablesOf(target).includes("person");
  const people = hasPeople ? target.prepare("SELECT count(*) AS n FROM person").get().n : 0;
  target.close();

  if (people > 0) fail(`${to} already holds ${people} people. Refusing to overwrite it.`);
  if (!flag("replace-empty")) {
    fail(`${to} exists (empty). Pass --replace-empty to move it aside and copy over it.`);
  }

  const aside = `${to}.empty-${new Date().toISOString().replaceAll(":", "-")}`;
  for (const file of sidecars(to)) {
    if (existsSync(file)) renameSync(file, file.replace(to, aside));
  }
  console.log(`moved the empty target aside: ${aside}`);
}

/* 2. A consistent snapshot of the source, straight into place. */
const source = new Database(from, { readonly: true, fileMustExist: true, timeout: 15000 });
const quick = source.pragma("quick_check", { simple: true });
if (quick !== "ok") fail(`the source failed its quick check: ${quick}`);

source.prepare("VACUUM INTO ?").run(to);
chmodSync(to, 0o600);
console.log(`copied ${from} → ${to}`);

/* 3. Prove it. */
const copy = new Database(to, { readonly: true, fileMustExist: true });
const integrity = copy.pragma("integrity_check", { simple: true });
const foreignKeys = copy.prepare("SELECT * FROM pragma_foreign_key_check").all().length;

let mismatches = 0;
for (const table of tablesOf(source)) {
  const count = (db) => db.prepare(`SELECT count(*) AS n FROM ${quote(table)}`).get().n;
  const [wanted, got] = [count(source), count(copy)];
  if (wanted !== got) {
    mismatches++;
    console.log(`  row count differs in ${table}: source ${wanted}, copy ${got}`);
  }
}

const version = (db) => db.prepare("SELECT max(version) AS v FROM schema_migrations").get().v;
const schema = version(copy);
const people = copy.prepare("SELECT count(*) AS n FROM person").get().n;
console.log(
  `verified: integrity ${integrity}, foreign-key problems ${foreignKeys}, ` +
    `row-count differences ${mismatches}, schema ${schema} (source ${version(source)}), people ${people}, ` +
    `mode ${(statSync(to).mode & 0o777).toString(8)}`,
);
copy.close();
source.close();

if (integrity !== "ok" || foreignKeys > 0 || mismatches > 0 || !schema) {
  fail("verification did not pass. The application has not been switched; nothing was deleted.");
}

/* 4. The artifacts that belong with it — exports and backups — owner-only, never overwritten. */
const artifactsFrom = option("artifacts-from") && resolve(option("artifacts-from"));
const artifactsTo = option("artifacts-to") && resolve(option("artifacts-to"));
if (artifactsFrom && artifactsTo && existsSync(artifactsFrom)) {
  cpSync(artifactsFrom, artifactsTo, { recursive: true, force: false, errorOnExist: false });
  const lock = (path) => {
    const directory = statSync(path).isDirectory();
    chmodSync(path, directory ? 0o700 : 0o600);
    if (directory) for (const entry of readdirSync(path)) lock(join(path, entry));
  };
  lock(artifactsTo);
  console.log(`artifacts copied → ${artifactsTo}`);
}

console.log(`\nDone. Point OIKONOMIA_DB at ${to} and restart the application. ${dirname(to)} holds the data.`);
