import { describe, expect, it } from "vitest";

import { countdown, nextRefreshAt, previousRefreshAt, usableTimeZone } from "./refresh-schedule";

/**
 * A demonstration refreshes at 00:00, 06:00, 12:00 and 18:00 on the church's
 * own clock. These tests read the answer back on that clock, so they hold
 * whatever timezone the test machine itself is in.
 */

const onClock = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);

describe("the next refresh", () => {
  it.each([
    /* [now (UTC), site timezone, expected on the site's clock] */
    ["2026-09-13T14:30:00Z", "America/Toronto", "2026-09-13, 12:00"], // 10:30 EDT → noon
    ["2026-09-13T16:00:00Z", "America/Toronto", "2026-09-13, 18:00"], // exactly noon → next is 18:00
    ["2026-09-13T23:15:00Z", "America/Toronto", "2026-09-14, 00:00"], // 19:15 → midnight
    ["2026-09-13T05:59:00Z", "UTC", "2026-09-13, 06:00"],
    ["2026-09-13T20:00:00Z", "Asia/Manila", "2026-09-14, 06:00"], // 04:00 +08 → 06:00
    ["2026-12-31T23:30:00Z", "UTC", "2027-01-01, 00:00"], // year end
    ["2026-02-28T19:00:00Z", "Pacific/Kiritimati", "2026-03-01, 12:00"], // 09:00 +14, month end
    ["2026-09-13T11:00:00Z", "Asia/Kolkata", "2026-09-13, 18:00"], // half-hour offset
  ])("from %s in %s is %s", (now, timeZone, expected) => {
    const next = nextRefreshAt(new Date(now), timeZone);
    expect(onClock(next, timeZone)).toBe(expected);
    expect(next.getTime()).toBeGreaterThan(new Date(now).getTime());
  });

  it("is always within six hours", () => {
    const start = Date.UTC(2026, 0, 1);
    for (let hour = 0; hour < 24 * 400; hour += 7) {
      const now = new Date(start + hour * 3_600_000 + 13 * 60_000);
      const next = nextRefreshAt(now, "America/Toronto");
      expect(next.getTime() - now.getTime()).toBeGreaterThan(0);
      expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(6 * 3_600_000);
    }
  });

  /* Toronto springs forward at 02:00 and falls back at 02:00: neither touches
     the refresh hours, and the refresh stays on the local clock across both. */
  it("stays on the local clock across daylight-saving changes", () => {
    expect(
      onClock(
        nextRefreshAt(new Date("2026-03-08T06:30:00Z"), "America/Toronto"),
        "America/Toronto",
      ),
    ).toBe("2026-03-08, 06:00");
    expect(
      onClock(
        nextRefreshAt(new Date("2026-11-01T06:30:00Z"), "America/Toronto"),
        "America/Toronto",
      ),
    ).toBe("2026-11-01, 06:00");
  });

  /* Where the clock jumps at midnight, 00:00 does not exist that night; the
     refresh still happens, at the first instant after the gap. */
  it("still finds a refresh when a refresh hour falls in a daylight-saving gap", () => {
    const now = new Date("2026-09-06T02:00:00Z"); // 22:00 the evening before, in Santiago
    const next = nextRefreshAt(now, "America/Santiago");
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(6 * 3_600_000);
  });

  it("falls back to UTC for a timezone the runtime does not know", () => {
    expect(usableTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(usableTimeZone(undefined)).toBe("UTC");
    expect(usableTimeZone("America/Toronto")).toBe("America/Toronto");
    expect(onClock(nextRefreshAt(new Date("2026-09-13T07:00:00Z"), "Nowhere/Nothing"), "UTC")).toBe(
      "2026-09-13, 12:00",
    );
  });
});

describe("the previous refresh", () => {
  it("is the refresh hour just passed on the site's clock", () => {
    const at = previousRefreshAt(new Date("2026-09-13T14:30:00Z"), "America/Toronto");
    expect(at.toISOString()).toBe("2026-09-13T10:00:00.000Z");
    expect(onClock(at, "America/Toronto")).toBe("2026-09-13, 06:00");
  });

  it("is now itself when now is exactly a refresh time", () => {
    const boundary = new Date("2026-09-13T16:00:00Z");
    expect(previousRefreshAt(boundary, "America/Toronto").getTime()).toBe(boundary.getTime());
  });

  it("reaches back across midnight to yesterday's evening refresh", () => {
    const at = previousRefreshAt(new Date("2026-09-14T03:59:00Z"), "America/Toronto");
    expect(onClock(at, "America/Toronto")).toBe("2026-09-13, 18:00");
  });

  it("and the next refresh are six hours of the same schedule, across daylight saving", () => {
    for (const iso of ["2026-03-08T07:30:00Z", "2026-11-01T05:30:00Z", "2026-07-01T00:00:01Z"]) {
      const now = new Date(iso);
      const previous = previousRefreshAt(now, "America/Toronto");
      const next = nextRefreshAt(now, "America/Toronto");
      expect(previous.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      /* Nothing on the schedule lies between them. */
      expect(nextRefreshAt(previous, "America/Toronto").getTime()).toBe(next.getTime());
    }
  });
});

describe("the countdown", () => {
  it.each([
    [0, "under a minute"],
    [59_000, "under a minute"],
    [60_000, "1m"],
    [9 * 60_000 + 42_000, "9m"],
    [2 * 3_600_000 + 14 * 60_000, "2h 14m"],
    [6 * 3_600_000, "6h 0m"],
    [-5_000, "under a minute"],
  ])("%d ms reads %s", (ms, text) => {
    expect(countdown(ms)).toBe(text);
  });
});
