import { agendaOn, formatTime, occurrencesOn } from "./schedule";
import type { AgendaItem, MeetingTask, ScheduleEntry, ScheduleOccurrence } from "./types";

/**
 * The leader's planning information, as something several views can render.
 *
 * > **The record is not the view.**
 *
 * A task does not belong to a list, an event does not belong to a calendar, and
 * an agenda entry does not belong to the Weekly Agenda. The records exist; a
 * view is a way of looking at them. So Agenda, List and Calendar all read
 * *this*, and none of them holds anything of its own — there is no second copy
 * of an item to fall out of step with the first.
 *
 * ## It projects, it does not flatten
 *
 * A gathering is not a task with a different colour. Each item keeps its
 * `kind`, and — the part that matters — its **source**: the type and id of the
 * record it came from. Without that a view can show you something and not be
 * able to open it, which is how a planning surface turns into a pile of
 * anonymous copies.
 */

/**
 * What kind of thing this is, in the leader's terms.
 *
 * Deliberately not one generic type. A birthday is information, a gathering is
 * an occurrence somebody leads, a task is something to do — and an interface
 * that renders them identically is telling the leader they are the same.
 */
export type PlanningKind = "task" | "event" | "gathering" | "activity" | "information";

export const planningKindLabel: Record<PlanningKind, string> = {
  task: "Task",
  event: "Event",
  gathering: "Gathering",
  activity: "Activity",
  information: "Information",
};

/** Where an item came from. Never dropped: it is how a view opens the record. */
export interface PlanningSource {
  /** The domain record's own type — `schedule-entry`, `agenda-item`. */
  type: string;
  id: string;
  /** The occurrence, when the record recurs and this is one of its days. */
  occurrenceDate?: string;
}

export interface PlanningItem {
  /** Stable per item *per day*, so a recurring entry keys correctly. */
  id: string;
  kind: PlanningKind;
  title: string;
  /** ISO date this item sits on. */
  date: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  /** Ticked, for the kinds where that means anything. */
  completed?: boolean;
  /** The ministry or area it belongs to, as a leader would name it. */
  contextLabel?: string;
  contextId?: string;
  location?: string;
  recurring: boolean;
  source: PlanningSource;
  /**
   * What this viewer may do with it.
   *
   * Carried on the item because a view must be able to decline to offer an
   * action, and computing it per view is how two views come to disagree.
   */
  may: { edit: boolean; complete: boolean; reschedule: boolean };
}

/* ------------------------------------------------------------- projection */

/**
 * Everything on one day, from every source the week knows about.
 *
 * Entries and agenda items today. More sources — gatherings, report
 * obligations, meeting actions — attach here, which is the point of the shape:
 * a view never learns where an item came from.
 */
export function planningForDay(
  iso: string,
  entries: ScheduleEntry[],
  agenda: AgendaItem[],
  ministryName: (id: string | undefined) => string | undefined,
  /** Meeting tasks assigned to this leader. Optional; see `fromMeetingTask`. */
  tasks: MeetingTaskEntry[] = [],
): PlanningItem[] {
  const fromEntries = occurrencesOn(entries, iso).map((occurrence) =>
    fromOccurrence(occurrence, ministryName),
  );
  const fromAgenda = agendaOn(agenda, iso).map((item) => fromAgendaItem(item, ministryName));
  const fromTasks = tasks
    .map(fromMeetingTask)
    .filter((item): item is PlanningItem => item !== undefined && item.date === iso);

  return [...fromEntries, ...fromAgenda, ...fromTasks];
}

/**
 * A task that came out of a meeting, as planning information.
 *
 * Tasks were only ever visible inside the meeting that produced them, which
 * meant a leader had to remember which meeting had asked something of them.
 * A task with a date belongs in the week like anything else with a date — and
 * it is the **same record**, opened through its meeting, never a copy.
 *
 * Only tasks assigned to this leader, and only ones with a date: an undated
 * task is a responsibility, not an appointment, and putting it on a day the
 * application chose would be inventing a deadline.
 */
export interface MeetingTaskEntry {
  task: MeetingTask;
  contextLabel: string;
  readable: boolean;
}

export function fromMeetingTask(entry: MeetingTaskEntry): PlanningItem | undefined {
  const { task } = entry;
  if (!task.dueDate) return undefined;

  return {
    id: `meeting-task-${task.id}`,
    kind: "task",
    title: task.title,
    date: task.dueDate,
    allDay: true,
    completed: task.status === "done",
    recurring: false,
    contextLabel: entry.contextLabel,
    source: { type: "meeting-task", id: task.id },
    /* Completing is the assignee's; the wording and the date belong to the
       meeting, and are edited where the meeting is — when they may open it. */
    may: { edit: false, complete: true, reschedule: false },
  };
}

/** Across a run of days, in the order the days were given. */
export function planningForDays(
  days: string[],
  entries: ScheduleEntry[],
  agenda: AgendaItem[],
  ministryName: (id: string | undefined) => string | undefined,
  /** Tasks assigned to this leader, from `fetchMyTasks`. Optional. */
  tasks: MeetingTaskEntry[] = [],
): PlanningItem[] {
  return days.flatMap((iso) => planningForDay(iso, entries, agenda, ministryName, tasks));
}

/**
 * What a scheduled entry looks like as planning information.
 *
 * The `category` is what says whether this is an evening somebody leads, a
 * church activity or a birthday — so it decides the kind rather than being
 * thrown away in favour of one generic row.
 */
function fromOccurrence(
  occurrence: ScheduleOccurrence,
  ministryName: (id: string | undefined) => string | undefined,
): PlanningItem {
  const { entry, date, recurring } = occurrence;
  const kind = kindForCategory(entry.category);

  return {
    id: occurrence.key,
    kind,
    title: entry.title,
    date,
    allDay: !entry.startTime,
    recurring,
    source: {
      type: "schedule-entry",
      id: entry.id,
      ...(recurring ? { occurrenceDate: date } : {}),
    },
    /* Nothing on the calendar is ticked off; a task is what gets completed. */
    may: { edit: true, complete: false, reschedule: true },
    ...(entry.startTime ? { startTime: entry.startTime } : {}),
    ...(entry.endTime ? { endTime: entry.endTime } : {}),
    ...(entry.location ? { location: entry.location } : {}),
    ...(entry.ministryId ? { contextId: entry.ministryId } : {}),
    ...(ministryName(entry.ministryId) ? { contextLabel: ministryName(entry.ministryId)! } : {}),
  };
}

function fromAgendaItem(
  item: AgendaItem,
  ministryName: (id: string | undefined) => string | undefined,
): PlanningItem {
  return {
    id: `task-${item.id}`,
    kind: "task",
    title: item.text,
    /* An item filed to the week and not to a day belongs to the week's Monday
       for arranging purposes; nothing invents a day it was never given. */
    date: item.date ?? item.weekOf ?? "",
    allDay: true,
    completed: item.completed,
    recurring: false,
    source: { type: "agenda-item", id: item.id },
    may: { edit: true, complete: true, reschedule: true },
    ...(item.ministryId ? { contextId: item.ministryId } : {}),
    ...(ministryName(item.ministryId) ? { contextLabel: ministryName(item.ministryId)! } : {}),
  };
}

/** A calendar category, in planning terms. */
function kindForCategory(category: ScheduleEntry["category"]): PlanningKind {
  switch (category) {
    case "lifegroup":
      return "gathering";
    /* Something to know rather than something to attend. */
    case "celebration":
      return "information";
    /* The church's and the ministries' own recurring work. */
    case "prayer-fasting":
    case "service":
    case "victuals":
    case "potbless":
      return "activity";
    default:
      return "event";
  }
}

/* ---------------------------------------------------------------- shaping */

export interface PlanningFilters {
  kinds?: PlanningKind[];
  /** Ministry id, or `"none"` for items belonging to no ministry. */
  contextId?: string;
  /** Ticked items are part of the record of the week, so they are shown by
      default and hidden only on request. */
  hideCompleted?: boolean;
  search?: string;
}

export type PlanningSort = "time" | "title" | "kind";
export type PlanningGroup = "day" | "context" | "kind" | "status";

export function filterPlanning(items: PlanningItem[], filters: PlanningFilters): PlanningItem[] {
  const q = filters.search?.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.kinds?.length && !filters.kinds.includes(item.kind)) return false;
    if (filters.contextId === "none" && item.contextId) return false;
    if (filters.contextId && filters.contextId !== "none" && item.contextId !== filters.contextId) {
      return false;
    }
    if (filters.hideCompleted && item.completed) return false;
    if (
      q &&
      !(
        item.title.toLowerCase().includes(q) ||
        (item.contextLabel ?? "").toLowerCase().includes(q) ||
        (item.location ?? "").toLowerCase().includes(q)
      )
    ) {
      return false;
    }
    return true;
  });
}

/**
 * In the order a view should read them.
 *
 * By time, an item with no time comes first: an all-day thing frames the day
 * rather than happening at midnight.
 */
export function sortPlanning(items: PlanningItem[], sort: PlanningSort): PlanningItem[] {
  const copy = [...items];
  if (sort === "title") return copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "kind") {
    return copy.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  }
  return copy.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
      a.title.localeCompare(b.title),
  );
}

export interface PlanningGroupResult {
  key: string;
  label: string;
  items: PlanningItem[];
}

/**
 * Reorganized, never duplicated.
 *
 * Grouping changes how the same items are arranged. An item appears in exactly
 * one group, because it is one record — a view that showed it twice would be
 * inventing a second one.
 */
export function groupPlanning(
  items: PlanningItem[],
  group: PlanningGroup,
  dayLabelOf: (iso: string) => string,
): PlanningGroupResult[] {
  const buckets = new Map<string, PlanningGroupResult>();

  for (const item of items) {
    const { key, label } = bucketFor(item, group, dayLabelOf);
    const bucket = buckets.get(key) ?? { key, label, items: [] };
    bucket.items.push(item);
    buckets.set(key, bucket);
  }

  const out = [...buckets.values()];
  /* By day, chronologically; otherwise alphabetically, with "nothing" last. */
  return group === "day"
    ? out.sort((a, b) => a.key.localeCompare(b.key))
    : out.sort((a, b) => (a.key === "~" ? 1 : b.key === "~" ? -1 : a.label.localeCompare(b.label)));
}

function bucketFor(
  item: PlanningItem,
  group: PlanningGroup,
  dayLabelOf: (iso: string) => string,
): { key: string; label: string } {
  if (group === "day") return { key: item.date, label: dayLabelOf(item.date) };
  if (group === "kind") return { key: item.kind, label: planningKindLabel[item.kind] };
  if (group === "status") {
    if (item.completed) return { key: "done", label: "Done" };
    return item.may.complete
      ? { key: "todo", label: "To do" }
      : { key: "scheduled", label: "Scheduled" };
  }
  return item.contextId
    ? { key: item.contextId, label: item.contextLabel ?? item.contextId }
    : { key: "~", label: "No ministry" };
}

/** "7:30 PM", or nothing when the item is not at a time. */
export const planningTime = (item: PlanningItem) =>
  item.allDay ? undefined : formatTime(item.startTime);
