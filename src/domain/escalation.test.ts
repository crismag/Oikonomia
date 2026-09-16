import { describe, expect, it } from "vitest";

import { escalationHref } from "./escalation";

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
