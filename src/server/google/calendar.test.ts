import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/connection";
import { createCalendarPublicationRepository } from "../repositories/calendar-publication-repository";
import { createCalendarRepository } from "../repositories/calendar-repository";
import { createLifegroupRepository } from "../repositories/lifegroup-repository";
import { createCalendarService } from "../services/calendar-service";
import { createGoogleCalendarService } from "../services/google-calendar-service";
import { createLifegroupService } from "../services/lifegroup-service";
import {
  createCalendarPublisher,
  eventForEntry,
  eventForGathering,
  overlayEvent,
  readOverlay,
  type MappingContext,
} from "./calendar";
import { useGoogleTransport, workspaceConfig } from "./workspace";
import { entryOccursOn } from "@/domain/schedule";
import type { Gathering, ScheduleEntry } from "@/domain/types";
import { seedOrganization } from "@/test/seeds/seed-organization";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Publishing to Google Calendar and reading a leader's own, without Google.
 *
 * The transport is replaced, so these prove what Oikonomia sends and when —
 * the event shapes, the ids it keeps, the refusals — not that a real Workspace
 * accepts them.
 */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const env = {
  OIKONOMIA_GOOGLE_SA_KEY: JSON.stringify({
    client_email: "oik@proj.iam.gserviceaccount.com",
    private_key: pem,
  }),
  OIKONOMIA_GOOGLE_DOMAIN: "stjohns.org",
  OIKONOMIA_GOOGLE_APP_USER: "office@stjohns.org",
  OIKONOMIA_GOOGLE_CALENDAR_ID: "church@group.calendar.google.com",
};

const TZ = "America/Toronto";
const context: MappingContext = { timeZone: TZ, siteUrl: "https://binder.stjohns.org" };

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

let calls: Call[];
let saved: NodeJS.ProcessEnv;
let failEvents: boolean;
let listed: unknown[];
let nextId: number;

beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, env);
  delete process.env["OIKONOMIA_DEMO_MODE"];
  calls = [];
  failEvents = false;
  listed = [];
  nextId = 0;
  useGoogleTransport(async (url, init) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    const method = init.method ?? "GET";
    calls.push({
      method,
      url,
      ...(typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}),
    });
    if (failEvents) return new Response("backend error", { status: 503 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (method === "POST") return new Response(JSON.stringify({ id: `evt-${++nextId}` }));
    if (method === "PUT") {
      const id = decodeURIComponent(url.split("/events/")[1]!);
      return new Response(JSON.stringify({ id }));
    }
    return new Response(JSON.stringify({ items: listed }));
  });
});

afterEach(() => {
  process.env = saved;
});

const entry = (over: Partial<ScheduleEntry>): ScheduleEntry => ({
  id: "ev-1",
  title: "Ministry meeting",
  category: "ministry-meeting",
  ...over,
});

/* ------------------------------------------------------------- mapping */

describe("an entry as a Google event", () => {
  it("publishes an all-day entry with Google's exclusive end date", () => {
    const event = eventForEntry(entry({ date: "2026-09-10", allDay: true }), context)!;
    expect(event.start).toEqual({ date: "2026-09-10" });
    expect(event.end).toEqual({ date: "2026-09-11" });
  });

  it("treats an entry with no clock time as all day", () => {
    expect(eventForEntry(entry({ date: "2026-09-10" }), context)!.start).toEqual({
      date: "2026-09-10",
    });
  });

  it("publishes a timed entry as wall-clock time in the church's zone", () => {
    const event = eventForEntry(
      entry({ date: "2026-09-10", startTime: "19:30", endTime: "21:00", location: "Room 2" }),
      context,
    )!;
    expect(event.start).toEqual({ dateTime: "2026-09-10T19:30:00", timeZone: TZ });
    expect(event.end).toEqual({ dateTime: "2026-09-10T21:00:00", timeZone: TZ });
    expect(event.location).toBe("Room 2");
  });

  it("gives an entry with no end an hour, and one ending past midnight the next day", () => {
    expect(eventForEntry(entry({ date: "2026-09-10", startTime: "19:30" }), context)!.end).toEqual({
      dateTime: "2026-09-10T20:30:00",
      timeZone: TZ,
    });
    expect(
      eventForEntry(entry({ date: "2026-09-10", startTime: "23:00", endTime: "01:00" }), context)!
        .end,
    ).toEqual({ dateTime: "2026-09-11T01:00:00", timeZone: TZ });
  });

  it("marks the event as Oikonomia's and links back to it", () => {
    const event = eventForEntry(entry({ date: "2026-09-10", note: "Bring the budget." }), context)!;
    expect(event.extendedProperties.private).toEqual({
      oikonomiaSource: "schedule-entry",
      oikonomiaId: "ev-1",
    });
    expect(event.description).toContain("Bring the budget.");
    expect(event.description).toContain(
      "https://binder.stjohns.org/monthly-calendar?date=2026-09-10",
    );
  });

  it.each([
    ["daily", undefined, "RRULE:FREQ=DAILY"],
    ["weekly", 3, "RRULE:FREQ=WEEKLY;BYDAY=WE"],
    ["fortnightly", 3, "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"],
    ["monthly", undefined, "RRULE:FREQ=MONTHLY"],
    ["yearly", undefined, "RRULE:FREQ=YEARLY"],
  ] as const)("writes a %s rhythm as %s", (frequency, weekday, rule) => {
    const event = eventForEntry(
      entry({
        allDay: true,
        recurrence: {
          frequency,
          from: "2026-09-02",
          ...(weekday !== undefined ? { weekday } : {}),
        },
      }),
      context,
    )!;
    expect(event.recurrence).toEqual([rule]);
    expect(event.start).toEqual({ date: "2026-09-02" });
  });

  it("starts a rhythm on its first real occurrence, as the schedule reads it", () => {
    /* From a Wednesday, every other Sunday: the schedule's own rule decides
       which Sunday is first, and Google must start there. */
    const rhythm = entry({
      allDay: true,
      recurrence: { frequency: "fortnightly", weekday: 0, from: "2026-09-02" },
    });
    const event = eventForEntry(rhythm, context)!;
    expect(entryOccursOn(rhythm, event.start.date!)).toBe(true);
    expect(event.recurrence![0]).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU");
  });

  it("ends a rhythm with UNTIL: a date when all day, the last start in UTC when timed", () => {
    const allDay = eventForEntry(
      entry({
        allDay: true,
        recurrence: { frequency: "weekly", from: "2026-09-02", until: "2026-12-30" },
      }),
      context,
    )!;
    expect(allDay.recurrence![0]).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261230");

    const timed = eventForEntry(
      entry({
        startTime: "19:30",
        recurrence: { frequency: "weekly", from: "2026-09-02", until: "2026-12-30" },
      }),
      context,
    )!;
    /* 19:30 in Toronto in December is 00:30 the next day in UTC. */
    expect(timed.recurrence![0]).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T003000Z");
  });

  it("writes skipped occurrences as EXDATEs in the same form as the start", () => {
    const skip = ["2026-09-16", "2026-09-09"];
    const allDay = eventForEntry(
      entry({ allDay: true, recurrence: { frequency: "weekly", from: "2026-09-02", skip } }),
      context,
    )!;
    expect(allDay.recurrence![1]).toBe("EXDATE;VALUE=DATE:20260909,20260916");

    const timed = eventForEntry(
      entry({ startTime: "19:30", recurrence: { frequency: "weekly", from: "2026-09-02", skip } }),
      context,
    )!;
    expect(timed.recurrence![1]).toBe(`EXDATE;TZID=${TZ}:20260909T193000,20260916T193000`);
  });

  it("has nothing to publish for a rhythm that ended before it began", () => {
    expect(
      eventForEntry(
        entry({ recurrence: { frequency: "weekly", from: "2026-09-02", until: "2026-09-01" } }),
        context,
      ),
    ).toBeUndefined();
  });
});

describe("a gathering as a Google event", () => {
  const gathering = (over: Partial<Gathering> = {}): Gathering => ({
    id: "gth-1",
    date: "2026-09-17",
    startTime: "19:00",
    venueId: "ven-1",
    assignedLeaderIds: [],
    status: "planned",
    ...over,
  });

  it("names the venue, never its address, and marks it", () => {
    const event = eventForGathering(gathering(), { ...context, venueName: () => "Baronia home" })!;
    expect(event.summary).toBe("LifeGroup — Baronia home");
    expect(event.location).toBe("Baronia home");
    expect(event.start).toEqual({ dateTime: "2026-09-17T19:00:00", timeZone: TZ });
    expect(event.extendedProperties.private).toEqual({
      oikonomiaSource: "gathering",
      oikonomiaId: "gth-1",
    });
  });

  it("is not on the calendar once cancelled", () => {
    expect(eventForGathering(gathering({ status: "cancelled" }), context)).toBeUndefined();
  });
});

/* ----------------------------------------------------------- publishing */

describe("publishing as records change", () => {
  let dir: string;
  let db: Db;
  let publisher: ReturnType<typeof createCalendarPublisher>;
  const maria = viewerFor("leader");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oikonomia-gcal-"));
    db = openDatabase(join(dir, "test.db"));
    seedOrganization(db);
    const config = workspaceConfig()!;
    publisher = createCalendarPublisher({
      config: { ...config, calendarId: config.calendarId! },
      publications: createCalendarPublicationRepository(db),
      context: () => context,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const calendar = () =>
    createCalendarService(createCalendarRepository(db), undefined, undefined, publisher);
  const publications = () => createCalendarPublicationRepository(db);

  it("inserts on create as the church mailbox, then updates the same event, then deletes it", async () => {
    const service = calendar();
    const created = service.createEntry(maria, {
      title: "Ministry meeting",
      date: "2026-09-10",
      startTime: "19:30",
      category: "ministry-meeting",
    });
    await publisher.settled();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toContain(encodeURIComponent("church@group.calendar.google.com"));
    expect(publications().find("schedule-entry", created.id)?.googleEventId).toBe("evt-1");

    service.updateEntry(maria, created.id, { title: "Ministry meeting (moved)" });
    await publisher.settled();
    expect(calls[1]).toMatchObject({ method: "PUT" });
    expect(calls[1]!.url).toContain("/events/evt-1");
    expect(calls[1]!.body?.["summary"]).toBe("Ministry meeting (moved)");

    service.deleteEntry(maria, created.id);
    await publisher.settled();
    expect(calls[2]).toMatchObject({ method: "DELETE" });
    expect(calls[2]!.url).toContain("/events/evt-1");
    expect(publications().find("schedule-entry", created.id)).toBeUndefined();
  });

  it("does not race a quick correction into a second event", async () => {
    const service = calendar();
    const created = service.createEntry(maria, { title: "Call", date: "2026-09-10" });
    service.updateEntry(maria, created.id, { title: "Call Joel" });
    await publisher.settled();
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT"]);
  });

  it("lifts one occurrence out: the series gains an EXDATE and the day becomes its own event", async () => {
    const service = calendar();
    const series = service.createEntry(maria, {
      title: "Prayer & Fasting",
      recurrence: { frequency: "weekly", weekday: 3, from: "2026-09-02" },
      allDay: true,
      category: "prayer-fasting",
    });
    await publisher.settled();

    service.updateEntry(
      maria,
      series.id,
      { title: "Prayer & Fasting (church)" },
      "2026-09-09",
      "occurrence",
    );
    await publisher.settled();

    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body?.["recurrence"]).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
      "EXDATE;VALUE=DATE:20260909",
    ]);
    const inserted = calls.filter((c) => c.method === "POST");
    expect(inserted).toHaveLength(2);
    expect(inserted[1]!.body?.["start"]).toEqual({ date: "2026-09-09" });
  });

  it("removes a cancelled gathering and publishes it again when restored", async () => {
    const service = createLifegroupService(createLifegroupRepository(db), publisher);
    const gathering = service.createGathering(maria, {
      date: "2026-09-17",
      venueId: "ven-baronia",
      assignedLeaderIds: [maria.person.id],
    });
    await publisher.settled();
    expect(calls.map((c) => c.method)).toEqual(["POST"]);

    service.cancelGathering(maria, gathering.id);
    await publisher.settled();
    expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
    expect(publications().find("gathering", gathering.id)).toBeUndefined();

    service.restoreGathering(maria, gathering.id);
    await publisher.settled();
    expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE", "POST"]);
  });

  it("records Google's failure without failing the leader's write", async () => {
    failEvents = true;
    const service = calendar();
    const created = service.createEntry(maria, { title: "Camp call", date: "2026-09-11" });
    expect(createCalendarRepository(db).findEntry(created.id)?.title).toBe("Camp call");

    await publisher.settled();
    const row = publications().find("schedule-entry", created.id)!;
    expect(row.googleEventId).toBeUndefined();
    expect(row.lastError).toMatch(/Google/);
    expect(publisher.status()).toMatchObject({ published: 0, failing: 1 });
  });

  it("publishes everything once, updates rather than duplicates on a second run, and removes orphans", async () => {
    /* Written without a publisher, as an import would. */
    const quiet = createCalendarService(createCalendarRepository(db));
    const a = quiet.createEntry(maria, { title: "A", date: "2026-09-10" });
    quiet.createEntry(maria, { title: "B", date: "2026-09-11" });
    const records = () => ({
      entries: createCalendarRepository(db).allEntries(),
      gatherings: createLifegroupRepository(db).allGatherings(),
    });

    expect(await publisher.publishAll(records())).toEqual({ published: 2, removed: 0, failed: 0 });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);

    calls = [];
    expect(await publisher.publishAll(records())).toEqual({ published: 2, removed: 0, failed: 0 });
    expect(calls.map((c) => c.method)).toEqual(["PUT", "PUT"]);

    calls = [];
    createCalendarRepository(db).deleteEntry(a.id);
    expect(await publisher.publishAll(records())).toEqual({ published: 1, removed: 1, failed: 0 });
    expect(calls.map((c) => c.method).sort()).toEqual(["DELETE", "PUT"]);
    expect(publisher.status()).toMatchObject({ published: 1, failing: 0 });
  });

  it("publishes again when the event was deleted in Google by hand", async () => {
    const service = calendar();
    const created = service.createEntry(maria, { title: "A", date: "2026-09-10" });
    await publisher.settled();

    useGoogleTransport(async (url, init) => {
      if (url.includes("/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      }
      calls.push({ method: init.method ?? "GET", url });
      if (init.method === "PUT") return new Response("gone", { status: 410 });
      return new Response(JSON.stringify({ id: "evt-new" }));
    });
    service.updateEntry(maria, created.id, { title: "A again" });
    await publisher.settled();
    expect(publications().find("schedule-entry", created.id)?.googleEventId).toBe("evt-new");
  });
});

/* ---------------------------------------------------------------- overlay */

describe("a leader's own calendar on their week", () => {
  const config = () => workspaceConfig()!;
  const range = { from: "2026-09-14", to: "2026-09-20" };

  it("reads the leader's primary calendar as them, in the church's zone, one event per occurrence", async () => {
    listed = [
      {
        id: "g1",
        summary: "Dentist",
        start: { dateTime: "2026-09-15T14:00:00-04:00" },
        end: { dateTime: "2026-09-15T15:00:00-04:00" },
        htmlLink: "https://calendar.google.com/event?eid=g1",
      },
    ];
    const overlay = await readOverlay(config(), "maria@stjohns.org", range, TZ);
    expect(overlay).toEqual({
      events: [
        {
          id: "g1",
          title: "Dentist",
          date: "2026-09-15",
          allDay: false,
          startTime: "14:00",
          endTime: "15:00",
          htmlLink: "https://calendar.google.com/event?eid=g1",
        },
      ],
    });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toContain("/calendars/primary/events");
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("orderBy")).toBe("startTime");
    /* Midnight on Monday in Toronto, not in UTC. */
    expect(url.searchParams.get("timeMin")).toBe("2026-09-14T04:00:00.000Z");
    expect(url.searchParams.get("timeMax")).toBe("2026-09-21T04:00:00.000Z");
  });

  it("leaves out what Oikonomia published, so nothing appears twice", async () => {
    listed = [
      {
        id: "g2",
        summary: "Ministry meeting",
        start: { date: "2026-09-16" },
        end: { date: "2026-09-17" },
        extendedProperties: { private: { oikonomiaSource: "schedule-entry", oikonomiaId: "ev-1" } },
      },
      { id: "g3", summary: "Day off", start: { date: "2026-09-18" }, end: { date: "2026-09-20" } },
    ];
    const overlay = await readOverlay(config(), "maria@stjohns.org", range, TZ);
    expect(overlay.events).toEqual([
      { id: "g3", title: "Day off", date: "2026-09-18", allDay: true, endDate: "2026-09-19" },
    ]);
  });

  it("refuses an address outside the church's domain without asking Google", async () => {
    expect(await readOverlay(config(), "maria@gmail.com", range, TZ)).toEqual({
      events: [],
      unavailable: "no-workspace-email",
    });
    expect(await readOverlay(config(), undefined, range, TZ)).toMatchObject({
      unavailable: "no-workspace-email",
    });
    expect(calls).toEqual([]);
  });

  it("says Workspace is not set up, and that Google refused, rather than failing the week", async () => {
    expect(await readOverlay(undefined, "maria@stjohns.org", range, TZ)).toEqual({
      events: [],
      unavailable: "not-configured",
    });
    failEvents = true;
    expect(await readOverlay(config(), "maria@stjohns.org", range, TZ)).toEqual({
      events: [],
      unavailable: "google-refused",
    });
  });

  it("drops cancelled occurrences", () => {
    expect(
      overlayEvent({ id: "x", status: "cancelled", start: { date: "2026-09-18" } }, TZ),
    ).toBeUndefined();
  });
});

/* --------------------------------------------------------- who may do it */

describe("who may publish, and whose calendar is read", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oikonomia-gcal-service-"));
    db = openDatabase(join(dir, "test.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const service = (withPublisher = true) => {
    const config = workspaceConfig()!;
    const publisher = createCalendarPublisher({
      config: { ...config, calendarId: config.calendarId! },
      publications: createCalendarPublicationRepository(db),
      context: () => context,
    });
    return createGoogleCalendarService({
      ...(withPublisher ? { publisher, calendarId: config.calendarId! } : {}),
      publications: createCalendarPublicationRepository(db),
      records: { entries: () => [], gatherings: () => [] },
      workspace: () => config,
      emailOf: (personId) => (personId === "p-maria" ? "maria@stjohns.org" : "joel@gmail.com"),
      timeZone: () => TZ,
    });
  };

  it("lets only an administrator see publishing or publish everything", async () => {
    const leader = viewerFor("leader");
    expect(() => service().publishingStatus(leader)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    await expect(service().publishAll(viewerFor("bishop"))).rejects.toMatchObject({
      code: "forbidden",
    });

    const admin = viewerFor("admin");
    expect(service().publishingStatus(admin)).toMatchObject({ enabled: true, published: 0 });
    await expect(service().publishAll(admin)).resolves.toMatchObject({
      lastRun: { published: 0, removed: 0, failed: 0 },
    });
  });

  it("says there is no church calendar rather than pretending to publish", async () => {
    await expect(service(false).publishAll(viewerFor("admin"))).rejects.toMatchObject({
      code: "conflict",
    });
    expect(service(false).publishingStatus(viewerFor("admin")).enabled).toBe(false);
  });

  it("reads only the viewer's own address, and refuses one outside the domain", async () => {
    await service().overlay(viewerFor("leader"), { from: "2026-09-14", to: "2026-09-20" });
    expect(calls).toHaveLength(1);

    calls = [];
    expect(
      await service().overlay(viewerFor("ministry-head"), { from: "2026-09-14", to: "2026-09-20" }),
    ).toEqual({ events: [], unavailable: "no-workspace-email" });
    expect(calls).toEqual([]);
  });

  it("refuses a range longer than a month grid", async () => {
    await expect(
      service().overlay(viewerFor("leader"), { from: "2026-01-01", to: "2026-12-31" }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
