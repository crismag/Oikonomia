import { parseMigrations, type Migration } from "./migrate";

/**
 * The migrations, carried inside the build.
 *
 * ## The bug this exists to prevent
 *
 * Migrations used to be read from `migrations/` with `readdirSync` at runtime,
 * resolved relative to the module's own URL. That works in development, where
 * the module and the `.sql` files sit next to each other in the repository, and
 * it fails completely in a production build: the bundler has no reason to know
 * that a directory read at runtime refers to files it should copy, so
 * `.output/server/_ssr/migrations/` was never created.
 *
 * The symptom was not a missing-migration error. It was every page of a
 * deployed Oikonomia showing "Oikonomia could not be reached", because opening
 * the database is the first thing a request does and `ENOENT` on the migrations
 * directory happened before anything else could.
 *
 * `import.meta.glob` states the dependency at build time, so the SQL becomes
 * part of the bundle and cannot be left behind. It is also eager and raw: the
 * schema is a few tens of kilobytes on the server, and a migration that arrived
 * asynchronously would mean opening a database were an async operation.
 */

const SOURCES = import.meta.glob("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function bundledMigrations(): Migration[] {
  const files = Object.entries(SOURCES).map(([path, sql]) => ({
    file: path.slice(path.lastIndexOf("/") + 1),
    sql,
  }));

  /* An empty set means the glob matched nothing — the build has dropped the
     schema again. Refusing here says so, rather than letting SQLite report a
     missing table several layers away. */
  if (files.length === 0) {
    throw new Error(
      "No migrations were bundled. The build has not included src/server/db/migrations/*.sql.",
    );
  }

  return parseMigrations(files);
}
