import { describe, expect, it } from "vitest";

import {
  filterPlanning,
  groupPlanning,
  planningForDays,
  sortPlanning,
  type PlanningItem,
} from "./planning";
import type { AgendaItem, ScheduleEntry } from "./types";

/**
 * Planning information, as several views see it.
 *
 * The claim these guard is the architectural one: **Agenda, List and Calendar
 * are projections of the same records, and every projected item can still say
 * which record it came from.** Everything else on those screens follows from
 * that being true.
 */

const ministryName = (id: string | undefined) =>
  id === "min-music" ? "Music Ministry" : undefined;

const entry = (over: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id: "ev-1",
  title: "Ministry meeting",
  date: "2026-09-10",
  category: "ministry-meeting",
  startTime: "19:30",
  ...over,
});

const task = (over: Partial<AgendaItem> = {}): AgendaItem => ({
  id: "ag-1",
  text: "Check Victuals attendance",
  date: "2026-09-10",
  completed: false,
  ...over,
});

const week = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"];

describe("one set of records, several views", () => {
  it("projects what is scheduled and what is to be done into one list", () => {
    const items = planningForDays(week, [entry()], [task()], ministryName);
    expect(items.map((i) => i.title).sort()).toEqual([
      "Check Victuals attendance",
      "Ministry meeting",
    ]);
  });

  /**
   * Without this a view can show you something and not be able to open it,
   * which is how a planning surface turns into a pile of anonymous copies.
   */
  it("keeps every item's source record", () => {
    const items = planningForDays(week, [entry()], [task()], ministryName);
    const scheduled = items.find((i) => i.title === "Ministry meeting")!;
    const todo = items.find((i) => i.title === "Check Victuals attendance")!;

    expect(scheduled.source).toMatchObject({ type: "schedule-entry", id: "ev-1" });
    expect(todo.source).toMatchObject({ type: "agenda-item", id: "ag-1" });
  });

  /** A recurring entry's occurrence has to say which day it is. */
  it("says which occurrence a recurring item is", () => {
    const { date: _dated, ...undatedEntry } = entry();
    const recurring: ScheduleEntry = {
      ...undatedEntry,
      id: "ev-r",
      /* Mondays, from the start of the month. */
      recurrence: { frequency: "weekly", weekday: 1, from: "2026-09-01" },
    };

    const items = planningForDays(week, [recurring], [], ministryName);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.recurring).toBe(true);
      expect(item.source.occurrenceDate).toBe(item.date);
      expect(item.source.id).toBe("ev-r");
    }
  });

  /**
   * A gathering is not a task with a different colour, and a birthday is not
   * something to attend. Flattening them would tell the leader they are the
   * same kind of thing.
   */
  it("keeps each record's kind rather than making everything a task", () => {
    const items = planningForDays(
      ["2026-09-10"],
      [
        entry({ id: "a", category: "lifegroup", title: "LifeGroup" }),
        entry({ id: "b", category: "celebration", title: "Anna — birthday" }),
        entry({ id: "c", category: "prayer-fasting", title: "Prayer & Fasting" }),
        entry({ id: "d", category: "chat", title: "CHAT" }),
      ],
      [task()],
      ministryName,
    );

    const kinds = Object.fromEntries(items.map((i) => [i.title, i.kind]));
    expect(kinds["LifeGroup"]).toBe("gathering");
    expect(kinds["Anna — birthday"]).toBe("information");
    expect(kinds["Prayer & Fasting"]).toBe("activity");
    expect(kinds["CHAT"]).toBe("event");
    expect(kinds["Check Victuals attendance"]).toBe("task");
  });

  /** Only the kinds where ticking means something can be ticked. */
  it("does not offer to complete something that is not a task", () => {
    const items = planningForDays(["2026-09-10"], [entry()], [task()], ministryName);
    expect(items.find((i) => i.kind === "task")!.may.complete).toBe(true);
    expect(items.find((i) => i.kind === "event")!.may.complete).toBe(false);
  });

  it("carries the ministry a leader would name it by", () => {
    const items = planningForDays(
      ["2026-09-10"],
      [entry({ ministryId: "min-music" })],
      [],
      ministryName,
    );
    expect(items[0]?.contextLabel).toBe("Music Ministry");
  });
});

/* ------------------------------------------------------------- shaping */

const items: PlanningItem[] = [
  {
    id: "1",
    kind: "task",
    title: "Zebra task",
    date: "2026-09-08",
    allDay: true,
    completed: false,
    recurring: false,
    contextId: "min-music",
    contextLabel: "Music Ministry",
    source: { type: "agenda-item", id: "1" },
    may: { edit: true, complete: true, reschedule: true },
  },
  {
    id: "2",
    kind: "event",
    title: "Alpha meeting",
    date: "2026-09-07",
    startTime: "19:30",
    allDay: false,
    recurring: false,
    source: { type: "schedule-entry", id: "2" },
    may: { edit: true, complete: false, reschedule: true },
  },
  {
    id: "3",
    kind: "task",
    title: "Done already",
    date: "2026-09-07",
    allDay: true,
    completed: true,
    recurring: false,
    source: { type: "agenda-item", id: "3" },
    may: { edit: true, complete: true, reschedule: true },
  },
];

describe("shaping the same items", () => {
  it("filters by kind, by ministry and by words", () => {
    expect(filterPlanning(items, { kinds: ["task"] })).toHaveLength(2);
    expect(filterPlanning(items, { contextId: "min-music" })).toHaveLength(1);
    expect(filterPlanning(items, { contextId: "none" })).toHaveLength(2);
    expect(filterPlanning(items, { search: "alpha" })).toHaveLength(1);
  });

  /**
   * Finished work is part of the record of the week, so it is shown by default
   * and hidden only when asked.
   */
  it("shows completed work unless asked not to", () => {
    expect(filterPlanning(items, {})).toHaveLength(3);
    expect(filterPlanning(items, { hideCompleted: true })).toHaveLength(2);
  });

  it("reads chronologically, with all-day items framing the day", () => {
    const sorted = sortPlanning(items, "time");
    expect(sorted.map((i) => i.title)).toEqual(["Done already", "Alpha meeting", "Zebra task"]);
  });

  /**
   * Grouping rearranges; it never duplicates. An item is one record and must
   * land in exactly one group.
   */
  it("puts every item in exactly one group, however it is grouped", () => {
    for (const group of ["day", "context", "kind", "status"] as const) {
      const groups = groupPlanning(items, group, (iso) => iso);
      const ids = groups.flatMap((g) => g.items.map((i) => i.id));
      expect(ids.sort(), group).toEqual(["1", "2", "3"]);
      expect(new Set(ids).size, group).toBe(ids.length);
    }
  });

  it("groups by ministry, and says so when there is none", () => {
    const groups = groupPlanning(items, "context", (iso) => iso);
    expect(groups.map((g) => g.label)).toEqual(["Music Ministry", "No ministry"]);
  });

  it("groups by what still needs doing", () => {
    const groups = groupPlanning(items, "status", (iso) => iso);
    expect(groups.map((g) => g.label).sort()).toEqual(["Done", "Scheduled", "To do"]);
  });

  it("groups days in the order they happen", () => {
    const groups = groupPlanning(items, "day", (iso) => iso);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-07", "2026-09-08"]);
  });
});
