import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The work nobody remembers to do.
 *
 * ## Why this is an endpoint and not a script
 *
 * Backups, retention and sweeping run through the application's own services,
 * which are TypeScript compiled into the server bundle. A standalone script
 * would either re-implement them — two copies of the rules that decide what a
 * backup contains and what may be deleted — or reach into build output by
 * path. Both drift. Running them inside the process that serves requests means
 * the maintenance and the application are the same code, on the same database
 * connection, writing the same audit trail.
 *
 * ## Why not an in-process timer
 *
 * A timer stops when the process stops and says nothing when it does. The
 * failure mode is a church that believes it has nightly backups and has had
 * none since a deploy in March. A cron entry is visible in the system's own
 * scheduling, runs whether or not anybody is signed in, and leaves an exit
 * code a monitor can read:
 *
 * ```cron
 * 0 2 * * *  curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/maintenance/run?task=backup
 * 30 3 * * 0 curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/maintenance/run?task=retention
 * ```
 *
 * ## How it is protected
 *
 * A bearer token from `OIKONOMIA_MAINTENANCE_TOKEN`, compared in constant
 * time. **Unset means the endpoint is off**, not open: an unauthenticated way
 * to make a server copy its entire database is a denial-of-service control
 * with a friendly name, and failing open would hand it to the internet the
 * moment somebody forgot a variable.
 *
 * The work is recorded as performed by `system` rather than by a person,
 * because a cron job is not an administrator with a login and an audit trail
 * that says otherwise is one that lies.
 *
 * ## When something fails
 *
 * The response is non-zero, which is what `curl -fsS` turns into a failing
 * cron job — and somebody is emailed, because cron's own mail is not read in a
 * church. Failures only: an alert that arrives every night when everything
 * worked is an alert somebody makes a filter for, and then the one that
 * matters is filtered too. See `OIKONOMIA_ALERT_TO`.
 */

const TASKS = ["backup", "retention", "sweep"] as const;

/**
 * How long an authentication audit event is kept.
 *
 * A year: long enough to investigate anything anybody investigates, short
 * enough that the trail does not become the largest thing in the database.
 */
const AUTH_EVENT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
type Task = (typeof TASKS)[number];

export const Route = createFileRoute("/maintenance/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (status: number, payload: Record<string, unknown>) =>
          new Response(JSON.stringify(payload), {
            status,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          });

        const expected = process.env["OIKONOMIA_MAINTENANCE_TOKEN"]?.trim();
        if (!expected) {
          /* Off, and says so plainly — this is an operator's own endpoint, and
             "not configured" is the thing they need to know. */
          return json(503, { ok: false, reason: "maintenance-token-not-configured" });
        }

        const { safeEqual } = await import("@/server/auth/secrets");
        const offered = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!offered || !safeEqual(offered, expected)) {
          return json(401, { ok: false });
        }

        const requested = new URL(request.url).searchParams.get("task") ?? "backup";
        if (!TASKS.includes(requested as Task)) {
          return json(400, { ok: false, reason: "unknown-task", known: TASKS });
        }

        const [{ getDatabase }, { createDataJobRepository }, { createContinuityService }] =
          await Promise.all([
            import("@/server/db/connection"),
            import("@/server/repositories/data-job-repository"),
            import("@/server/services/continuity-service"),
          ]);

        const db = getDatabase();

        const { alertMaintenanceFailure } = await import("@/server/data/alert");

        /* Every failure path below reports the same way: the caller gets an
           honest non-zero result *and* somebody is told, because cron's own
           mail is not read in a church. */
        const failed = async (reason: string, jobId?: string) => {
          const alerted = await alertMaintenanceFailure({
            task: requested,
            reason,
            ...(jobId ? { jobId } : {}),
          });
          return json(500, {
            ok: false,
            task: requested,
            ...(jobId ? { jobId } : {}),
            error: reason,
            alerted,
          });
        };

        try {
          if (requested === "sweep") {
            const [{ createThrottle }, { createAccountRepository }] = await Promise.all([
              import("@/server/auth/throttle"),
              import("@/server/repositories/account-repository"),
            ]);

            const removed = createThrottle(db).sweep();
            const events = createAccountRepository(db).pruneEvents(
              new Date(Date.now() - AUTH_EVENT_RETENTION_MS).toISOString(),
            );

            return json(200, { ok: true, task: requested, removed, events });
          }

          const continuity = createContinuityService(db, createDataJobRepository(db));

          if (requested === "retention") {
            const result = continuity.runRetention(null);
            return json(200, { ok: true, task: requested, ...result });
          }

          /* `null` viewer: taken by the system, not by an administrator. */
          const job = continuity.runBackup(null);
          if (job.status !== "completed") {
            return failed(job.errorSummary ?? "The backup did not complete.", job.id);
          }

          return json(200, {
            ok: true,
            task: requested,
            jobId: job.id,
            bytes: job.artifactBytes ?? 0,
          });
        } catch (error) {
          console.error(`Maintenance task "${requested}" failed:`, error);
          return failed(error instanceof Error ? error.message : "Unknown failure");
        }
      },
    },
  },
  beforeLoad: () => {
    throw redirect({ to: "/", search: {} });
  },
});
