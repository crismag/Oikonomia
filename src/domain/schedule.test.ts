import { describe, expect, it } from "vitest";

import {
  agendaOn,
  endBefore,
  entryOccursOn,
  formatTime,
  inMonth,
  monthGridDays,
  notesForWeek,
  occurrencesOn,
  shiftMonth,
  shiftWeek,
  skipOccurrence,
  weekDays,
  weekOf,
} from "./schedule";
import type { AgendaItem, Recurrence, ScheduleEntry } from "./types";

/**
 * Schedule date logic.
 *
 * Calendars fail quietly — an entry lands one day out and nobody notices until a
 * leader misses a meeting. These cases pin the boundaries: week starts, month
 * edges, recurrence windows and the split between dated items and week notes.
 *
 * September 2026 is the reference month: it starts on a Tuesday and has 30 days,
 * so it exercises leading padding without needing a sixth week.
 */

const weekly = (weekday: number, from = "2026-01-01", until?: string): ScheduleEntry => ({
  id: `w-${weekday}`,
  title: "Rhythm",
  category: "other",
  recurrence: { frequency: "weekly", weekday, from, ...(until ? { until } : {}) },
});

const oneOff = (date: string, title = "One-off"): ScheduleEntry => ({
  id: `o-${date}`,
  title,
  date,
  category: "other",
});

describe("week boundaries", () => {
  it("treats Monday as the start of a binder week", () => {
    // 2026-09-10 is a Thursday.
    expect(weekOf("2026-09-10")).toBe("2026-09-07");
  });

  it("keeps Sunday in the week that began the previous Monday", () => {
    expect(weekOf("2026-09-13")).toBe("2026-09-07");
  });

  it("moves to a new week on Monday", () => {
    expect(weekOf("2026-09-14")).toBe("2026-09-14");
  });

  it("returns seven days, Monday first and Sunday last", () => {
    const days = weekDays("2026-09-10");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-09-07");
    expect(days[6]).toBe("2026-09-13");
  });

  it("steps a whole week at a time", () => {
    expect(shiftWeek("2026-09-10", 1)).toBe("2026-09-17");
    expect(shiftWeek("2026-09-10", -1)).toBe("2026-09-03");
  });
});

describe("month grid", () => {
  it("starts on the Sunday on or before the first of the month", () => {
    // 1 September 2026 is a Tuesday, so the grid opens on Sunday 30 August.
    expect(monthGridDays("2026-09-01")[0]).toBe("2026-08-30");
  });

  it("covers whole weeks", () => {
    expect(monthGridDays("2026-09-01").length % 7).toBe(0);
  });

  it("includes every day of the month", () => {
    const days = monthGridDays("2026-09-15");
    expect(days).toContain("2026-09-01");
    expect(days).toContain("2026-09-30");
  });

  it("does not draw a trailing week belonging entirely to the next month", () => {
    const days = monthGridDays("2026-09-01");
    const lastWeek = days.slice(-7);
    expect(lastWeek.some((iso) => inMonth(iso, "2026-09-01"))).toBe(true);
  });

  it("marks padding days as outside the month", () => {
    expect(inMonth("2026-08-30", "2026-09-01")).toBe(false);
    expect(inMonth("2026-09-30", "2026-09-01")).toBe(true);
  });

  it("navigates months without drifting", () => {
    expect(shiftMonth("2026-09-10", 1)).toBe("2026-10-10");
    expect(shiftMonth("2026-09-10", -1)).toBe("2026-08-10");
  });

  it("survives a 31st stepping into a shorter month", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("date placement", () => {
  it("places a one-off entry on exactly its own day", () => {
    const entry = oneOff("2026-09-10");
    expect(entryOccursOn(entry, "2026-09-10")).toBe(true);
    expect(entryOccursOn(entry, "2026-09-09")).toBe(false);
    expect(entryOccursOn(entry, "2026-09-11")).toBe(false);
  });

  it("orders a day with timed entries first, then untimed alphabetically", () => {
    const entries: ScheduleEntry[] = [
      { id: "a", title: "Zebra", date: "2026-09-10", category: "other" },
      { id: "b", title: "Alpha", date: "2026-09-10", category: "other" },
      { id: "c", title: "Evening", date: "2026-09-10", startTime: "19:30", category: "other" },
      { id: "d", title: "Morning", date: "2026-09-10", startTime: "09:00", category: "other" },
    ];
    expect(occurrencesOn(entries, "2026-09-10").map((o) => o.entry.title)).toEqual([
      "Morning",
      "Evening",
      "Alpha",
      "Zebra",
    ]);
  });

  it("gives each occurrence a key stable across re-expansion", () => {
    const entries = [weekly(3)];
    const first = occurrencesOn(entries, "2026-09-09")[0];
    const second = occurrencesOn(entries, "2026-09-09")[0];
    expect(first?.key).toBe(second?.key);
    expect(first?.key).not.toBe(occurrencesOn(entries, "2026-09-16")[0]?.key);
  });
});

describe("recurrence", () => {
  it("lands on its weekday every week", () => {
    const wednesday = weekly(3);
    expect(entryOccursOn(wednesday, "2026-09-09")).toBe(true);
    expect(entryOccursOn(wednesday, "2026-09-16")).toBe(true);
    expect(entryOccursOn(wednesday, "2026-09-23")).toBe(true);
  });

  it("ignores every other weekday", () => {
    const wednesday = weekly(3);
    expect(entryOccursOn(wednesday, "2026-09-10")).toBe(false);
  });

  it("does not run before it started", () => {
    const started = weekly(3, "2026-09-16");
    expect(entryOccursOn(started, "2026-09-09")).toBe(false);
    expect(entryOccursOn(started, "2026-09-16")).toBe(true);
  });

  it("stops after its end date", () => {
    const ended = weekly(3, "2026-01-01", "2026-09-16");
    expect(entryOccursOn(ended, "2026-09-16")).toBe(true);
    expect(entryOccursOn(ended, "2026-09-23")).toBe(false);
  });

  it("fills a month with a weekly rhythm", () => {
    const sundays = monthGridDays("2026-09-01")
      .filter((iso) => inMonth(iso, "2026-09-01"))
      .filter((iso) => entryOccursOn(weekly(0), iso));
    expect(sundays).toEqual(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]);
  });

  it("marks expanded occurrences as recurring", () => {
    expect(occurrencesOn([weekly(3)], "2026-09-09")[0]?.recurring).toBe(true);
    expect(occurrencesOn([oneOff("2026-09-09")], "2026-09-09")[0]?.recurring).toBe(false);
  });
});

describe("agenda and week notes", () => {
  const items: AgendaItem[] = [
    { id: "a", text: "Dated", date: "2026-09-10", completed: false },
    { id: "b", text: "Done", date: "2026-09-10", completed: true },
    { id: "c", text: "Note", weekOf: "2026-09-07", completed: false },
    { id: "d", text: "Other week note", weekOf: "2026-09-14", completed: false },
  ];

  it("files dated items against their day", () => {
    expect(agendaOn(items, "2026-09-10").map((i) => i.id)).toEqual(["a", "b"]);
    expect(agendaOn(items, "2026-09-11")).toEqual([]);
  });

  it("keeps completed items on the day rather than hiding them", () => {
    expect(agendaOn(items, "2026-09-10").some((i) => i.completed)).toBe(true);
  });

  it("returns week notes for any day of that week", () => {
    expect(notesForWeek(items, "2026-09-10").map((i) => i.id)).toEqual(["c"]);
    expect(notesForWeek(items, "2026-09-13").map((i) => i.id)).toEqual(["c"]);
  });

  it("never shows a dated item as a week note", () => {
    expect(notesForWeek(items, "2026-09-10").some((i) => i.date)).toBe(false);
  });

  it("separates one week's notes from the next", () => {
    expect(notesForWeek(items, "2026-09-14").map((i) => i.id)).toEqual(["d"]);
  });
});

describe("month and week share one date", () => {
  it("opens the week containing the day selected in month view", () => {
    const selectedInMonth = "2026-09-24";
    expect(weekDays(selectedInMonth)).toContain(selectedInMonth);
    expect(weekOf(selectedInMonth)).toBe("2026-09-21");
  });

  it("keeps a month-view selection inside the month it was made in", () => {
    const selected = "2026-09-24";
    expect(inMonth(selected, selected)).toBe(true);
  });
});

describe("time display", () => {
  it("writes times the way the binder does", () => {
    expect(formatTime("19:30")).toBe("7:30 PM");
    expect(formatTime("09:00")).toBe("9 AM");
    expect(formatTime("12:00")).toBe("12 PM");
    expect(formatTime("00:30")).toBe("12:30 AM");
  });

  it("leaves an untimed entry untimed", () => {
    expect(formatTime(undefined)).toBeUndefined();
  });
});

/* ---------------------------------------------------------- recurrence */

describe("rhythms other than weekly", () => {
  const on = (recurrence: Recurrence, iso: string) =>
    entryOccursOn({ id: "e", title: "t", category: "other", recurrence }, iso);

  it("repeats daily", () => {
    const r: Recurrence = { frequency: "daily", from: "2026-09-07" };
    expect(on(r, "2026-09-07")).toBe(true);
    expect(on(r, "2026-09-08")).toBe(true);
    expect(on(r, "2026-09-06")).toBe(false);
  });

  it("repeats weekly on the weekday it started", () => {
    const r: Recurrence = { frequency: "weekly", from: "2026-09-07" };
    expect(on(r, "2026-09-14")).toBe(true);
    expect(on(r, "2026-09-15")).toBe(false);
  });

  it("repeats every two weeks, skipping the week between", () => {
    const r: Recurrence = { frequency: "fortnightly", from: "2026-09-07" };
    expect(on(r, "2026-09-07")).toBe(true);
    expect(on(r, "2026-09-14")).toBe(false);
    expect(on(r, "2026-09-21")).toBe(true);
  });

  it("repeats monthly on the same day of the month", () => {
    const r: Recurrence = { frequency: "monthly", from: "2026-09-10" };
    expect(on(r, "2026-10-10")).toBe(true);
    expect(on(r, "2026-10-11")).toBe(false);
  });

  it("repeats yearly on the same date", () => {
    const r: Recurrence = { frequency: "yearly", from: "2026-09-10" };
    expect(on(r, "2027-09-10")).toBe(true);
    expect(on(r, "2027-10-10")).toBe(false);
  });

  it("stops at the end of the rhythm", () => {
    const r: Recurrence = { frequency: "weekly", from: "2026-09-07", until: "2026-09-14" };
    expect(on(r, "2026-09-14")).toBe(true);
    expect(on(r, "2026-09-21")).toBe(false);
  });
});

describe("changing one occurrence of a rhythm", () => {
  const weekly: Recurrence = { frequency: "weekly", from: "2026-09-07" };

  /**
   * Cancelling one week must not cancel the rhythm, and must not rewrite the
   * weeks around it.
   */
  it("removes a single date without touching the rest", () => {
    const skipped = skipOccurrence(weekly, "2026-09-14");
    const entry = { id: "e", title: "t", category: "other" as const, recurrence: skipped };
    expect(entryOccursOn(entry, "2026-09-14")).toBe(false);
    expect(entryOccursOn(entry, "2026-09-07")).toBe(true);
    expect(entryOccursOn(entry, "2026-09-21")).toBe(true);
  });

  it("never removes the same date twice", () => {
    const once = skipOccurrence(weekly, "2026-09-14");
    expect(skipOccurrence(once, "2026-09-14").skip).toEqual(["2026-09-14"]);
  });

  /** "This and following" keeps history: earlier occurrences remain. */
  it("ends a rhythm the day before, leaving the past intact", () => {
    const ended = endBefore(weekly, "2026-09-21");
    const entry = { id: "e", title: "t", category: "other" as const, recurrence: ended };
    expect(entryOccursOn(entry, "2026-09-14")).toBe(true);
    expect(entryOccursOn(entry, "2026-09-21")).toBe(false);
  });

  it("does not mutate the rhythm it was given", () => {
    skipOccurrence(weekly, "2026-09-14");
    endBefore(weekly, "2026-09-21");
    expect(weekly.skip).toBeUndefined();
    expect(weekly.until).toBeUndefined();
  });
});

describe("all-day and timed entries", () => {
  it("keeps an all-day entry distinguishable from an untimed one", () => {
    const birthday: ScheduleEntry = {
      id: "b",
      title: "Anna Cruz",
      category: "other",
      date: "2026-09-11",
      allDay: true,
    };
    expect(birthday.allDay).toBe(true);
    expect(birthday.startTime).toBeUndefined();
  });

  it("orders timed entries before untimed ones on the same day", () => {
    const entries: ScheduleEntry[] = [
      { id: "a", title: "All day thing", category: "other", date: "2026-09-10" },
      { id: "b", title: "Call", category: "other", date: "2026-09-10", startTime: "12:30" },
    ];
    expect(occurrencesOn(entries, "2026-09-10").map((o) => o.entry.id)).toEqual(["b", "a"]);
  });
});
