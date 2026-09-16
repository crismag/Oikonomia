import { addDays } from "date-fns";

import { ApiError } from "../api/response";
import {
  googleRequest,
  mayActAs,
  WORKSPACE_SCOPES,
  workspaceConfig,
  type WorkspaceConfig,
} from "./workspace";
import type {
  CalendarPublicationRepository,
  PublishedSource,
} from "../repositories/calendar-publication-repository";
import { entryOccursOn, fromISO, toISO } from "@/domain/schedule";
import type { Gathering, ScheduleEntry } from "@/domain/types";
import type { Overlay, OverlayEvent } from "@/domain/google-calendar";

export type { Overlay, OverlayEvent, OverlayUnavailable } from "@/domain/google-calendar";

/**
 * Google Calendar: publish the church's events, and show a leader their own.
 *
 * ## Publish
 *
 * Oikonomia stays the source of truth. Every schedule entry and every LifeGroup
 * gathering that is not cancelled is copied, as the church mailbox, into the
 * church calendar (`OIKONOMIA_GOOGLE_CALENDAR_ID`), so people can subscribe to
 * it in whatever calendar they already use. Changes flow one way: editing the
 * event in Google changes nothing here, and the next publish puts it back.
 *
 * Publishing happens **after** the leader's write has succeeded and never
 * holds it up. A Google failure is recorded against the record
 * (`calendar_publication.last_error`) for the administrator, who can retry
 * everything with "Publish all events".
 *
 * ## Overlay
 *
 * A leader's own primary Google Calendar, read as them, shown beside their
 * week. Read-only and never stored. Events Oikonomia published are left out, so
 * a church event a leader subscribed to does not appear twice.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Marks an event as Oikonomia's, so it can be recognised wherever it turns up. */
export const PUBLISHED_MARK = "oikonomiaSource";

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  recurrence?: string[];
  status: "confirmed";
  extendedProperties: { private: { oikonomiaSource: PublishedSource; oikonomiaId: string } };
}

export interface MappingContext {
  /** IANA zone the church's times are written in. */
  timeZone: string;
  /** Where a reader can open the record in Oikonomia. Absent when unknown. */
  siteUrl?: string;
  ministryName?: (id: string) => string | undefined;
  venueName?: (id: string) => string | undefined;
}

/* ------------------------------------------------------------ time maths */

const compact = (iso: string) => iso.replaceAll("-", "");

/** "19:30" → minutes after midnight. */
const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** A wall-clock date and time, possibly past midnight, as Google's local dateTime. */
function localDateTime(date: string, minutes: number): string {
  const day = toISO(addDays(fromISO(date), Math.floor(minutes / 1440)));
  const within = ((minutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(within / 60)).padStart(2, "0");
  const mm = String(within % 60).padStart(2, "0");
  return `${day}T${hh}:${mm}:00`;
}

/** How far `timeZone`'s clock is ahead of UTC at an instant, in milliseconds. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time in `timeZone`.
 *
 * Twice through, because the offset at the guess can differ from the offset at
 * the answer when a daylight-saving change lies between them.
 */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const naive = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, 0, minutes);
  let instant = naive - zoneOffset(naive, timeZone);
  instant = naive - zoneOffset(instant, timeZone);
  return new Date(instant);
}

const utcStamp = (instant: Date) =>
  instant
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll("-", "")
    .replaceAll(":", "");

/* --------------------------------------------------------------- mapping */

/** A timed entry is one with a start time that is not marked all day. */
const isTimed = (entry: { allDay?: boolean; startTime?: string }) =>
  !entry.allDay && !!entry.startTime;

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * The first day a rhythm actually lands on.
 *
 * Google counts the event's start as an occurrence whether or not it matches
 * the rule, so the start must be a real occurrence — which is not always
 * `from` (a weekly rhythm on Sundays that starts on a Wednesday). Asked of the
 * schedule's own rule, so the two cannot disagree about which day that is.
 */
function firstOccurrence(entry: ScheduleEntry): string | undefined {
  const recurrence = entry.recurrence!;
  const { skip: _skip, ...rule } = recurrence;
  const probe = { ...entry, recurrence: rule };
  let day = recurrence.from;
  /* A year and a bit holds the first occurrence of every frequency but a
     29 February; that one is given four. */
  for (let i = 0; i < 1500; i++) {
    if (recurrence.until && day > recurrence.until) return undefined;
    if (entryOccursOn(probe, day)) return day;
    day = toISO(addDays(fromISO(day), 1));
  }
  return undefined;
}

/**
 * RRULE and EXDATE lines for a repeating entry starting on `start`.
 *
 * Skipped occurrences — "this occurrence" deleted or lifted out as its own
 * entry — become EXDATEs, written in the same form as the start (a date for an
 * all-day event, a local time in the church's zone for a timed one), which is
 * what Google matches them against.
 */
export function recurrenceLines(entry: ScheduleEntry, start: string, timeZone: string): string[] {
  const recurrence = entry.recurrence!;
  const timed = isTimed(entry);
  const weekday = BYDAY[fromISO(start).getDay()]!;

  const parts = (() => {
    switch (recurrence.frequency) {
      case "daily":
        return ["FREQ=DAILY"];
      case "weekly":
        return ["FREQ=WEEKLY", `BYDAY=${weekday}`];
      case "fortnightly":
        return ["FREQ=WEEKLY", "INTERVAL=2", `BYDAY=${weekday}`];
      case "monthly":
        return ["FREQ=MONTHLY"];
      case "yearly":
        return ["FREQ=YEARLY"];
    }
  })();

  if (recurrence.until) {
    /* Inclusive of the last day: for a timed event, the moment it starts that
       day, in UTC as RFC 5545 requires once a zone is involved. */
    parts.push(
      timed
        ? `UNTIL=${utcStamp(zonedInstant(recurrence.until, minutesOf(entry.startTime!), timeZone))}`
        : `UNTIL=${compact(recurrence.until)}`,
    );
  }

  const lines = [`RRULE:${parts.join(";")}`];
  const skipped = [...new Set(recurrence.skip ?? [])].filter((day) => day >= start).sort();
  if (skipped.length > 0) {
    lines.push(
      timed
        ? `EXDATE;TZID=${timeZone}:${skipped
            .map((day) => `${compact(day)}T${entry.startTime!.replace(":", "")}00`)
            .join(",")}`
        : `EXDATE;VALUE=DATE:${skipped.map(compact).join(",")}`,
    );
  }
  return lines;
}

function times(
  on: string,
  item: { allDay?: boolean; startTime?: string; endTime?: string },
  timeZone: string,
): { start: GoogleEventTime; end: GoogleEventTime } {
  if (!isTimed(item)) {
    /* Google's all-day end is exclusive: the day after. */
    return { start: { date: on }, end: { date: toISO(addDays(fromISO(on), 1)) } };
  }
  const startMinutes = minutesOf(item.startTime!);
  let endMinutes = item.endTime ? minutesOf(item.endTime) : startMinutes + 60;
  /* An end before the start is read as past midnight, not as a mistake to
     publish backwards; no end at all is an hour, which is what a calendar
     would draw anyway. */
  if (endMinutes <= startMinutes) endMinutes = item.endTime ? endMinutes + 1440 : startMinutes + 60;
  return {
    start: { dateTime: localDateTime(on, startMinutes), timeZone },
    end: { dateTime: localDateTime(on, endMinutes), timeZone },
  };
}

const describe = (lines: (string | undefined)[]) => {
  const text = lines.filter((line): line is string => !!line?.trim()).join("\n\n");
  return text ? { description: text } : {};
};

/**
 * A schedule entry as a Google event, or undefined when it has no day left to
 * happen on (a rhythm whose every occurrence was removed).
 */
export function eventForEntry(
  entry: ScheduleEntry,
  context: MappingContext,
): GoogleEventBody | undefined {
  const on = entry.recurrence ? firstOccurrence(entry) : entry.date;
  if (!on) return undefined;

  const ministry = entry.ministryId ? context.ministryName?.(entry.ministryId) : undefined;
  return {
    summary: entry.title,
    ...describe([
      entry.note,
      ministry ? `Ministry: ${ministry}` : undefined,
      entry.meetingUrl ? `Join: ${entry.meetingUrl}` : undefined,
      context.siteUrl
        ? `Open in Oikonomia: ${context.siteUrl}/monthly-calendar?date=${on}`
        : undefined,
    ]),
    ...(entry.location?.trim() ? { location: entry.location.trim() } : {}),
    ...times(on, entry, context.timeZone),
    ...(entry.recurrence ? { recurrence: recurrenceLines(entry, on, context.timeZone) } : {}),
    status: "confirmed",
    extendedProperties: {
      private: { oikonomiaSource: "schedule-entry", oikonomiaId: entry.id },
    },
  };
}

/**
 * A LifeGroup gathering as a Google event, or undefined when it should not be
 * on the church calendar — a cancelled evening did not happen.
 *
 * The venue's **name** only. A home address is often restricted in Oikonomia,
 * and a church calendar is read by far more people than the roster is.
 */
export function eventForGathering(
  gathering: Gathering,
  context: MappingContext,
): GoogleEventBody | undefined {
  if (gathering.status === "cancelled") return undefined;
  const venue =
    (gathering.venueId ? context.venueName?.(gathering.venueId) : undefined) ??
    gathering.venueName?.trim();
  return {
    summary: venue ? `LifeGroup — ${venue}` : "LifeGroup",
    ...describe([
      context.siteUrl
        ? `Open in Oikonomia: ${context.siteUrl}/lifegroups/${gathering.id}`
        : undefined,
    ]),
    ...(venue ? { location: venue } : {}),
    ...times(gathering.date, gathering, context.timeZone),
    status: "confirmed",
    extendedProperties: {
      private: { oikonomiaSource: "gathering", oikonomiaId: gathering.id },
    },
  };
}

/* ------------------------------------------------------------- publisher */

/**
 * What the services tell publishing, after a write has succeeded.
 *
 * Synchronous and silent on purpose: a service cannot wait on Google or fail
 * because of it. Optional in every service, so an installation without
 * Workspace — and every test that is not about this — passes nothing.
 */
export interface CalendarPublisher {
  entrySaved(entry: ScheduleEntry): void;
  entryRemoved(id: string): void;
  /** A cancelled gathering is taken off the calendar. */
  gatheringSaved(gathering: Gathering): void;
}

export interface PublishAllResult {
  published: number;
  removed: number;
  failed: number;
}

export interface PublishingStatus {
  enabled: boolean;
  calendarId?: string;
  /** Records whose event in Google is current. */
  published: number;
  /** Records whose last attempt failed. */
  failing: number;
  lastSyncedAt?: string;
  lastError?: { message: string; at: string };
}

export interface PublisherParts {
  config: WorkspaceConfig & { calendarId: string };
  publications: CalendarPublicationRepository;
  /** Read at each publish, so a change to the site's timezone applies without a restart. */
  context: () => MappingContext;
}

export function createCalendarPublisher({ config, publications, context }: PublisherParts) {
  const calendarId = config.calendarId;
  const eventsUrl = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  const asChurch = { subject: config.appUser, scopes: [WORKSPACE_SCOPES.calendarEvents] };

  /*
   * One chain per record. Creating an entry and correcting its title a second
   * later must not race into two inserts; the second waits for the first and
   * then finds the event id it recorded.
   */
  const chains = new Map<string, Promise<void>>();
  const inFlight = new Set<Promise<void>>();

  function enqueue(key: string, work: () => Promise<void>): Promise<void> {
    const next = (chains.get(key) ?? Promise.resolve()).then(work, work);
    chains.set(key, next);
    inFlight.add(next);
    void next.finally(() => {
      inFlight.delete(next);
      if (chains.get(key) === next) chains.delete(key);
    });
    return next;
  }

  const reason = (error: unknown) =>
    error instanceof ApiError ? error.message : "Google Calendar could not be reached.";

  /** Put the event in Google as it now stands. Never throws. */
  async function upsert(
    type: PublishedSource,
    id: string,
    body: GoogleEventBody,
  ): Promise<boolean> {
    try {
      const known = publications.find(type, id);
      let eventId: string | undefined;
      if (known?.googleEventId && known.calendarId === calendarId) {
        try {
          const updated = await googleRequest<{ id: string }>(config, {
            ...asChurch,
            method: "PUT",
            url: `${eventsUrl}/${encodeURIComponent(known.googleEventId)}`,
            json: body,
          });
          eventId = updated?.id ?? known.googleEventId;
        } catch (error) {
          /* Deleted in Google by hand: publish it again rather than fail
             forever on an event that is gone. */
          if (!(error instanceof ApiError && error.code === "not-found")) throw error;
        }
      }
      if (!eventId) {
        const created = await googleRequest<{ id: string }>(config, {
          ...asChurch,
          method: "POST",
          url: eventsUrl,
          json: body,
        });
        eventId = created.id;
      }
      publications.synced(type, id, calendarId, eventId);
      return true;
    } catch (error) {
      publications.failed(type, id, calendarId, reason(error));
      return false;
    }
  }

  /** Take the event out of Google, if one was published. Never throws. */
  async function remove(type: PublishedSource, id: string): Promise<boolean> {
    const known = publications.find(type, id);
    if (!known) return true;
    try {
      if (known.googleEventId) {
        try {
          await googleRequest(config, {
            ...asChurch,
            method: "DELETE",
            url: `${CALENDAR_API}/calendars/${encodeURIComponent(known.calendarId)}/events/${encodeURIComponent(known.googleEventId)}`,
          });
        } catch (error) {
          /* Already gone is what was wanted. */
          if (!(error instanceof ApiError && error.code === "not-found")) throw error;
        }
      }
      publications.remove(type, id);
      return true;
    } catch (error) {
      publications.failed(type, id, known.calendarId, reason(error));
      return false;
    }
  }

  const syncEntry = (entry: ScheduleEntry) => {
    const body = eventForEntry(entry, context());
    return body ? upsert("schedule-entry", entry.id, body) : remove("schedule-entry", entry.id);
  };

  const syncGathering = (gathering: Gathering) => {
    const body = eventForGathering(gathering, context());
    return body ? upsert("gathering", gathering.id, body) : remove("gathering", gathering.id);
  };

  return {
    entrySaved(entry: ScheduleEntry) {
      void enqueue(`schedule-entry:${entry.id}`, async () => void (await syncEntry(entry)));
    },

    entryRemoved(id: string) {
      void enqueue(`schedule-entry:${id}`, async () => void (await remove("schedule-entry", id)));
    },

    gatheringSaved(gathering: Gathering) {
      void enqueue(`gathering:${gathering.id}`, async () => void (await syncGathering(gathering)));
    },

    /** Resolves once everything started so far has finished. For tests and backfill. */
    async settled(): Promise<void> {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },

    /**
     * Bring the church calendar in line with Oikonomia.
     *
     * Every record is published or updated through the id already recorded —
     * running it twice adds nothing — and anything published for a record that
     * no longer exists, or a gathering since cancelled, is removed. One at a
     * time: a church's calendar is small, and Google's quota is not.
     */
    async publishAll(records: {
      entries: ScheduleEntry[];
      gatherings: Gathering[];
    }): Promise<PublishAllResult> {
      await this.settled();
      const result: PublishAllResult = { published: 0, removed: 0, failed: 0 };
      const count = (ok: boolean, published: boolean) => {
        if (!ok) result.failed++;
        else if (published) result.published++;
        else result.removed++;
      };

      for (const entry of records.entries) {
        const publishes = !!eventForEntry(entry, context());
        const known = publications.find("schedule-entry", entry.id);
        if (!publishes && !known) continue;
        count(await syncEntry(entry), publishes);
      }
      for (const gathering of records.gatherings) {
        const publishes = gathering.status !== "cancelled";
        const known = publications.find("gathering", gathering.id);
        if (!publishes && !known) continue;
        count(await syncGathering(gathering), publishes);
      }

      const live = new Set([
        ...records.entries.map((e) => `schedule-entry:${e.id}`),
        ...records.gatherings.map((g) => `gathering:${g.id}`),
      ]);
      for (const orphan of publications.all()) {
        if (live.has(`${orphan.sourceType}:${orphan.sourceId}`)) continue;
        count(await remove(orphan.sourceType, orphan.sourceId), false);
      }
      return result;
    },

    status(): PublishingStatus {
      return publishingStatus(publications, calendarId);
    },
  };
}

export type RealCalendarPublisher = ReturnType<typeof createCalendarPublisher>;

/** What publishing has done, for the administrator. Reads bookkeeping only. */
export function publishingStatus(
  publications: CalendarPublicationRepository,
  calendarId: string | undefined,
): PublishingStatus {
  const rows = publications.all();
  const synced = rows.filter((row) => row.lastSyncedAt).map((row) => row.lastSyncedAt!);
  const failing = rows
    .filter((row) => row.lastError)
    .sort((a, b) => b.lastAttemptAt.localeCompare(a.lastAttemptAt));
  const latestFailure = failing[0];
  return {
    enabled: !!calendarId,
    ...(calendarId ? { calendarId } : {}),
    published: rows.filter((row) => row.googleEventId && !row.lastError).length,
    failing: failing.length,
    ...(synced.length > 0 ? { lastSyncedAt: synced.sort().at(-1)! } : {}),
    ...(latestFailure
      ? { lastError: { message: latestFailure.lastError!, at: latestFailure.lastAttemptAt } }
      : {}),
  };
}

/**
 * The publishing configuration, when there is one.
 *
 * Undefined without Workspace, without a church calendar, in a demonstration,
 * or when the configuration cannot be read — publishing is then simply off,
 * and nobody's write is affected.
 */
export function publishingConfig(): (WorkspaceConfig & { calendarId: string }) | undefined {
  try {
    const config = workspaceConfig();
    return config?.calendarId ? { ...config, calendarId: config.calendarId } : undefined;
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------------- overlay */

interface GoogleListedEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

/** The date and "HH:mm" an instant reads as in `timeZone`. */
function wallClockOf(dateTime: string, timeZone: string): { date: string; time: string } {
  const instant = new Date(dateTime);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${read("hour")}:${read("minute")}`,
  };
}

/**
 * Whether Oikonomia published this event.
 *
 * Only reachable when the leader's primary calendar holds a published event —
 * the church calendar *is* their primary, or they were invited to a copy. The
 * mark is what says so; the title could belong to anything.
 */
function publishedByOikonomia(event: GoogleListedEvent): boolean {
  return !!(
    event.extendedProperties?.private?.[PUBLISHED_MARK] ??
    event.extendedProperties?.shared?.[PUBLISHED_MARK]
  );
}

export function overlayEvent(event: GoogleListedEvent, timeZone: string): OverlayEvent | undefined {
  if (event.status === "cancelled" || publishedByOikonomia(event)) return undefined;
  const title = event.summary?.trim() || "Busy";
  const common = {
    id: event.id,
    title,
    ...(event.location?.trim() ? { location: event.location.trim() } : {}),
    /* Drawn as a link, so only ever an https address. */
    ...(event.htmlLink?.startsWith("https://") ? { htmlLink: event.htmlLink } : {}),
  };

  if (event.start?.date) {
    /* Exclusive end, as Google writes it. */
    const last = event.end?.date ? toISO(addDays(fromISO(event.end.date), -1)) : event.start.date;
    return {
      ...common,
      date: event.start.date,
      allDay: true,
      ...(last > event.start.date ? { endDate: last } : {}),
    };
  }
  if (!event.start?.dateTime) return undefined;
  const start = wallClockOf(event.start.dateTime, timeZone);
  const end = event.end?.dateTime ? wallClockOf(event.end.dateTime, timeZone) : undefined;
  return {
    ...common,
    date: start.date,
    allDay: false,
    startTime: start.time,
    ...(end ? { endTime: end.time } : {}),
  };
}

/**
 * A leader's own primary calendar between two dates (inclusive), read as them.
 *
 * Only the leader's own address, and only in the church's domain: `mayActAs`
 * is asked here as well as before every token, so an outside address is
 * answered with a reason rather than a refusal the week would show as an
 * error. Google's refusal is answered the same way — the week is still the
 * week without it.
 */
export async function readOverlay(
  config: WorkspaceConfig | undefined,
  email: string | undefined,
  range: { from: string; to: string },
  timeZone: string,
): Promise<Overlay> {
  if (!config) return { events: [], unavailable: "not-configured" };
  if (!mayActAs(config, email)) return { events: [], unavailable: "no-workspace-email" };

  const timeMin = zonedInstant(range.from, 0, timeZone).toISOString();
  const timeMax = zonedInstant(toISO(addDays(fromISO(range.to), 1)), 0, timeZone).toISOString();

  const events: OverlayEvent[] = [];
  let pageToken: string | undefined;
  try {
    /* A week or a month of one person's calendar; five pages is far past it. */
    for (let page = 0; page < 5; page++) {
      const query = new URLSearchParams({
        singleEvents: "true",
        orderBy: "startTime",
        timeMin,
        timeMax,
        timeZone,
        maxResults: "250",
        fields:
          "nextPageToken,items(id,status,summary,location,htmlLink,start,end,extendedProperties)",
        ...(pageToken ? { pageToken } : {}),
      });
      const reply = await googleRequest<{ items?: GoogleListedEvent[]; nextPageToken?: string }>(
        config,
        {
          subject: email,
          scopes: [WORKSPACE_SCOPES.calendarRead],
          url: `${CALENDAR_API}/calendars/primary/events?${query.toString()}`,
        },
      );
      for (const item of reply?.items ?? []) {
        const event = overlayEvent(item, timeZone);
        if (event) events.push(event);
      }
      pageToken = reply?.nextPageToken;
      if (!pageToken) break;
    }
  } catch (error) {
    if (error instanceof ApiError) return { events: [], unavailable: "google-refused" };
    throw error;
  }
  return { events };
}
