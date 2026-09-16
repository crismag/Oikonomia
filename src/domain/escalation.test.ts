import { describe, expect, it } from "vitest";

import { actionsAskedOn, escalationHref, isOnTheWeek, weekDateFor } from "./escalation";

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
