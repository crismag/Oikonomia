import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createCalendarRepository } from "../repositories/calendar-repository";
import { createCalendarService } from "./calendar-service";
import { occurrencesOn } from "@/domain/schedule";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Calendar persistence and rules.
 *
 * Against a real SQLite database rather than a mock, because the things most
 * likely to be wrong are the ones a mock cannot have: the CHECK constraints,
 * the NULL-versus-absent translation, and whether a weekly rhythm survives a
 * round trip through columns.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createCalendarService>;
let repo: ReturnType<typeof createCalendarRepository>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-calendar-"));
  db = openDatabase(join(dir, "test.db"));
  repo = createCalendarRepository(db);
  service = createCalendarService(repo);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const oneOff = (over: Record<string, unknown> = {}) => ({
  title: "Ministry meeting",
  date: "2026-09-10",
  startTime: "19:30",
  category: "ministry-meeting",
  ...over,
});

const weekly = (over: Record<string, unknown> = {}) => ({
  title: "Prayer & Fasting",
  recurrence: { frequency: "weekly", weekday: 3, from: "2026-09-02" },
  allDay: true,
  category: "prayer-fasting",
  ...over,
});

describe("creating an entry", () => {
  it("persists it and gives it an id", () => {
    const entry = service.createEntry(maria, oneOff());
    expect(entry.id).toMatch(/^ev-/);
    expect(repo.findEntry(entry.id)?.title).toBe("Ministry meeting");
  });

  it("records who created it", () => {
    expect(service.createEntry(maria, oneOff()).createdBy).toBe(maria.person.id);
  });

  it("defaults provenance to the leader's own", () => {
    expect(service.createEntry(maria, oneOff()).source).toBe("leader");
  });

  /** A title and a day are the whole requirement. */
  it("accepts an entry with nothing but a title and a date", () => {
    const entry = service.createEntry(maria, { title: "Camp call", date: "2026-09-11" });
    expect(entry.title).toBe("Camp call");
    expect(entry.category).toBe("other");
  });

  it("refuses one with no title", () => {
    expect(() => service.createEntry(maria, oneOff({ title: "  " }))).toThrow(ApiError);
  });

  it("refuses one that is neither dated nor repeating", () => {
    try {
      service.createEntry(maria, { title: "Floating" });
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).fields?.["date"]).toMatch(/either on a date or repeats/);
    }
  });

  it("refuses one that is both", () => {
    expect(() => service.createEntry(maria, weekly({ date: "2026-09-10" }))).toThrow(ApiError);
  });

  it("refuses an end time before its start", () => {
    try {
      service.createEntry(maria, oneOff({ startTime: "19:30", endTime: "18:00" }));
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).fields?.["endTime"]).toBe("The end time is before the start.");
    }
  });

  it("refuses an all-day entry that also claims a start time", () => {
    expect(() => service.createEntry(maria, oneOff({ allDay: true }))).toThrow(ApiError);
  });
});

describe("a record survives the round trip", () => {
  it("keeps a weekly rhythm intact", () => {
    const created = service.createEntry(maria, weekly());
    const loaded = repo.findEntry(created.id)!;
    expect(loaded.recurrence).toEqual({ frequency: "weekly", weekday: 3, from: "2026-09-02" });
    expect(loaded.allDay).toBe(true);
    expect(loaded.date).toBeUndefined();
  });

  it("keeps lists whole", () => {
    const created = service.createEntry(
      maria,
      oneOff({
        tags: ["camp", "transport"],
        participantIds: ["p-joel", "p-esther"],
        reminders: ["1h"],
        related: [{ kind: "ministry", id: "min-music" }],
      }),
    );
    const loaded = repo.findEntry(created.id)!;
    expect(loaded.tags).toEqual(["camp", "transport"]);
    expect(loaded.participantIds).toEqual(["p-joel", "p-esther"]);
    expect(loaded.related).toEqual([{ kind: "ministry", id: "min-music" }]);
  });

  /**
   * NULL is *absent*, not `undefined`-valued. The distinction is load-bearing
   * under `exactOptionalPropertyTypes`, and only absence round-trips.
   */
  it("omits a field it does not have rather than carrying an undefined one", () => {
    const created = service.createEntry(maria, { title: "Bare", date: "2026-09-10" });
    const loaded = repo.findEntry(created.id)!;
    expect("location" in loaded).toBe(false);
    expect("recurrence" in loaded).toBe(false);
    expect("tags" in loaded).toBe(false);
  });
});

describe("reading a range", () => {
  it("returns one-offs that fall inside it", () => {
    service.createEntry(maria, oneOff({ date: "2026-09-10" }));
    service.createEntry(maria, oneOff({ title: "Later", date: "2026-10-20" }));

    const { entries } = service.listRange(maria, { from: "2026-09-01", to: "2026-09-30" });
    expect(entries.map((e) => e.title)).toEqual(["Ministry meeting"]);
  });

  /* Ministry and church events are shared the moment they are made: nobody
     has to share them, and nobody but their creator is needed to see them. */
  it("shows an event to everybody as soon as it is created", () => {
    service.createEntry(maria, oneOff());
    const { entries } = service.listRange(joel, { from: "2026-09-01", to: "2026-09-30" });
    expect(entries.map((e) => e.title)).toEqual(["Ministry meeting"]);
  });

  /** A rhythm that began before the range still lands inside it. */
  it("returns a rhythm whose occurrences reach the range", () => {
    service.createEntry(
      maria,
      weekly({ recurrence: { frequency: "weekly", weekday: 3, from: "2026-01-07" } }),
    );

    const { entries } = service.listRange(maria, { from: "2026-09-01", to: "2026-09-30" });
    expect(entries).toHaveLength(1);
    expect(occurrencesOn(entries, "2026-09-09")).toHaveLength(1);
  });

  it("leaves out a rhythm that ended before the range", () => {
    service.createEntry(
      maria,
      weekly({
        recurrence: { frequency: "weekly", weekday: 3, from: "2026-01-07", until: "2026-03-01" },
      }),
    );
    const { entries } = service.listRange(maria, { from: "2026-09-01", to: "2026-09-30" });
    expect(entries).toEqual([]);
  });

  it("refuses a range that ends before it starts", () => {
    expect(() => service.listRange(maria, { from: "2026-09-30", to: "2026-09-01" })).toThrow(
      ApiError,
    );
  });
});

describe("editing", () => {
  it("changes a one-off", () => {
    const entry = service.createEntry(maria, oneOff());
    const updated = service.updateEntry(maria, entry.id, { title: "Moved meeting" });
    expect(updated.title).toBe("Moved meeting");
    expect(repo.findEntry(entry.id)?.title).toBe("Moved meeting");
  });

  it("leaves untouched fields alone", () => {
    const entry = service.createEntry(maria, oneOff({ location: "SC Church" }));
    const updated = service.updateEntry(maria, entry.id, { title: "Renamed" });
    expect(updated.location).toBe("SC Church");
    expect(updated.startTime).toBe("19:30");
  });

  it("applies the rules between fields to the merged result, not the patch", () => {
    const entry = service.createEntry(maria, oneOff({ startTime: "19:30", endTime: "21:00" }));
    /* The patch alone looks fine; against the stored start time it does not. */
    expect(() => service.updateEntry(maria, entry.id, { endTime: "18:00" })).toThrow(ApiError);
  });

  it("refuses to edit an entry that does not exist", () => {
    expect(() => service.updateEntry(maria, "ev-nope", { title: "x" })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  /** Church-wide rhythms are not one leader's to change. */
  it("refuses to edit a church-wide entry", () => {
    const entry = service.createEntry(maria, oneOff({ source: "church" }));
    try {
      service.updateEntry(joel, entry.id, { title: "Hijacked" });
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).code).toBe("forbidden");
    }
    expect(repo.findEntry(entry.id)?.title).toBe("Ministry meeting");
  });

  it("does not let an unrelated leader edit someone's entry", () => {
    const entry = service.createEntry(maria, oneOff());
    expect(() => service.updateEntry(joel, entry.id, { title: "Hijacked" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
});

describe("editing one occurrence of a rhythm", () => {
  it("lifts that day out and leaves the other weeks alone", () => {
    const series = service.createEntry(maria, weekly());

    const detached = service.updateEntry(
      maria,
      series.id,
      { title: "Prayer & Fasting — at the church" },
      "2026-09-09",
      "occurrence",
    );

    expect(detached.id).not.toBe(series.id);
    expect(detached.date).toBe("2026-09-09");
    expect(detached.recurrence).toBeUndefined();

    const stillWeekly = repo.findEntry(series.id)!;
    expect(stillWeekly.recurrence?.skip).toContain("2026-09-09");
    /* The week before is untouched. */
    expect(occurrencesOn([stillWeekly], "2026-09-02")).toHaveLength(1);
    expect(occurrencesOn([stillWeekly], "2026-09-09")).toHaveLength(0);
  });

  it("ends the old rhythm and starts a new one for this and following", () => {
    const series = service.createEntry(maria, weekly());

    const continued = service.updateEntry(
      maria,
      series.id,
      { title: "Prayer & Fasting (new time)" },
      "2026-09-16",
      "following",
    );

    expect(continued.recurrence?.from).toBe("2026-09-16");
    const original = repo.findEntry(series.id)!;
    expect(occurrencesOn([original], "2026-09-09")).toHaveLength(1);
    expect(occurrencesOn([original], "2026-09-16")).toHaveLength(0);
  });

  it("asks which occurrence when the scope needs one", () => {
    const series = service.createEntry(maria, weekly());
    expect(() =>
      service.updateEntry(maria, series.id, { title: "x" }, undefined, "occurrence"),
    ).toThrow(ApiError);
  });

  it("ends the rhythm when a repeating entry is given a fixed date", () => {
    const series = service.createEntry(maria, weekly());
    const moved = service.updateEntry(maria, series.id, { date: "2026-09-30" });
    expect(moved.date).toBe("2026-09-30");
    expect(moved.recurrence).toBeUndefined();
  });
});

describe("deleting", () => {
  it("removes a one-off", () => {
    const entry = service.createEntry(maria, oneOff());
    service.deleteEntry(maria, entry.id);
    expect(repo.findEntry(entry.id)).toBeUndefined();
  });

  it("records a skip rather than deleting the series for one occurrence", () => {
    const series = service.createEntry(maria, weekly());
    service.deleteEntry(maria, series.id, "2026-09-09", "occurrence");

    const still = repo.findEntry(series.id)!;
    expect(still).toBeDefined();
    expect(occurrencesOn([still], "2026-09-09")).toHaveLength(0);
    expect(occurrencesOn([still], "2026-09-16")).toHaveLength(1);
  });

  it("ends the rhythm the day before for this and following", () => {
    const series = service.createEntry(maria, weekly());
    service.deleteEntry(maria, series.id, "2026-09-16", "following");

    const still = repo.findEntry(series.id)!;
    expect(occurrencesOn([still], "2026-09-09")).toHaveLength(1);
    expect(occurrencesOn([still], "2026-09-16")).toHaveLength(0);
  });

  /** A rhythm ended before it ever ran leaves nothing behind. */
  it("removes a rhythm cancelled from its first occurrence", () => {
    const series = service.createEntry(maria, weekly());
    service.deleteEntry(maria, series.id, "2026-09-02", "following");
    expect(repo.findEntry(series.id)).toBeUndefined();
  });

  it("refuses to delete someone else's entry", () => {
    const entry = service.createEntry(maria, oneOff());
    expect(() => service.deleteEntry(joel, entry.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(repo.findEntry(entry.id)).toBeDefined();
  });

  it("says not-found for an entry that never existed", () => {
    expect(() => service.deleteEntry(maria, "ev-nope")).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});

describe("agenda items", () => {
  it("files one on a day", () => {
    const item = service.createAgendaItem(maria, {
      text: "Ring the camp office",
      date: "2026-09-10",
    });
    expect(item.completed).toBe(false);
    expect(repo.findAgendaItem(item.id)?.text).toBe("Ring the camp office");
  });

  /** The binder's NOTES area: the week, with no particular day. */
  it("files one on the week with no day", () => {
    const item = service.createAgendaItem(maria, {
      text: "Think about the rota",
      weekOf: "2026-09-07",
    });
    expect(item.weekOf).toBe("2026-09-07");
    expect(item.date).toBeUndefined();
  });

  it("refuses one filed nowhere", () => {
    expect(() => service.createAgendaItem(maria, { text: "Floating" })).toThrow(ApiError);
  });

  it("refuses one pointing at an entry that does not exist", () => {
    expect(() =>
      service.createAgendaItem(maria, {
        text: "x",
        date: "2026-09-10",
        relatedEntryId: "ev-nope",
      }),
    ).toThrow(ApiError);
  });

  it("ticks off and back", () => {
    const item = service.createAgendaItem(maria, { text: "Do it", date: "2026-09-10" });

    const done = service.updateAgendaItem(maria, item.id, { completed: true });
    expect(done.completed).toBe(true);
    expect(done.completedAt).toBeDefined();

    const undone = service.updateAgendaItem(maria, item.id, { completed: false });
    expect(undone.completed).toBe(false);
    expect(undone.completedAt).toBeUndefined();
  });

  it("deletes one", () => {
    const item = service.createAgendaItem(maria, { text: "Do it", date: "2026-09-10" });
    service.deleteAgendaItem(maria, item.id);
    expect(repo.findAgendaItem(item.id)).toBeUndefined();
  });

  /** An agenda is personal: the author's, and the assignee's, and no one else's. */
  it("keeps one leader's agenda off another's", () => {
    const mine = service.createAgendaItem(maria, {
      text: "Ring the camp office",
      date: "2026-09-10",
    });
    expect(mine.createdBy).toBe(maria.person.id);

    const range = { from: "2026-09-07", to: "2026-09-13" };
    expect(service.listRange(maria, range).agenda.map((a) => a.id)).toEqual([mine.id]);
    expect(service.listRange(joel, range).agenda).toEqual([]);
    expect(() => service.updateAgendaItem(joel, mine.id, { completed: true })).toThrow(ApiError);
    expect(() => service.deleteAgendaItem(joel, mine.id)).toThrow(ApiError);
  });

  it("shows an item to the leader it was put on the agenda for", () => {
    const forJoel = service.createAgendaItem(maria, {
      text: "Confirm the hall",
      weekOf: "2026-09-07",
      assigneeId: joel.person.id,
    });
    const range = { from: "2026-09-07", to: "2026-09-13" };
    expect(service.listRange(joel, range).agenda.map((a) => a.id)).toEqual([forJoel.id]);
    expect(service.updateAgendaItem(joel, forJoel.id, { completed: true }).completed).toBe(true);
  });

  /**
   * An agenda item outlives the thing it was about: deleting the entry drops
   * the link, and the item stays on the leader's day.
   */
  it("survives the deletion of the entry it referenced", () => {
    const entry = service.createEntry(maria, oneOff());
    const item = service.createAgendaItem(maria, {
      text: "Bring the projector",
      date: "2026-09-10",
      relatedEntryId: entry.id,
    });

    service.deleteEntry(maria, entry.id);

    const still = repo.findAgendaItem(item.id);
    expect(still).toBeDefined();
    expect(still?.relatedEntryId).toBeUndefined();
  });
});

describe("duplicating", () => {
  it("copies an entry onto another day as a one-off", () => {
    const series = service.createEntry(maria, weekly());
    const copy = service.duplicateEntry(maria, series.id, "2026-10-07");

    expect(copy.title).toBe("Prayer & Fasting (copy)");
    expect(copy.date).toBe("2026-10-07");
    expect(copy.recurrence).toBeUndefined();
  });
});

/**
 * An agenda item put on the week for an ask names that ask. Only an ask made of
 * this leader may be named, and any other is answered as if it did not exist.
 */
describe("an agenda item from an ask", () => {
  it("keeps the ask it was put on the week for", () => {
    const withAsks = createCalendarService(repo, {
      askedOf: (viewer, id) => viewer.person.id === maria.person.id && id === "esc-maria",
    });
    const item = withAsks.createAgendaItem(maria, {
      text: "Confirm the venue",
      date: "2026-09-18",
      escalationId: "esc-maria",
    });
    expect(repo.findAgendaItem(item.id)?.escalationId).toBe("esc-maria");
  });

  it("refuses an ask that was not made of this leader, as not found", () => {
    const withAsks = createCalendarService(repo, {
      askedOf: (viewer, id) => viewer.person.id === maria.person.id && id === "esc-maria",
    });
    expect(() =>
      withAsks.createAgendaItem(joel, {
        text: "Confirm the venue",
        date: "2026-09-18",
        escalationId: "esc-maria",
      }),
    ).toThrow(expect.objectContaining({ code: "not-found" }));
  });

  it("refuses to name an ask when it cannot check whose it is", () => {
    expect(() =>
      service.createAgendaItem(maria, {
        text: "Confirm the venue",
        date: "2026-09-18",
        escalationId: "esc-maria",
      }),
    ).toThrow(expect.objectContaining({ code: "not-found" }));
  });
});

/**
 * A report's author can put its follow-ups on their week. Anybody else naming
 * the report is answered as if it did not exist.
 */
describe("an agenda item from a report's follow-up", () => {
  const reports = {
    authorsFollowUp: (viewer: { person: { id: string } }, reportId: string, blockId: string) =>
      viewer.person.id === maria.person.id && reportId === "lr-1" && blockId === "b2",
  };

  it("keeps the report and the line it came from", () => {
    const withReports = createCalendarService(repo, undefined, reports);
    const item = withReports.createAgendaItem(maria, {
      text: "Call the Santos family",
      weekOf: "2026-09-14",
      reportId: "lr-1",
      reportBlockId: "b2",
    });
    expect(repo.findAgendaItem(item.id)).toMatchObject({ reportId: "lr-1", reportBlockId: "b2" });
  });

  it("refuses a report this leader did not write, as not found", () => {
    const withReports = createCalendarService(repo, undefined, reports);
    expect(() =>
      withReports.createAgendaItem(joel, {
        text: "Call the Santos family",
        weekOf: "2026-09-14",
        reportId: "lr-1",
        reportBlockId: "b2",
      }),
    ).toThrow(expect.objectContaining({ code: "not-found" }));
  });

  it("refuses a report without the line in it", () => {
    expect(() =>
      service.createAgendaItem(maria, { text: "x", weekOf: "2026-09-14", reportId: "lr-1" }),
    ).toThrow(ApiError);
  });
});
