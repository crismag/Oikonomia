import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { config } from "@/config";
import type {
  AgendaItem,
  Recurrence,
  RecurrenceFrequency,
  ScheduleEntry,
  ScheduleOccurrence,
} from "./types";

/**
 * Schedule date logic.
 *
 * Dates are handled as plain ISO `yyyy-MM-dd` strings, never Date objects in
 * storage: a binder entry is a calendar day, not an instant, so it must not
 * shift when a timezone changes. Conversion to Date happens only for maths.
 */

export const ISO = "yyyy-MM-dd";

export const toISO = (date: Date) => format(date, ISO);
export const fromISO = (iso: string) => parseISO(iso);

/**
 * Where a week starts.
 *
 * Two different questions, and they have different answers on purpose.
 *
 * The **month grid** is a calendar, and a calendar's columns are a convention
 * of the page: Sunday first, as the physical binder prints it. It is not a
 * church's choice and stays here.
 *
 * The **weekly agenda** is a working week — where a leader's planning begins —
 * and that *is* a church's choice, so it comes from configuration. A church
 * that plans on Sunday evening sets it to 0 and the agenda follows.
 */
export const WEEK_STARTS_ON = 0 as const;

export const AGENDA_WEEK_STARTS_ON = config.site.weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Monday of the week containing `iso` — the identity of a binder week. */
export function weekOf(iso: string): string {
  return toISO(startOfWeek(fromISO(iso), { weekStartsOn: AGENDA_WEEK_STARTS_ON }));
}

/** The seven days of the binder week containing `iso`, Monday first. */
export function weekDays(iso: string): string[] {
  const monday = fromISO(weekOf(iso));
  return Array.from({ length: 7 }, (_, i) => toISO(addDays(monday, i)));
}

/**
 * Every day rendered by a month grid, including the leading and trailing days
 * that complete the first and last weeks.
 */
export function monthGridDays(iso: string): string[] {
  const month = fromISO(iso);
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: WEEK_STARTS_ON });
  const last = endOfMonth(month);
  // Five or six weeks as the month actually needs. A trailing week belonging
  // entirely to the next month reads as filler, so it is not drawn.
  const weeks = Math.ceil((last.getTime() - gridStart.getTime()) / (7 * 86400000) + 0.0001);
  const gridEnd = addDays(gridStart, weeks * 7 - 1);
  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map(toISO);
}

export function inMonth(iso: string, monthIso: string): boolean {
  return isSameMonth(fromISO(iso), fromISO(monthIso));
}

export function shiftMonth(iso: string, delta: number): string {
  return toISO(addMonths(fromISO(iso), delta));
}

export function shiftWeek(iso: string, delta: number): string {
  return toISO(addDays(fromISO(iso), delta * 7));
}

export function monthLabel(iso: string): string {
  return format(fromISO(iso), "MMMM yyyy");
}

export function weekLabel(iso: string): string {
  const days = weekDays(iso);
  const start = fromISO(days[0] ?? iso);
  const end = fromISO(days[6] ?? iso);
  return isSameMonth(start, end)
    ? `${format(start, "d")}–${format(end, "d MMMM yyyy")}`
    : `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
}

export const dayNumber = (iso: string) => format(fromISO(iso), "d");
export const dayLabel = (iso: string) => format(fromISO(iso), "EEEE");
export const shortDayLabel = (iso: string) => format(fromISO(iso), "EEE d MMM");

/* ------------------------------------------------------- recurrence */

export const recurrenceLabel: Record<RecurrenceFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const recurrenceFrequencies = Object.keys(recurrenceLabel) as RecurrenceFrequency[];

/**
 * Whether a rhythm lands on a day.
 *
 * The pattern is read off `from` — its weekday, its day of the month — so a
 * leader picks a start date rather than configuring the shape twice and
 * risking the two disagreeing.
 */
function recurs(recurrence: Recurrence, iso: string): boolean {
  if (iso < recurrence.from) return false;
  if (recurrence.until && iso > recurrence.until) return false;
  /* An occurrence removed from the series — a cancelled week, a moved date. */
  if (recurrence.skip?.includes(iso)) return false;

  const date = fromISO(iso);
  const anchor = fromISO(recurrence.from);

  switch (recurrence.frequency) {
    case "daily":
      return true;

    case "weekly":
      return date.getDay() === (recurrence.weekday ?? anchor.getDay());

    case "fortnightly": {
      if (date.getDay() !== (recurrence.weekday ?? anchor.getDay())) return false;
      const weeks = Math.round(differenceInCalendarDays(date, anchor) / 7);
      return weeks % 2 === 0;
    }

    case "monthly":
      return date.getDate() === anchor.getDate();

    case "yearly":
      return date.getDate() === anchor.getDate() && date.getMonth() === anchor.getMonth();

    default:
      return false;
  }
}

/**
 * Removing one occurrence from a rhythm.
 *
 * Deleting "this occurrence" must not delete the series, and must not silently
 * rewrite what happened on other days — so the date is recorded as skipped
 * rather than the pattern being edited.
 */
export function skipOccurrence(recurrence: Recurrence, iso: string): Recurrence {
  return { ...recurrence, skip: [...new Set([...(recurrence.skip ?? []), iso])] };
}

/**
 * Ending a rhythm the day before an occurrence.
 *
 * "This and following" keeps history intact: everything already scheduled
 * stays, and the series simply stops.
 */
export function endBefore(recurrence: Recurrence, iso: string): Recurrence {
  return { ...recurrence, until: toISO(addDays(fromISO(iso), -1)) };
}

/** Does this entry land on this day, one-off or recurring? */
export function entryOccursOn(entry: ScheduleEntry, iso: string): boolean {
  if (entry.date) return entry.date === iso;
  if (entry.recurrence) return recurs(entry.recurrence, iso);
  return false;
}

/** Occurrences on one day, timed entries first and then alphabetically. */
export function occurrencesOn(entries: ScheduleEntry[], iso: string): ScheduleOccurrence[] {
  return entries
    .filter((entry) => entryOccursOn(entry, iso))
    .map((entry) => ({
      key: `${entry.id}@${iso}`,
      entry,
      date: iso,
      recurring: Boolean(entry.recurrence),
    }))
    .sort((a, b) => {
      const at = a.entry.startTime ?? "";
      const bt = b.entry.startTime ?? "";
      if (at && bt) return at.localeCompare(bt);
      if (at) return -1;
      if (bt) return 1;
      return a.entry.title.localeCompare(b.entry.title);
    });
}

/** Agenda items filed against a specific day. */
export function agendaOn(items: AgendaItem[], iso: string): AgendaItem[] {
  return items.filter((item) => item.date === iso);
}

/** Week-scoped notes: belong to the week, not to any day. */
export function notesForWeek(items: AgendaItem[], iso: string): AgendaItem[] {
  const monday = weekOf(iso);
  return items.filter((item) => !item.date && item.weekOf === monday);
}

/** 12-hour clock, matching how the binder is written. */
export function formatTime(time?: string): string | undefined {
  if (!time) return undefined;
  const [h, m] = time.split(":").map(Number);
  if (h === undefined || m === undefined) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}
