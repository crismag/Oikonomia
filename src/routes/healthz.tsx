import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Is this installation actually working?
 *
 * ## Why a route and not a page
 *
 * Because the interesting question is one no page can answer cheaply: **can
 * the server open its database?** Every ordinary route returns the application
 * shell without touching persistence — the data arrives later, from the
 * browser — so a 200 from `/people` says nothing about whether the schema
 * exists.
 *
 * That gap is not hypothetical. The release readiness audit found a build that
 * carried no migrations: every route answered 200, every page then said
 * "Oikonomia could not be reached", and no HTTP check could tell the
 * difference. This endpoint is the difference.
 *
 * ## What it says, and what it will not say
 *
 * Whether the database opened, and how many migrations are applied. That is
 * enough for an uptime monitor to alert on and for a deployment to verify
 * itself, and it is deliberately everything: no counts of people or reports,
 * no configuration, no version of anything a probe could use to choose an
 * exploit. It is unauthenticated because a health check that needs a session
 * cannot tell you the session store is broken.
 */
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        const body = (status: number, payload: Record<string, unknown>) =>
          new Response(JSON.stringify(payload), {
            status,
            headers: {
              "content-type": "application/json; charset=utf-8",
              /* A monitor asking "is it up now" must never be answered from a
                 cache. */
              "cache-control": "no-store",
            },
          });

        try {
          const [{ getDatabase }, { appliedVersions }] = await Promise.all([
            import("@/server/db/connection"),
            import("@/server/db/migrate"),
          ]);

          const applied = appliedVersions(getDatabase());
          return body(200, {
            ok: true,
            migrations: applied.length,
            schemaVersion: applied.at(-1) ?? 0,
          });
        } catch (error) {
          /* Logged in full for whoever is on call; the response says only that
             it failed. A health endpoint that returns a stack trace is a
             reconnaissance endpoint. */
          console.error("Health check failed:", error);
          return body(503, { ok: false });
        }
      },
    },
  },
  beforeLoad: () => {
    throw redirect({ to: "/", search: {} });
  },
});
