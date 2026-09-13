import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Which SQLite file an installation opens — decided in one place.
 *
 * ## Three databases that must never be one
 *
 *   ordinary live database   `OIKONOMIA_DB`            e.g. oikonomia.db
 *   demonstration database   `OIKONOMIA_DEMO_DB`       e.g. oikonomia-demo.db
 *   demonstration baseline   `OIKONOMIA_DEMO_BASELINE` e.g. oikonomia-demo-baseline.db
 *
 * A public demonstration is reset to its baseline by deleting and restoring
 * every row. Pointed at a church's own database by mistake, that is the loss of
 * everything the church ever wrote. So a demonstration never opens the
 * ordinary database: `OIKONOMIA_DEMO_MODE=true` selects `OIKONOMIA_DEMO_DB`,
 * and there is no fallback from one to the other. A demonstration whose
 * database cannot be told apart from the ordinary one or from its baseline
 * refuses to open anything.
 *
 * "Told apart" means the file, not the spelling: two paths are the same
 * database when they resolve to the same canonical path through symlinks, or —
 * when both exist — to the same file on disk (a hard link).
 */

export class DatabasePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabasePathError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

const setting = (env: Environment, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value ? value : undefined;
};

const production = (env: Environment) => env["NODE_ENV"] === "production";

/** Where a developer's databases go when nothing is configured. */
const developmentPath = (file: string) => join(process.cwd(), ".data", file);

/** The ordinary installation's database, if one can be named. Never guessed in production. */
export function ordinaryDatabasePath(env: Environment = process.env): string | undefined {
  return (
    setting(env, "OIKONOMIA_DB") ?? (production(env) ? undefined : developmentPath("oikonomia.db"))
  );
}

/** The demonstration's baseline, if configured. Never defaulted: a reset needs it named. */
export function demoBaselinePath(env: Environment = process.env): string | undefined {
  return setting(env, "OIKONOMIA_DEMO_BASELINE");
}

/**
 * The canonical form of a path, whether or not the file exists yet.
 *
 * The nearest existing ancestor is resolved through symlinks and the rest is
 * appended, so `/link/demo.db` and `/real/demo.db` compare equal before either
 * database has been created.
 */
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  let existing = absolute;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = realpathSync(existing);
  } catch {
    /* Unreadable: compare what we have. Equality can only be under-reported for
       a path nobody can open, which the open itself will then refuse. */
  }
  return rest.length > 0 ? join(real, ...rest) : real;
}

/** Whether two paths name the same database file. */
export function sameFile(a: string, b: string): boolean {
  if (a === ":memory:" || b === ":memory:") return false;
  if (canonicalPath(a) === canonicalPath(b)) return true;
  try {
    const first = statSync(a);
    const second = statSync(b);
    return first.dev === second.dev && first.ino === second.ino;
  } catch {
    return false;
  }
}

/** Whether `path` is `directory` or somewhere inside it. */
export function within(path: string, directory: string): boolean {
  const inner = canonicalPath(path);
  const outer = canonicalPath(directory);
  return inner === outer || inner.startsWith(outer + "/");
}

/**
 * The database this process opens.
 *
 * Demo Mode off: `OIKONOMIA_DB` (or `.data/oikonomia.db` in development).
 * Demo Mode on: `OIKONOMIA_DEMO_DB` (or `.data/oikonomia-demo.db` in
 * development) — and only if it is neither the ordinary database nor the
 * baseline.
 */
export function liveDatabasePath(demoMode: boolean, env: Environment = process.env): string {
  if (!demoMode) {
    const ordinary = ordinaryDatabasePath(env);
    if (!ordinary) {
      throw new DatabasePathError(
        "OIKONOMIA_DB is not set. A production installation must name a database file " +
          "outside the application directory, because a redeploy replaces that directory.",
      );
    }
    return ordinary;
  }

  const demo =
    setting(env, "OIKONOMIA_DEMO_DB") ??
    (production(env) ? undefined : developmentPath("oikonomia-demo.db"));
  if (!demo) {
    throw new DatabasePathError(
      "OIKONOMIA_DEMO_DB is not set. Demo Mode opens its own database and never the " +
        "ordinary one (OIKONOMIA_DB), so it will not start without being told which.",
    );
  }

  const ordinary = ordinaryDatabasePath(env);
  if (ordinary && sameFile(demo, ordinary)) {
    throw new DatabasePathError(
      "OIKONOMIA_DEMO_DB is the same file as OIKONOMIA_DB. A demonstration is reset by " +
        "replacing every row, so it must never share the ordinary installation's database.",
    );
  }

  const baseline = demoBaselinePath(env);
  if (baseline && sameFile(demo, baseline)) {
    throw new DatabasePathError(
      "OIKONOMIA_DEMO_DB is the same file as OIKONOMIA_DEMO_BASELINE. The baseline is only " +
        "ever read; opening it as the live database would change it.",
    );
  }

  return demo;
}
