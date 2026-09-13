import { describe, expect, it } from "vitest";

import {
  RESET_WARNING_MS,
  minutesUntil,
  refreshedSince,
  resetWarningDue,
  sessionEnded,
} from "./demo-awareness";

describe("telling a refreshed demonstration from an expired session", () => {
  it("is a refresh when the demonstration has been reset since this browser explored it", () => {
    expect(refreshedSince(3, 4)).toBe(true);
  });

  it("is not a refresh when the generation is the one this browser used", () => {
    expect(refreshedSince(4, 4)).toBe(false);
  });

  it("says nothing when this browser never explored, or the server reports no count", () => {
    expect(refreshedSince(null, 4)).toBe(false);
    expect(refreshedSince(4, null)).toBe(false);
  });
});

describe("noticing that this browser's session has ended", () => {
  it("is when the page shows somebody and the status says nobody is signed in", () => {
    expect(sessionEnded(true, { signedIn: false })).toBe(true);
  });

  it("is not while the session is still recognised", () => {
    expect(sessionEnded(true, { signedIn: true })).toBe(false);
  });

  /* The sign-in screen itself shows nobody: no redirect from there, so no loop. */
  it("is not on a page that shows nobody", () => {
    expect(sessionEnded(false, { signedIn: false })).toBe(false);
  });

  it("is not decided by a status that never arrived", () => {
    expect(sessionEnded(true, undefined)).toBe(false);
  });
});

describe("warning that the demonstration is about to reset", () => {
  const RESET = "2026-09-13T16:00:00.000Z";
  const before = (ms: number) => Date.parse(RESET) - ms;

  it("warns inside the last ten minutes", () => {
    expect(resetWarningDue(RESET, before(RESET_WARNING_MS), null)).toBe(true);
    expect(resetWarningDue(RESET, before(9 * 60_000), null)).toBe(true);
    expect(resetWarningDue(RESET, before(1_000), null)).toBe(true);
  });

  it("does not warn earlier than that", () => {
    expect(resetWarningDue(RESET, before(RESET_WARNING_MS + 1_000), null)).toBe(false);
    expect(resetWarningDue(RESET, before(3 * 60 * 60_000), null)).toBe(false);
  });

  it("does not warn about a reset that has already happened", () => {
    expect(resetWarningDue(RESET, before(0), null)).toBe(false);
    expect(resetWarningDue(RESET, before(-60_000), null)).toBe(false);
  });

  it("warns once for a reset, however often it is asked", () => {
    expect(resetWarningDue(RESET, before(8 * 60_000), RESET)).toBe(false);
    expect(resetWarningDue(RESET, before(2 * 60_000), RESET)).toBe(false);
  });

  it("warns again for the next reset", () => {
    const next = "2026-09-13T22:00:00.000Z";
    expect(resetWarningDue(next, Date.parse(next) - 5 * 60_000, RESET)).toBe(true);
  });

  it("rounds the minutes up, and never says zero", () => {
    expect(minutesUntil(RESET, before(RESET_WARNING_MS))).toBe(10);
    expect(minutesUntil(RESET, before(9 * 60_000 + 1))).toBe(10);
    expect(minutesUntil(RESET, before(1_000))).toBe(1);
  });
});
