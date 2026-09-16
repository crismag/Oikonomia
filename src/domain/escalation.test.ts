import { describe, expect, it } from "vitest";

import {
  actionsAskedOn,
  askNotes,
  canWithdraw,
  escalationHref,
  isOnTheWeek,
  isPartyTo,
  weekDateFor,
} from "./escalation";

/**
 * An ask has to open the record it came from. A meeting note is addressed by
 * search, not by a path segment — sending somebody to the notebook without
 * naming the note is how the source of an ask used to disappear.
 */
describe("escalationHref", () => {
  it("opens a leadership report at the report", () => {
    expect(escalationHref("leadership-report", "r-1")).toEqual({
      to: "/leadership-reports/r-1",
    });
  });

  it("opens a meeting note with the note named", () => {
    expect(escalationHref("meeting-note", "n-9")).toEqual({
      to: "/meeting-notes",
      search: { note: "n-9" },
    });
  });

  it("opens a gathering at the gathering", () => {
    expect(escalationHref("gathering", "g-1")).toEqual({ to: "/lifegroups/g-1" });
  });
});

describe("weekDateFor", () => {
  it("files an ask on its needed-by date while that is ahead", () => {
    expect(weekDateFor({ neededBy: "2026-09-20" }, "2026-09-16")).toBe("2026-09-20");
  });

  it("files an overdue or undated ask on today, never a day already gone", () => {
    expect(weekDateFor({ neededBy: "2026-09-01" }, "2026-09-16")).toBe("2026-09-16");
    expect(weekDateFor({}, "2026-09-16")).toBe("2026-09-16");
  });
});

describe("isOnTheWeek", () => {
  const ask = { id: "esc-1", request: "Call the venue" };

  it("recognises the agenda item that names this ask, whatever it now says", () => {
    const agenda = [{ text: "Call the venue on Tuesday", completed: false, escalationId: "esc-1" }];
    expect(isOnTheWeek(ask, agenda)).toBe(true);
  });

  it("does not mistake another ask's item for this one, even worded the same", () => {
    const agenda = [{ text: "Call the venue", completed: false, escalationId: "esc-2" }];
    expect(isOnTheWeek(ask, agenda)).toBe(false);
  });

  it("still recognises an older item by its text when it names no ask", () => {
    expect(isOnTheWeek(ask, [{ text: "Call the venue", completed: false }])).toBe(true);
  });

  it("does not count an item already ticked off", () => {
    const agenda = [{ text: "Call the venue", completed: true, escalationId: "esc-1" }];
    expect(isOnTheWeek(ask, agenda)).toBe(false);
  });
});

describe("actionsAskedOn", () => {
  const ask = (id: string, over: Partial<{ type: "action" | "approval"; sourceId: string }>) => ({
    id,
    type: over.type ?? ("action" as const),
    sourceType: "leadership-report" as const,
    sourceId: over.sourceId ?? "r-1",
  });

  it("keeps only actions that came from this record", () => {
    const mine = [ask("a", {}), ask("b", { type: "approval" }), ask("c", { sourceId: "r-2" })];
    expect(actionsAskedOn(mine, "leadership-report", "r-1").map((item) => item.id)).toEqual(["a"]);
  });
});

describe("askNotes", () => {
  it("leaves out the ask itself and entries with nothing said", () => {
    const notes = askNotes([
      { actorId: "p-1", summary: "requested approval", note: "Room B?" },
      { actorId: "p-2", summary: "started on this" },
      { actorId: "p-2", summary: "asked for more information", note: "How many?" },
      { actorId: "p-1", summary: "answered the question", note: "Forty." },
    ]);
    expect(notes.map((entry) => entry.note)).toEqual(["How many?", "Forty."]);
  });
});

describe("isPartyTo", () => {
  const base = {
    id: "e-1",
    type: "action" as const,
    status: "requested" as const,
    sourceType: "work" as const,
    sourceId: "w-1",
    contextLabel: "",
    request: "Book the room",
    requestedById: "p-asker",
    requestedFromRole: "reporting-leader" as const,
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  };
  const person = (id: string) => ({ id, ministryIds: [] });

  it("includes the requester and whoever holds the position asked", () => {
    expect(isPartyTo(base, person("p-asker"), [])).toBe(true);
    expect(isPartyTo(base, person("p-leader"), ["reporting-leader"])).toBe(true);
  });

  it("does not include somebody who merely reads the record", () => {
    expect(isPartyTo(base, person("p-reader"), ["church-leadership"])).toBe(false);
  });
});

describe("canWithdraw", () => {
  it("allows an open ask and refuses a finished or decided one", () => {
    expect(canWithdraw({ type: "action", status: "in-progress" })).toBe(true);
    expect(canWithdraw({ type: "action", status: "completed" })).toBe(false);
    expect(canWithdraw({ type: "approval", status: "more-information", decidedById: "p" })).toBe(
      false,
    );
  });
});
