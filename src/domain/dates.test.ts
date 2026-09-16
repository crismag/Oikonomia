import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  dateOrder,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDayMonth,
  formatDayMonthShort,
  formatDayMonthTime,
  formatDayNumber,
  formatDayRange,
  formatMonth,
  formatMonthShort,
  formatMonthYear,
  formatTime,
  formatWeekday,
  formatWeekdayAbbrev,
  formatWeekdayFull,
  formatWeekdayLong,
  formatWeekdayShort,
  uses24HourClock,
  type DateSettings,
} from "./dates";

/*
 * The browser's own zone must not leak into what the church sees, so these
 * run somewhere that is neither the site zone nor UTC.
 */
const original = process.env["TZ"];
beforeAll(() => {
  process.env["TZ"] = "Asia/Manila";
});
afterAll(() => {
  if (original === undefined) delete process.env["TZ"];
  else process.env["TZ"] = original;
});

/* Nothing configured: exactly the strings the screens printed before. */
const NONE: DateSettings = {};
/* What ships in site.json. */
const SHIPPED: DateSettings = {
  timezone: "America/Toronto",
  locale: "en-CA",
  dateFormat: "d MMMM yyyy",
  timeFormat: "h:mm a",
};
const AMERICAN_24H: DateSettings = {
  timezone: "America/Toronto",
  locale: "en-US",
  dateFormat: "MMMM d, yyyy",
  timeFormat: "HH:mm",
};
const FRENCH: DateSettings = {
  timezone: "Europe/Paris",
  locale: "fr",
  dateFormat: "d MMMM yyyy",
  timeFormat: "HH:mm",
};

const DAY = "2026-09-12"; // a Saturday

describe("calendar dates with no settings", () => {
  it("print what the binder has always printed", () => {
    expect(formatDate(DAY, NONE)).toBe("12 September 2026");
    expect(formatDateShort(DAY, NONE)).toBe("12 Sep 2026");
    expect(formatDayMonth(DAY, NONE)).toBe("12 September");
    expect(formatDayMonthShort(DAY, NONE)).toBe("12 Sep");
    expect(formatWeekdayShort(DAY, NONE)).toBe("Sat 12 Sep");
    expect(formatWeekdayLong(DAY, NONE)).toBe("Saturday, 12 September");
    expect(formatWeekdayFull(DAY, NONE)).toBe("Saturday 12 September 2026");
    expect(formatWeekday(DAY, NONE)).toBe("Saturday");
    expect(formatWeekdayAbbrev(DAY, NONE)).toBe("Sat");
    expect(formatDayNumber(DAY, NONE)).toBe("12");
    expect(formatMonth(DAY, NONE)).toBe("September");
    expect(formatMonthShort(DAY, NONE)).toBe("Sep");
    expect(formatMonthYear(DAY, NONE)).toBe("September 2026");
    expect(formatMonthYear("2026-06", NONE)).toBe("June 2026");
  });

  it("writes a week as before", () => {
    expect(formatDayRange("2026-09-07", "2026-09-13", NONE)).toBe("7–13 September 2026");
    expect(formatDayRange("2026-09-28", "2026-10-04", NONE)).toBe("28 Sep – 4 Oct 2026");
  });

  it("writes times as before", () => {
    expect(formatTime("19:30", NONE)).toBe("7:30 PM");
    expect(formatTime("09:00", NONE)).toBe("9 AM");
    expect(formatTime("00:30", NONE)).toBe("12:30 AM");
  });

  it("shows text that is not a date as it was stored", () => {
    expect(formatDate("sometime in spring", NONE)).toBe("sometime in spring");
  });
});

describe("the shipped site profile", () => {
  it("prints the same days and times as having no settings", () => {
    for (const fn of [formatDate, formatDayMonthShort, formatWeekdayLong, formatWeekdayShort]) {
      expect(fn(DAY, SHIPPED)).toBe(fn(DAY, NONE));
    }
    expect(formatTime("19:30", SHIPPED)).toBe("7:30 PM");
    expect(formatDateTime("2026-09-12T19:05:00Z", SHIPPED)).toBe("12 Sep 2026, 3:05 PM");
  });
});

describe("a church that writes month first on a 24-hour clock", () => {
  it("reads the order and the clock from its patterns", () => {
    expect(dateOrder(AMERICAN_24H)).toBe("mdy");
    expect(uses24HourClock(AMERICAN_24H)).toBe(true);
    expect(uses24HourClock(SHIPPED)).toBe(false);
  });

  it("follows them everywhere", () => {
    expect(formatDate(DAY, AMERICAN_24H)).toBe("September 12, 2026");
    expect(formatDateShort(DAY, AMERICAN_24H)).toBe("Sep 12, 2026");
    expect(formatDayMonthShort(DAY, AMERICAN_24H)).toBe("Sep 12");
    expect(formatWeekdayShort(DAY, AMERICAN_24H)).toBe("Sat, Sep 12");
    expect(formatWeekdayLong(DAY, AMERICAN_24H)).toBe("Saturday, September 12");
    expect(formatDayRange("2026-09-07", "2026-09-13", AMERICAN_24H)).toBe("September 7–13, 2026");
    expect(formatTime("19:30", AMERICAN_24H)).toBe("19:30");
    expect(formatTime("09:00", AMERICAN_24H)).toBe("09:00");
    expect(formatDateTime("2026-09-12T19:05:00Z", AMERICAN_24H)).toBe("Sep 12, 2026, 15:05");
  });

  it("recognises a year-first pattern", () => {
    expect(dateOrder({ dateFormat: "yyyy-MM-dd" })).toBe("ymd");
    expect(dateOrder({ dateFormat: "'le' d MMMM yyyy" })).toBe("dmy");
  });
});

describe("another language", () => {
  it("names days and months in the church's locale", () => {
    expect(formatDate(DAY, FRENCH)).toBe("12 septembre 2026");
    expect(formatWeekday(DAY, FRENCH)).toBe("samedi");
    expect(formatTime("19:30", FRENCH)).toBe("19:30");
  });

  it("falls back to English for a locale it does not carry", () => {
    expect(formatDate(DAY, { locale: "tl-PH" })).toBe("12 September 2026");
  });
});

describe("a pattern an administrator mistyped", () => {
  it("falls back to the shipped pattern instead of breaking the page", () => {
    expect(formatDate(DAY, { dateFormat: "d MMMM yyyy YYYY" })).toBe("12 September 2026");
    expect(formatTime("2026-09-12T19:05:00Z", { timeFormat: "h:mm a YYYY" })).toBe("3:05 AM");
  });
});

describe("timestamps are read on the church's clock", () => {
  it("puts an early-UTC moment on the previous day in Toronto", () => {
    const instant = "2026-09-13T02:30:00Z"; // 22:30 on the 12th in Toronto, 10:30 on the 13th in Manila
    expect(formatDayMonthShort(instant, SHIPPED)).toBe("12 Sep");
    expect(formatDateTime(instant, SHIPPED)).toBe("12 Sep 2026, 10:30 PM");
    expect(formatDayMonthTime(instant, SHIPPED)).toBe("12 Sep, 10:30 PM");
  });

  it("puts a late-UTC moment on the next day east of Greenwich", () => {
    const instant = "2026-09-12T23:30:00Z";
    expect(formatDate(instant, { timezone: "Asia/Tokyo" })).toBe("13 September 2026");
    expect(formatDate(instant, { timezone: "America/Toronto" })).toBe("12 September 2026");
  });

  it("reads SQLite's zone-less timestamps as UTC", () => {
    expect(formatDateTime("2026-09-13 02:30:00", SHIPPED)).toBe("12 Sep 2026, 10:30 PM");
  });

  it("never moves a calendar date, whatever the zone", () => {
    for (const timezone of ["Pacific/Midway", "America/Toronto", "Pacific/Kiritimati"]) {
      expect(formatDate(DAY, { timezone })).toBe("12 September 2026");
    }
  });

  it("does not move a wall-clock time", () => {
    expect(formatTime("19:30", { timezone: "Asia/Tokyo" })).toBe("7:30 PM");
  });

  it("uses the device's clock for a zone name it does not know", () => {
    expect(formatDate("2026-09-12T12:00:00Z", { timezone: "Nowhere/Special" })).toBe(
      "12 September 2026",
    );
  });
});
