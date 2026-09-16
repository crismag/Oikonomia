import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { AgendaItem, RecurrenceScope, ScheduleEntry } from "@/domain/types";

/**
 * The calendar's API.
 *
 * ## Why server functions rather than `/api/calendar/events`
 *
 * §5 of the MVP brief sketches REST routes. This version of TanStack Start
 * (1.168) has **no server-route API** — `createServerFn` is the transport the
 * framework provides, and `src/start.ts` already protects it with CSRF
 * middleware. Hand-rolling Nitro handlers beside it would be adding
 * infrastructure the framework does not ask for, which §4 warns against.
 *
 * What §5 is actually protecting is preserved: these are shaped around the
 * **resource and the workflow**, not around the widget that calls them —
 * `fetchCalendarRange`, `createCalendarEntry`, `updateCalendarEntry`,
 * `deleteCalendarEntry` — and the layering below is untouched, so putting HTTP
 * in front of it later is a new file rather than a rewrite.
 *
 * ## Why this file is in `lib/` and its imports are inside the handler
 *
 * Two separate constraints, both about the client bundle.
 *
 * TanStack Start **denies the client any import from `src/server/`**, by path
 * and regardless of what the file contains — so a module the provider imports
 * cannot live there, however careful its contents.
 *
 * And a handler's *body* is stripped from the client bundle while its file's
 * top-level imports are not. `better-sqlite3` is a native addon and `node:fs`
 * does not exist in a browser, so the database layer is loaded lazily inside
 * the handler. Only types cross the top of this file.
 *
 * ## The envelope survives
 *
 * Every function returns `{ data }` or `{ error }` (`api/response.ts`), because
 * a thrown error crossing the RPC boundary arrives as a string and takes the
 * field-level messages with it. The client unwraps once, in `calendar-client.ts`.
 */

export interface CalendarRange {
  entries: ScheduleEntry[];
  agenda: AgendaItem[];
}

/**
 * Assemble the service for one request, and run the work inside the envelope.
 *
 * This is the composition edge — the only place that reaches for the
 * process-wide database. Everything below receives what it needs.
 */
async function withCalendar<T>(
  work: (service: CalendarService, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createCalendarRepository },
    { createCalendarService },
    { createEscalationRepository },
    { createOrganizationRepository },
    { createEscalationService },
    { createLeadershipReportRepository },
    { calendarPublisherFor },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/calendar-repository"),
    import("@/server/services/calendar-service"),
    import("@/server/repositories/escalation-repository"),
    import("@/server/repositories/organization-repository"),
    import("@/server/services/escalation-service"),
    import("@/server/repositories/leadership-report-repository"),
    import("@/server/google/calendar-publishing"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);
    const escalations = createEscalationService(
      createEscalationRepository(db),
      createOrganizationRepository(db),
    );
    const service = createCalendarService(
      createCalendarRepository(db),
      {
        askedOf: (viewer, escalationId) => {
          try {
            return escalations.get(viewer, escalationId).mine;
          } catch {
            return false;
          }
        },
      },
      {
        authorsFollowUp: (viewer, reportId, blockId) => {
          const report = createLeadershipReportRepository(db).find(reportId);
          return (
            !!report &&
            report.authorId === viewer.person.id &&
            (report.blocks ?? []).some(
              (block) => block.id === blockId && block.type === "follow-up",
            )
          );
        },
      },
      /* The church's Google Calendar, when it publishes one. */
      calendarPublisherFor(db),
    );
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type CalendarService = import("@/server/services/calendar-service").CalendarService;
type Viewer = import("@/domain/viewer").Viewer;

/* ------------------------------------------------------------------ reads */

export const fetchCalendarRange = createServerFn({ method: "GET" })
  .validator((input: { from: string; to: string }) => input)
  .handler(({ data }) => withCalendar((service, viewer) => service.listRange(viewer, data)));

/* ----------------------------------------------------------------- writes */

export const createCalendarEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withCalendar((service, viewer) => service.createEntry(viewer, data)));

export const updateCalendarEntry = createServerFn({ method: "POST" })
  .validator(
    (input: { id: string; patch: unknown; occurrenceDate?: string; scope?: RecurrenceScope }) =>
      input,
  )
  .handler(({ data }) =>
    withCalendar((service, viewer) =>
      service.updateEntry(viewer, data.id, data.patch, data.occurrenceDate, data.scope),
    ),
  );

export const deleteCalendarEntry = createServerFn({ method: "POST" })
  .validator((input: { id: string; occurrenceDate?: string; scope?: RecurrenceScope }) => input)
  .handler(({ data }) =>
    withCalendar((service, viewer) => {
      service.deleteEntry(viewer, data.id, data.occurrenceDate, data.scope);
      return null;
    }),
  );

export const duplicateCalendarEntry = createServerFn({ method: "POST" })
  .validator((input: { id: string; date: string }) => input)
  .handler(({ data }) =>
    withCalendar((service, viewer) => service.duplicateEntry(viewer, data.id, data.date)),
  );

/* ----------------------------------------------------------------- agenda */

export const createAgendaItem = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withCalendar((service, viewer) => service.createAgendaItem(viewer, data)));

export const updateAgendaItem = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) =>
    withCalendar((service, viewer) => service.updateAgendaItem(viewer, data.id, data.patch)),
  );

export const deleteAgendaItem = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    withCalendar((service, viewer) => {
      service.deleteAgendaItem(viewer, data.id);
      return null;
    }),
  );
