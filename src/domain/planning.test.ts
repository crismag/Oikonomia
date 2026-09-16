import { describe, expect, it } from "vitest";

import {
  completionFor,
  filterPlanning,
  groupPlanning,
  meetingTaskWeek,
  planningForDays,
  planningHref,
  sortPlanning,
  tasksForDay,
  type PlanningItem,
} from "./planning";
import type { AgendaItem, MeetingTask, ScheduleEntry } from "./types";

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
  it("keeps a meeting task's note as the related record", () => {
    const items = planningForDays(week, [], [], ministryName, [
      {
        task: {
          id: "t-1",
          meetingId: "note-9",
          title: "Book the hall",
          dueDate: "2026-09-10",
          status: "open",
          createdAt: "2026-09-09T12:00:00",
        },
        contextLabel: "Elders",
        readable: true,
      },
    ]);
    expect(items[0]?.source).toMatchObject({
      type: "meeting-task",
      id: "t-1",
      relatedId: "note-9",
    });
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

describe("opening a projected item", () => {
  const scheduled: PlanningItem = {
    id: "occ-1",
    kind: "event",
    title: "Ministry meeting",
    date: "2026-09-10",
    allDay: false,
    startTime: "19:30",
    recurring: false,
    source: { type: "schedule-entry", id: "ev-1" },
    may: { edit: true, complete: false, reschedule: true },
  };

  it("opens scheduled work on the week, on that day, naming the item", () => {
    expect(planningHref(scheduled)).toEqual({
      to: "/weekly-agenda",
      search: { date: "2026-09-10", open: "occ-1" },
    });
  });

  it("opens a meeting task in the note that created it", () => {
    const task: PlanningItem = {
      ...scheduled,
      id: "meeting-task-t1",
      kind: "task",
      title: "Book the hall",
      allDay: true,
      source: { type: "meeting-task", id: "t1", relatedId: "note-9" },
      may: { edit: false, complete: true, reschedule: false },
    };
    expect(planningHref(task)).toEqual({
      to: "/meeting-notes",
      search: { note: "note-9" },
    });
  });
});

/**
 * A meeting task can be given to someone who may not read the note. The task
 * is theirs; the note is not, so nothing may link them to it.
 */
describe("a meeting task from a note this leader may not read", () => {
  const entry = (readable: boolean) => ({
    task: {
      id: "t-2",
      meetingId: "note-private",
      title: "Call the caterer",
      dueDate: "2026-09-10",
      status: "open" as const,
      createdAt: "2026-09-09T12:00:00",
    },
    contextLabel: "From a meeting",
    readable,
  });

  it("does not name the note", () => {
    const [item] = tasksForDay("2026-09-10", [], ministryName, [entry(false)]);
    expect(item?.source).not.toHaveProperty("relatedId");
  });

  it("opens the day on the week instead of a note they cannot open", () => {
    const [item] = tasksForDay("2026-09-10", [], ministryName, [entry(false)]);
    expect(planningHref(item!)).toEqual({ to: "/weekly-agenda", search: { date: "2026-09-10" } });
  });

  it("lists a day's agenda items before its meeting tasks, with the week's ids", () => {
    const agendaItem: AgendaItem = {
      id: "a-1",
      text: "Buy chairs",
      date: "2026-09-10",
      completed: false,
    };
    const items = tasksForDay("2026-09-10", [agendaItem], ministryName, [entry(true)]);
    expect(items.map((item) => item.id)).toEqual(["task-a-1", "meeting-task-t-2"]);
    expect(
      planningForDays(["2026-09-10"], [], [agendaItem], ministryName, [entry(true)]).map(
        (i) => i.id,
      ),
    ).toEqual(items.map((i) => i.id));
  });
});

/**
 * The meeting editor tells a leader whether a task will reach a week. It must
 * say the same thing `fromMeetingTask` does, and name what is missing rather
 * than choose a day.
 */
describe("meetingTaskWeek", () => {
  const task = (over: Partial<Pick<MeetingTask, "assigneeId" | "dueDate" | "status">> = {}) => ({
    id: "t-1",
    status: "open" as const,
    ...over,
  });

  it("asks for somebody before a date", () => {
    expect(meetingTaskWeek(task({ dueDate: "2026-09-18" }), "p-me").state).toBe("needs-assignee");
  });

  it("asks for a date once somebody has it, and invents none", () => {
    expect(meetingTaskWeek(task({ assigneeId: "p-me" }), "p-me")).toEqual({ state: "needs-date" });
  });

  it("puts a dated task of mine on my week, on its due date", () => {
    expect(meetingTaskWeek(task({ assigneeId: "p-me", dueDate: "2026-09-18" }), "p-me")).toEqual({
      state: "on-your-week",
      date: "2026-09-18",
    });
  });

  it("says whose week it is on when it is somebody else's", () => {
    expect(
      meetingTaskWeek(task({ assigneeId: "p-joel", dueDate: "2026-09-18" }), "p-me"),
    ).toMatchObject({ state: "on-their-week", assigneeId: "p-joel" });
  });

  it("stops talking about weeks once it is done", () => {
    expect(
      meetingTaskWeek(task({ assigneeId: "p-me", dueDate: "2026-09-18", status: "done" }), "p-me"),
    ).toEqual({ state: "done" });
  });
});

/**
 * Every view's tick box completes the record it came from. The List view once
 * ignored meeting tasks while the Agenda view and the month completed them.
 */
describe("completionFor", () => {
  const meetingTask = (status: "open" | "done") =>
    tasksForDay("2026-09-10", [], ministryName, [
      {
        task: {
          id: "t-9",
          meetingId: "note-1",
          title: "Book the hall",
          dueDate: "2026-09-10",
          status,
          createdAt: "2026-09-09T12:00:00",
        },
        contextLabel: "Leaders meeting",
        readable: true,
      },
    ])[0]!;

  it("toggles an agenda item where it lives", () => {
    const [item] = tasksForDay(
      "2026-09-10",
      [{ id: "a-1", text: "Buy chairs", date: "2026-09-10", completed: false }],
      ministryName,
      [],
    );
    expect(completionFor(item!)).toEqual({ kind: "agenda-item", id: "a-1" });
  });

  it("completes an open meeting task in its meeting", () => {
    expect(completionFor(meetingTask("open"))).toEqual({
      kind: "meeting-task",
      id: "t-9",
      status: "done",
    });
  });

  it("reopens a done meeting task", () => {
    expect(completionFor(meetingTask("done"))).toMatchObject({ status: "open" });
  });

  it("offers nothing for an item that cannot be completed", () => {
    const [event] = planningForDays(["2026-09-10"], [entry()], [], ministryName);
    expect(event?.may.complete).toBe(false);
    expect(completionFor(event!)).toBeNull();
  });
});
