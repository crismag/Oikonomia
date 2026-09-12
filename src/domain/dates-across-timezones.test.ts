import { format } from "date-fns";
import { afterAll, describe, expect, it } from "vitest";

import { fromISO } from "./schedule";

/**
 * A date is a day, not an instant.
 *
 * A gathering on `2026-09-12` happened on the twelfth wherever anybody reads
 * about it. It is not a moment in time that moves across the date line, and
 * the difference is the most common date bug there is:
 *
 * ```
 *                        parseISO      new Date()
 *   America/Toronto      12 Sep        11 Sep     ← off by one
 *   Pacific/Midway       12 Sep        11 Sep     ← off by one
 *   Pacific/Kiritimati   12 Sep        12 Sep
 * ```
 *
 * `new Date("2026-09-12")` reads the string as UTC midnight and then renders
 * it in local time, so everybody west of Greenwich sees the day before. The
 * application uses `fromISO`, which is date-fns `parseISO`, and that reads a
 * date-only string as **local** midnight — so the day survives.
 *
 * This test exists because the two look interchangeable, and replacing one
 * with the other would quietly move every date in the binder for anybody in
 * the Americas.
 */

const original = process.env["TZ"];

/* Four corners and the middle: two zones behind UTC, two ahead, and UTC. */
const ZONES = [
  "Pacific/Midway", // UTC-11
  "America/Toronto", // UTC-4
  "UTC",
  "Asia/Manila", // UTC+8
  "Pacific/Kiritimati", // UTC+14
];

const DAYS = ["2026-01-01", "2026-09-12", "2026-12-31", "2026-02-28", "2026-03-08"];

afterAll(() => {
  if (original === undefined) delete process.env["TZ"];
  else process.env["TZ"] = original;
});

describe("a domain date is the same day everywhere", () => {
  it("keeps its calendar day in every timezone", () => {
    for (const zone of ZONES) {
      process.env["TZ"] = zone;
      for (const day of DAYS) {
        expect(format(fromISO(day), "yyyy-MM-dd"), `${day} in ${zone}`).toBe(day);
      }
    }
  });

  it("renders the same readable day in every timezone", () => {
    const rendered = new Set<string>();
    for (const zone of ZONES) {
      process.env["TZ"] = zone;
      rendered.add(format(fromISO("2026-09-12"), "d MMM yyyy"));
    }
    expect([...rendered]).toEqual(["12 Sep 2026"]);
  });

  /**
   * The mistake this guards against, demonstrated rather than described.
   *
   * If this ever stops failing, either the platform changed or somebody has
   * made `new Date` behave like `parseISO` — and the guard above is what
   * actually matters either way.
   */
  it("is not what `new Date` would have done", () => {
    process.env["TZ"] = "America/Toronto";
    expect(format(new Date("2026-09-12"), "d MMM yyyy")).toBe("11 Sep 2026");
    expect(format(fromISO("2026-09-12"), "d MMM yyyy")).toBe("12 Sep 2026");
  });

  /* Daylight-saving boundaries are where local midnight is least ordinary. */
  it("survives the days a clock changes", () => {
    for (const zone of ["America/Toronto", "Europe/London", "Australia/Sydney"]) {
      process.env["TZ"] = zone;
      for (const day of ["2026-03-08", "2026-11-01", "2026-03-29", "2026-10-04"]) {
        expect(format(fromISO(day), "yyyy-MM-dd"), `${day} in ${zone}`).toBe(day);
      }
    }
  });
});
