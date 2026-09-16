import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createLifegroupRepository } from "../repositories/lifegroup-repository";
import { createLifegroupService } from "./lifegroup-service";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * LifeGroup persistence and rules.
 *
 * Entries carry prayer requests and concerns about named people, so most of
 * what is tested here is what does **not** come back: a private entry, an
 * entry for assigned leaders read by an unassigned one, and the counts that
 * would otherwise describe them.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createLifegroupService>;
let repo: ReturnType<typeof createLifegroupRepository>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-lifegroup-"));
  db = openDatabase(join(dir, "test.db"));
  repo = createLifegroupRepository(db);
  service = createLifegroupService(repo);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const gathering = (over: Record<string, unknown> = {}) => ({
  date: "2026-09-17",
  venueId: "ven-baronia",
  assignedLeaderIds: [maria.person.id],
  ...over,
});

/** A gathering Maria leads, ready to record. */
const led = () => service.createGathering(maria, gathering());

describe("scheduling a gathering", () => {
  it("persists it as an occasion, not a group", () => {
    const created = led();
    expect(created.id).toMatch(/^gth-/);
    /* Leaders were named, so the row is already assigned. */
    expect(created.status).toBe("assigned");
    expect(repo.findGathering(created.id)?.venueId).toBe("ven-baronia");
  });

  it("records who scheduled it", () => {
    expect(led().createdBy).toBe(maria.person.id);
  });

  /* A LifeGroup gathering is shared schedule from the moment it exists; only
     what a leader writes inside it has its own line. */
  it("is on everybody's schedule as soon as it is created", () => {
    const created = led();
    expect(service.listAll(bishop).gatherings.map((g) => g.id)).toContain(created.id);
    expect(service.getGathering(joel, created.id).gathering.id).toBe(created.id);
  });

  /**
   * This used to be refused. The schedule is a shared roster now: "Tuesday,
   * Markham, leader needed" is a real row, and demanding a leader up front is
   * what made adding one a form to complete.
   */
  it("accepts one with nobody leading it yet, and says so", () => {
    const row = service.createGathering(maria, gathering({ assignedLeaderIds: [] }));
    expect(row.assignedLeaderIds).toEqual([]);
    expect(row.status).toBe("planned");
  });

  /**
   * Not settled yet and settled-to-nothing are different. Leaving the venue out
   * is how a roster row starts; sending an empty one is a mistake worth
   * refusing.
   */
  it("accepts one with no venue yet, and refuses an empty one", () => {
    const { venueId: _omitted, ...withoutVenue } = gathering();
    expect(service.createGathering(maria, withoutVenue).venueId).toBeUndefined();
    expect(() => service.createGathering(maria, gathering({ venueId: "" }))).toThrow(ApiError);
  });

  it("refuses an end time before its start", () => {
    expect(() =>
      service.createGathering(maria, gathering({ startTime: "20:00", endTime: "19:00" })),
    ).toThrow(ApiError);
  });

  it("keeps several assigned leaders", () => {
    const created = service.createGathering(
      maria,
      gathering({ assignedLeaderIds: [maria.person.id, joel.person.id] }),
    );
    expect(repo.findGathering(created.id)?.assignedLeaderIds).toEqual([
      maria.person.id,
      joel.person.id,
    ]);
  });
});

/**
 * Three rights, kept apart: scheduling, amending, and recording what happened.
 * The last stays with the leader who was there.
 */
describe("who may do what", () => {
  it("lets an assigned leader record the gathering", () => {
    const g = led();
    expect(
      service.markAttendance(maria, { gatheringId: g.id, personId: "p-anna", status: "present" }),
    ).toBeDefined();
  });

  it("does not let an unassigned leader record it", () => {
    const g = led();
    expect(() =>
      service.markAttendance(joel, { gatheringId: g.id, personId: "p-anna", status: "present" }),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
  });

  /** Campus oversight may move a gathering and may not mark its attendance. */
  it("lets oversight amend but not record", () => {
    const g = led();
    expect(service.updateGathering(bishop, g.id, { date: "2026-09-24" }).date).toBe("2026-09-24");
    expect(() =>
      service.markAttendance(bishop, { gatheringId: g.id, personId: "p-anna", status: "present" }),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
  });

  it("does not let an unrelated leader amend it", () => {
    const g = led();
    expect(() => service.updateGathering(joel, g.id, { date: "2026-09-24" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
});

describe("attendance", () => {
  it("marks somebody from the directory", () => {
    const g = led();
    const mark = service.markAttendance(maria, {
      gatheringId: g.id,
      personId: "p-anna",
      status: "present",
      expected: true,
    });
    expect(mark.status).toBe("present");
    expect(mark.expected).toBe(true);
  });

  /** A walk-in the leader does not know yet. Inventing a person record is the CRM this is not. */
  it("marks a walk-in by name", () => {
    const g = led();
    const mark = service.markAttendance(maria, {
      gatheringId: g.id,
      name: "A friend of Anna's",
      status: "present",
      firstTime: true,
    });
    expect(mark.name).toBe("A friend of Anna's");
    expect(mark.personId).toBeUndefined();
  });

  /** A second mark is a correction, not a second record of the evening. */
  it("replaces an earlier mark for the same person", () => {
    const g = led();
    service.markAttendance(maria, { gatheringId: g.id, personId: "p-anna", status: "present" });
    service.markAttendance(maria, { gatheringId: g.id, personId: "p-anna", status: "excused" });

    const marks = repo.attendanceFor([g.id]).filter((m) => m.personId === "p-anna");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.status).toBe("excused");
  });

  it("refuses a mark naming nobody", () => {
    const g = led();
    expect(() => service.markAttendance(maria, { gatheringId: g.id, status: "present" })).toThrow(
      ApiError,
    );
  });

  it("removes a mark", () => {
    const g = led();
    const mark = service.markAttendance(maria, {
      gatheringId: g.id,
      personId: "p-anna",
      status: "present",
    });
    service.removeAttendance(maria, mark.id);
    expect(repo.attendanceFor([g.id])).toHaveLength(0);
  });

  it("goes with the gathering when the gathering goes", () => {
    const g = led();
    service.markAttendance(maria, { gatheringId: g.id, personId: "p-anna", status: "present" });
    db.prepare("DELETE FROM gathering WHERE id = ?").run(g.id);
    expect(repo.attendanceFor([g.id])).toHaveLength(0);
  });
});

/**
 * The rule this module exists to protect.
 */
describe("who may read an entry", () => {
  const withEntries = () => {
    const g = service.createGathering(maria, gathering());
    service.addEntry(maria, { gatheringId: g.id, body: "Ordinary note", visibility: "leaders" });
    service.addEntry(maria, { gatheringId: g.id, body: "Only mine", visibility: "private" });
    service.addEntry(maria, {
      gatheringId: g.id,
      body: "For whoever led",
      visibility: "assigned-leaders",
    });
    service.addEntry(maria, {
      gatheringId: g.id,
      body: "For Joel",
      visibility: "selected-viewers",
      viewerIds: [joel.person.id],
    });
    return g;
  };

  it("shows the author everything they wrote", () => {
    withEntries();
    expect(service.listAll(maria).entries).toHaveLength(4);
  });

  it("never shows a private entry to anybody else", () => {
    withEntries();
    for (const viewer of [joel, bishop]) {
      const bodies = service.listAll(viewer).entries.map((e) => e.body);
      expect(bodies).not.toContain("Only mine");
    }
  });

  /** `assigned-leaders` means the leaders of *this* gathering, not any leader. */
  it("keeps an assigned-leaders entry from a leader who did not lead it", () => {
    withEntries();
    expect(service.listAll(joel).entries.map((e) => e.body)).not.toContain("For whoever led");
  });

  it("shows an assigned-leaders entry to a leader who did lead it", () => {
    const g = withEntries();
    service.updateGathering(bishop, g.id, {
      assignedLeaderIds: [maria.person.id, joel.person.id],
    });
    expect(service.listAll(joel).entries.map((e) => e.body)).toContain("For whoever led");
  });

  it("shows a selected-viewers entry only to the named readers", () => {
    withEntries();
    expect(service.listAll(joel).entries.map((e) => e.body)).toContain("For Joel");
    expect(service.listAll(bishop).entries.map((e) => e.body)).not.toContain("For Joel");
  });

  it("counts what it withheld without saying what it was", () => {
    withEntries();
    const seen = service.listAll(bishop);
    expect(seen.withheldEntries).toBe(3);
    expect(JSON.stringify(seen)).not.toContain("Only mine");
  });

  it("filters the same way when one gathering is opened", () => {
    const g = withEntries();
    expect(service.getGathering(bishop, g.id).entries.map((e) => e.body)).toEqual([
      "Ordinary note",
    ]);
  });

  /** Knowing an id is not permission. */
  it("will not let somebody edit an entry they cannot read", () => {
    const g = withEntries();
    const priv = repo.entriesFor([g.id]).find((e) => e.body === "Only mine")!;

    expect(() => service.updateEntry(joel, priv.id, { body: "Rewritten" })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
    expect(repo.findEntry(priv.id)?.body).toBe("Only mine");
  });

  it("will not let a reader edit somebody else's entry", () => {
    const g = withEntries();
    const shared = repo.entriesFor([g.id]).find((e) => e.body === "For Joel")!;

    expect(() => service.updateEntry(joel, shared.id, { body: "Rewritten" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("lets the author edit and delete their own", () => {
    const g = withEntries();
    const own = repo.entriesFor([g.id]).find((e) => e.body === "Only mine")!;

    expect(service.updateEntry(maria, own.id, { body: "Still mine" }).body).toBe("Still mine");
    service.removeEntry(maria, own.id);
    expect(repo.findEntry(own.id)).toBeUndefined();
  });

  it("defaults an entry with no stated visibility to leaders", () => {
    const g = service.createGathering(maria, gathering());
    service.addEntry(maria, { gatheringId: g.id, body: "Unstated" });
    expect(service.listAll(joel).entries.map((e) => e.body)).toContain("Unstated");
  });

  it("refuses an empty entry", () => {
    const g = led();
    expect(() => service.addEntry(maria, { gatheringId: g.id, body: "  " })).toThrow(ApiError);
  });
});

describe("the exhortation", () => {
  it("is absent until there is a topic", () => {
    const g = led();
    expect(repo.findExhortation(g.id)).toBeUndefined();
  });

  it("records topic, scripture and notes", () => {
    const g = led();
    service.setExhortation(maria, {
      gatheringId: g.id,
      topic: "Bearing one another's burdens",
      scripture: "Galatians 6:2",
      notes: "Two people asked to talk afterwards.",
    });

    const saved = repo.findExhortation(g.id)!;
    expect(saved.topic).toBe("Bearing one another's burdens");
    expect(saved.scripture).toBe("Galatians 6:2");
  });

  /** A topic is what makes one, so clearing the topic clears the exhortation. */
  it("is cleared by clearing its topic", () => {
    const g = led();
    service.setExhortation(maria, { gatheringId: g.id, topic: "Something" });
    service.setExhortation(maria, { gatheringId: g.id, topic: "  " });
    expect(repo.findExhortation(g.id)).toBeUndefined();
  });

  it("cannot be written by a leader who did not lead the gathering", () => {
    const g = led();
    expect(() => service.setExhortation(joel, { gatheringId: g.id, topic: "Mine now" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
});

describe("finishing the write-up", () => {
  it("records the summary", () => {
    const g = led();
    service.setSummary(maria, { gatheringId: g.id, summary: "Quiet evening, good sharing." });
    expect(repo.findReport(g.id)?.summary).toBe("Quiet evening, good sharing.");
  });

  it("completes, recording when and by whom", () => {
    const g = led();
    const done = service.complete(maria, g.id);

    expect(done.status).toBe("completed");
    expect(repo.findReport(g.id)?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(repo.findReport(g.id)?.completedById).toBe(maria.person.id);
  });

  /** Finishing must never feel irreversible. */
  it("reopens, keeping what was written", () => {
    const g = led();
    service.setSummary(maria, { gatheringId: g.id, summary: "What happened." });
    service.complete(maria, g.id);

    const reopened = service.reopen(maria, g.id);
    expect(reopened.status).toBe("open");
    expect(repo.findReport(g.id)?.completedAt).toBeUndefined();
    expect(repo.findReport(g.id)?.summary).toBe("What happened.");
  });

  it("cannot be completed by somebody who did not lead it", () => {
    const g = led();
    expect(() => service.complete(joel, g.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
});

describe("amending a gathering", () => {
  /** Moving a date must not quietly erase the account of the evening. */
  it("leaves the exhortation and the write-up alone", () => {
    const g = led();
    service.setExhortation(maria, { gatheringId: g.id, topic: "Bearing burdens" });
    service.setSummary(maria, { gatheringId: g.id, summary: "Good evening." });

    service.updateGathering(maria, g.id, { date: "2026-09-24" });

    expect(repo.findExhortation(g.id)?.topic).toBe("Bearing burdens");
    expect(repo.findReport(g.id)?.summary).toBe("Good evening.");
  });

  it("records who changed it", () => {
    const g = led();
    expect(service.updateGathering(maria, g.id, { date: "2026-09-24" }).updatedBy).toBe(
      maria.person.id,
    );
  });
});

/**
 * The schedule is a shared roster, not a form one person completes.
 *
 * Three rules carry that: **a row may exist before its details do**,
 * **volunteering is not the same right as assigning somebody else**, and
 * **assignment grants responsibility, not ownership**.
 */
describe("the shared schedule", () => {
  const rowOn = (date: string) => service.createGathering(maria, { date });

  it("adds a row from a date alone", () => {
    const row = rowOn("2026-10-06");
    expect(row.id).toBeTruthy();
    expect(row.venueId).toBeUndefined();
    expect(row.assignedLeaderIds).toEqual([]);
    /* And it says what it still needs. */
    expect(row.status).toBe("planned");
  });

  it("is assigned as soon as somebody is on it, without being told to be", () => {
    const row = service.createGathering(maria, {
      date: "2026-10-06",
      assignedLeaderIds: [maria.person.id],
    });
    expect(row.status).toBe("assigned");
  });

  describe("claiming and joining", () => {
    it("lets any leader claim a row nobody is leading", () => {
      const row = rowOn("2026-10-06");
      const claimed = service.joinGathering(joel, { gatheringId: row.id, action: "claim" });

      expect(claimed.assignedLeaderIds).toEqual([joel.person.id]);
      expect(claimed.status).toBe("assigned");
    });

    /** Several leaders share a gathering; it has never had exactly one owner. */
    it("lets another leader add themselves beside the first", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(joel, { gatheringId: row.id, action: "claim" });
      const joined = service.joinGathering(maria, { gatheringId: row.id, action: "join" });

      expect(joined.assignedLeaderIds).toEqual([joel.person.id, maria.person.id]);
    });

    /**
     * Claiming takes a gathering nobody is leading; joining stands beside
     * leaders who already are. Doing the wrong one is worth saying rather than
     * quietly doing the other.
     */
    it("refuses to claim something somebody is already leading", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(joel, { gatheringId: row.id, action: "claim" });

      expect(() => service.joinGathering(maria, { gatheringId: row.id, action: "claim" })).toThrow(
        expect.objectContaining({ code: "conflict" }),
      );
    });

    it("refuses to add you twice", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(joel, { gatheringId: row.id, action: "claim" });
      expect(() => service.joinGathering(joel, { gatheringId: row.id, action: "join" })).toThrow(
        expect.objectContaining({ code: "conflict" }),
      );
    });

    it("lets a leader step away, and the row goes back to needing one", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(joel, { gatheringId: row.id, action: "claim" });
      const left = service.joinGathering(joel, { gatheringId: row.id, action: "leave" });

      expect(left.assignedLeaderIds).toEqual([]);
      expect(left.status).toBe("planned");
    });

    /**
     * Assignment grants responsibility, not ownership. The row stays in the
     * shared schedule throughout — which is exactly what lets somebody else
     * pick it up.
     */
    it("leaves the row maintainable by whoever picks it up next", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(joel, { gatheringId: row.id, action: "claim" });
      service.joinGathering(joel, { gatheringId: row.id, action: "leave" });

      const claimed = service.joinGathering(maria, { gatheringId: row.id, action: "claim" });
      expect(claimed.assignedLeaderIds).toEqual([maria.person.id]);
      expect(service.getGathering(maria, row.id).gathering.id).toBe(row.id);
    });

    /** Who led a gathering is part of its record once it is written up. */
    it("refuses to join a gathering that has already been completed", () => {
      const row = service.createGathering(maria, {
        date: "2026-10-06",
        assignedLeaderIds: [maria.person.id],
      });
      service.complete(maria, row.id);

      expect(() => service.joinGathering(joel, { gatheringId: row.id, action: "join" })).toThrow(
        expect.objectContaining({ code: "conflict" }),
      );
    });
  });

  /**
   * The stage the roster is actually prepared in.
   */
  describe("before anyone has claimed a row", () => {
    it("lets any leader fill in the details", () => {
      const row = rowOn("2026-10-06");
      const settled = service.updateGathering(joel, row.id, {
        venueId: "ven-baronia",
        startTime: "19:00",
      });
      expect(settled.venueId).toBe("ven-baronia");
      expect(settled.startTime).toBe("19:00");
    });

    /** Once it is somebody's, it is theirs and campus oversight's to change. */
    it("stops once somebody has claimed it", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(maria, { gatheringId: row.id, action: "claim" });

      expect(() => service.updateGathering(joel, row.id, { startTime: "20:00" })).toThrow(
        expect.objectContaining({ code: "forbidden" }),
      );
    });

    it("does not reopen a completed gathering to everyone", () => {
      const row = service.createGathering(maria, {
        date: "2026-10-06",
        assignedLeaderIds: [maria.person.id],
      });
      service.complete(maria, row.id);
      service.updateGathering(bishop, row.id, { assignedLeaderIds: [] });

      expect(() => service.updateGathering(joel, row.id, { startTime: "20:00" })).toThrow(
        expect.objectContaining({ code: "forbidden" }),
      );
    });
  });

  /**
   * Volunteering and assigning are different rights, and must not share a path
   * where the difference could be lost.
   */
  describe("naming somebody else", () => {
    it("does not let an ordinary leader put another name on a row", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(maria, { gatheringId: row.id, action: "claim" });

      expect(() =>
        service.updateGathering(maria, row.id, {
          assignedLeaderIds: [maria.person.id, joel.person.id],
        }),
      ).toThrow(expect.objectContaining({ code: "forbidden" }));
    });

    it("lets campus oversight do it", () => {
      const row = rowOn("2026-10-06");
      const assigned = service.updateGathering(bishop, row.id, {
        assignedLeaderIds: [maria.person.id, joel.person.id],
      });
      expect(assigned.assignedLeaderIds).toHaveLength(2);
      expect(assigned.status).toBe("assigned");
    });

    /** An assigned leader still maintains their own row. */
    it("lets an assigned leader settle the details without naming anyone", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(maria, { gatheringId: row.id, action: "claim" });

      const settled = service.updateGathering(maria, row.id, {
        startTime: "19:00",
        status: "confirmed",
      });
      expect(settled.startTime).toBe("19:00");
      expect(settled.status).toBe("confirmed");
    });

    /** A stage somebody set on purpose is not undone behind their back. */
    it("does not un-confirm a row when its leaders change", () => {
      const row = rowOn("2026-10-06");
      service.joinGathering(maria, { gatheringId: row.id, action: "claim" });
      service.updateGathering(maria, row.id, { status: "confirmed" });

      const left = service.joinGathering(maria, { gatheringId: row.id, action: "leave" });
      expect(left.status).toBe("confirmed");
      expect(left.assignedLeaderIds).toEqual([]);
    });
  });
});
