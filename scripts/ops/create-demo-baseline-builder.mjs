/**
 * Create a clean, schema-only SQLite database — the input the separate
 * demonstration-content project populates.
 *
 *   node scripts/ops/create-demo-baseline-builder.mjs --to <builder.db>
 *
 * ## Why this, and not a copy of an existing installation
 *
 * Copying a real installation's database — Hostinger's `oikonomia.db`
 * included — would carry a real administrator, real people, and whatever that
 * installation's own history left behind, into what is meant to become public
 * content. This creates a database with nothing in it but what every fresh
 * Oikonomia installation has: the schema, and the few rows a migration seeds
 * on purpose (`retention_policy`; see migration 031).
 *
 * ## How it applies the schema without duplicating it
 *
 * `src/server/db/migrate.ts` already has exactly this job — `loadMigrations`
 * reads `src/server/db/migrations/*.sql` from disk and `migrate` applies them
 * in order — because the *deployed* server bundles them a different way
 * (`bundled-migrations.ts`, which depends on Vite's `import.meta.glob` and so
 * cannot run under plain Node). This script imports the same two functions
 * Node's own TypeScript support runs directly, so there are not two
 * definitions of "the current schema" to keep in sync — only two ways of
 * reading the one set of `.sql` files.
 *
 * ## What comes out
 *
 * A database at the current schema version, `WAL` and `foreign_keys` on (the
 * same pragmas `openDatabase` sets), owner-only, holding nothing a real
 * installation would consider its own: no person, no account, no session, no
 * credential, no configuration override. It is not yet a demonstration
 * baseline — it designates nobody, so a demonstration would offer no one to
 * explore as, and `demo-provision.mjs` would refuse it. See
 * `docs/architecture/deployment.md`, "Building a Demo baseline", for what
 * happens to it next.
 */

import { existsSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

process.umask(0o077);

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const flag = (name) => args.includes(`--${name}`);

const fail = (message) => {
  console.error(`create-demo-baseline-builder: ${message}`);
  process.exit(1);
};

const to = option("to") && resolve(option("to"));
if (!to) fail("usage: --to <builder.db> [--quiet]");
if (existsSync(to)) fail(`${to} already exists. This script only creates a new file.`);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const { loadMigrations, migrate } = await import(
  join(repoRoot, "src", "server", "db", "migrate.ts")
);

const db = new Database(to);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
migrate(db, loadMigrations(join(repoRoot, "src", "server", "db", "migrations")));

/* A builder that already held rows would defeat the point: verify it, rather
   than trust the migrations to have stayed side-effect-free. */
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((row) => row.name);
const rows = {};
for (const table of tables) {
  rows[table] = db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n;
}
const populated = Object.entries(rows).filter(([, n]) => n > 0);
/* The one row a migration seeds on purpose (031, retention_policy) and the
   migration ledger itself. Anything else populated is a bug in this script or
   a migration that stopped being side-effect-free. */
const unexpected = populated.filter(
  ([table]) => !["retention_policy", "schema_migrations"].includes(table),
);

const integrity = db.pragma("integrity_check", { simple: true });
const foreignKeys = db.pragma("foreign_key_check");
const schema = db.prepare("SELECT max(version) AS v FROM schema_migrations").get().v;

db.pragma("journal_mode = DELETE");
db.close();
chmodSync(to, 0o600);

if (unexpected.length > 0) {
  fail(
    `unexpected content in a fresh database: ${unexpected.map(([t, n]) => `${t}=${n}`).join(", ")}. Not written to ${to}.`,
  );
}
if (integrity !== "ok" || foreignKeys.length > 0) {
  fail(
    `the new database failed verification: integrity ${integrity}, foreign-key problems ${foreignKeys.length}.`,
  );
}

if (!flag("quiet")) {
  console.log(
    JSON.stringify(
      {
        path: to,
        schema,
        tables: tables.length,
        populated: Object.fromEntries(populated),
        integrity,
        foreignKeyProblems: foreignKeys.length,
      },
      null,
      1,
    ),
  );
  console.log(
    `\nCreated ${to}: schema ${schema}, ${tables.length} tables, nothing but the seeded defaults. ` +
      "Not a demonstration baseline yet — it designates nobody. Populate it by pointing a normal " +
      `(Demo Mode off) Oikonomia server at it (OIKONOMIA_DB=${to}) and using /setup and the ordinary ` +
      "admin screens, the same way any fresh installation is set up. Then run mark-demo-baseline.mjs.",
  );
}
