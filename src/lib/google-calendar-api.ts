import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import { withWorkspace } from "./workspace-api";

/**
 * Google Calendar: publishing the church calendar, and a leader's own calendar
 * beside their week.
 *
 * The composition edge. Who may do what is decided in
 * `google-calendar-service.ts`; this only assembles it for one request.
 */

export type CalendarPublishingView =
  import("@/server/services/google-calendar-service").CalendarPublishingView;
export type GoogleCalendarOverlay = import("@/server/google/calendar").Overlay;
export type GoogleCalendarOverlayEvent = import("@/server/google/calendar").OverlayEvent;

async function withGoogleCalendar<T>(
  work: (
    service: import("@/server/services/google-calendar-service").GoogleCalendarService,
    viewer: import("@/domain/viewer").Viewer,
  ) => Promise<T> | T,
): Promise<Result<T>> {
  return withWorkspace(async ({ viewer, db }) => {
    const [
      { createGoogleCalendarService },
      { calendarPublisherFor },
      { publishingConfig },
      { workspaceConfig },
      { createCalendarPublicationRepository },
      { createCalendarRepository },
      { createLifegroupRepository },
      { createOrganizationRepository },
      { createAccountRepository },
      { config },
    ] = await Promise.all([
      import("@/server/services/google-calendar-service"),
      import("@/server/google/calendar-publishing"),
      import("@/server/google/calendar"),
      import("@/server/google/workspace"),
      import("@/server/repositories/calendar-publication-repository"),
      import("@/server/repositories/calendar-repository"),
      import("@/server/repositories/lifegroup-repository"),
      import("@/server/repositories/organization-repository"),
      import("@/server/repositories/account-repository"),
      import("@/config"),
    ]);

    const publisher = calendarPublisherFor(db);
    const calendarId = publishingConfig()?.calendarId;
    const organization = createOrganizationRepository(db);
    const accounts = createAccountRepository(db);

    const service = createGoogleCalendarService({
      ...(publisher ? { publisher } : {}),
      ...(calendarId ? { calendarId } : {}),
      publications: createCalendarPublicationRepository(db),
      records: {
        entries: () => createCalendarRepository(db).allEntries(),
        gatherings: () => createLifegroupRepository(db).allGatherings(),
      },
      workspace: () => {
        try {
          return workspaceConfig();
        } catch {
          /* A misconfiguration is the administrator's to see; the week reads it
             as "not set up". */
          return undefined;
        }
      },
      /* The person record's address first — it is what the church entered —
         then the address they sign in with. */
      emailOf: (personId) =>
        organization.findPerson(personId)?.email ?? accounts.findByPerson(personId)?.email,
      timeZone: () => config.site.timezone,
    });
    return work(service, viewer);
  });
}

/* ------------------------------------------------------------- publishing */

export const fetchCalendarPublishing = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withGoogleCalendar((service, viewer): CalendarPublishingView =>
      service.publishingStatus(viewer),
    ),
  );

export const publishAllCalendarEvents = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(() => withGoogleCalendar((service, viewer) => service.publishAll(viewer)));

/* ---------------------------------------------------------------- overlay */

export const fetchGoogleCalendarOverlay = createServerFn({ method: "GET" })
  .validator((input: { from: string; to: string }) => input)
  .handler(({ data }) => withGoogleCalendar((service, viewer) => service.overlay(viewer, data)));
