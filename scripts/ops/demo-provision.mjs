/**
 * Create a public demonstration's live database from its baseline — once.
 *
 *   node scripts/ops/demo-provision.mjs --baseline <oikonomia-demo-baseline.db>
 *        --to <oikonomia-demo.db> [--ordinary <oikonomia.db>] [--sqlite <better-sqlite3 dir>]
 *
 * Run it before the demonstration first starts, with OIKONOMIA_DEMO_DB then
 * pointing at `--to`. After that the database is never created, copied or
 * replaced again: it is reset in place by `/maintenance/run?task=demo-reset`,
 * because the server's processes hold it open.
 *
 * ## What it guarantees
 *
 * - **It only ever creates a file.** A target that exists — or has a `-wal` or
 *   `-shm` beside it — is refused. The finished copy is hard-linked into place,
 *   which fails rather than overwrite anything that appeared in the meantime.
 * - The baseline is only read (a read-only connection and `VACUUM INTO`), and
 *   must already be marked `demo-baseline` and designate somebody.
 * - The three databases are different files: target, baseline and — when named —
 *   the ordinary installation's database, compared through symlinks.
 * - The new database is marked `demo-installation`, generation 0, and passes
 *   SQLite's integrity and foreign-key checks. It is readable by this account
 *   alone.
 *
 * A church's own database is never marked by this script, and nothing in the
 * application marks one: that marker is what lets a reset touch a database.
 */

import { createRequire } from "node:module";
import { chmodSync, existsSync, linkSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

process.umask(0o077);

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const fail = (message) => {
  console.error(`demo-provision: ${message}`);
  process.exit(1);
};

const baseline = option("baseline") && resolve(option("baseline"));
const to = option("to") && resolve(option("to"));
const ordinary = option("ordinary") && resolve(option("ordinary"));
if (!baseline || !to) {
  fail(
    "usage: --baseline <baseline.db> --to <demo.db> [--ordinary <oikonomia.db>] [--sqlite <better-sqlite3 dir>]",
  );
}

/** A path through symlinks, whether or not the file exists yet. */
const canonical = (path) => {
  const parent = dirname(path);
  return existsSync(path)
    ? realpathSync(path)
    : join(existsSync(parent) ? realpathSync(parent) : parent, basename(path));
};
const same = (a, b) => {
  if (canonical(a) === canonical(b)) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const [x, y] = [statSync(a), statSync(b)];
  return x.dev === y.dev && x.ino === y.ino;
};

if (!existsSync(baseline)) fail(`no baseline at ${baseline}.`);
if (same(to, baseline)) fail("the target is the baseline itself.");
if (ordinary && same(to, ordinary)) fail("the target is the ordinary installation's database.");
if (ordinary && same(baseline, ordinary)) {
  fail("the baseline is the ordinary installation's database.");
}
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  if (existsSync(to + suffix)) {
    fail(
      `${to + suffix} already exists. This script only creates a new database; ` +
        "a running demonstration is reset with task=demo-reset, never replaced.",
    );
  }
}
if (!existsSync(dirname(to))) fail(`${dirname(to)} does not exist.`);

const require = createRequire(join(process.cwd(), "noop.js"));
const Database = require(option("sqlite") ? resolve(option("sqlite")) : "better-sqlite3");

const source = new Database(baseline, { readonly: true, fileMustExist: true });
try {
  const marker = source
    .prepare(
      "SELECT marker FROM demo_state WHERE id = 1 AND EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'demo_state')",
    )
    .get();
  if (marker?.marker !== "demo-baseline") fail("the baseline is not marked demo-baseline.");
  const designated = source
    .prepare("SELECT COUNT(*) AS n FROM demo_identity WHERE kind = 'designated'")
    .get().n;
  if (designated === 0) fail("the baseline designates nobody to explore as.");
} catch (error) {
  source.close();
  fail(`the baseline could not be read: ${error.message}`);
}

const scratch = join(dirname(to), `.${basename(to)}.provisioning-${process.pid}`);
/* Reported after cleanup: `process.exit` inside the try would skip the finally. */
let problem;
try {
  source.prepare("VACUUM INTO ?").run(scratch);
  source.close();

  const copy = new Database(scratch);
  try {
    copy
      .prepare(
        "UPDATE demo_state SET marker = 'demo-installation', generation = 0, last_reset_at = NULL WHERE id = 1",
      )
      .run();
    const integrity = copy.pragma("integrity_check", { simple: true });
    const orphans = copy.pragma("foreign_key_check");
    if (integrity !== "ok" || orphans.length > 0) {
      throw new Error(`the copy failed its checks (${integrity}, ${orphans.length} orphaned rows)`);
    }
  } finally {
    copy.close();
  }

  chmodSync(scratch, 0o600);
  /* A hard link refuses an existing name, so nothing is ever replaced. */
  linkSync(scratch, to);
} catch (error) {
  problem = error.message;
} finally {
  if (source.open) source.close();
  rmSync(scratch, { force: true });
}
if (problem) fail(problem);

console.log(
  `Created ${to} from ${baseline}, marked demo-installation at generation 0.\n` +
    "Set OIKONOMIA_DEMO_DB to it (with OIKONOMIA_DEMO_MODE=true and OIKONOMIA_DEMO_BASELINE) and start the application.",
);
