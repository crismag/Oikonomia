/**
 * A leader's own Google Calendar, as the week and the month show it.
 *
 * Read-only context beside Oikonomia's own calendar. These are never planning
 * items: not tasks, not entries, not counted anywhere a leader's progress is
 * measured — they are what else is in the leader's day.
 */

/** One event from a leader's own calendar, with only what a day draws. */
export interface OverlayEvent {
  id: string;
  title: string;
  /** ISO date it starts on (in the church's zone). */
  date: string;
  allDay: boolean;
  /** "HH:mm" in the church's zone. Absent for all-day events. */
  startTime?: string;
  endTime?: string;
  /** Last day of an all-day event spanning several days (inclusive). */
  endDate?: string;
  location?: string;
  /** The event in Google Calendar, where it can be changed. */
  htmlLink?: string;
}

export type OverlayUnavailable = "not-configured" | "no-workspace-email" | "google-refused";

export interface Overlay {
  events: OverlayEvent[];
  /** Why there is nothing to show, when that is not simply an empty calendar. */
  unavailable?: OverlayUnavailable;
}

/** The events on one day: all-day first, then by start time. */
export function overlayOn(events: readonly OverlayEvent[], iso: string): OverlayEvent[] {
  return events
    .filter((event) => event.date <= iso && iso <= (event.endDate ?? event.date))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title);
    });
}

/**
 * What to tell the leader when their calendar cannot be shown.
 *
 * Undefined for "not set up": the control is not offered at all then, so
 * there is nothing to explain.
 */
export function overlayUnavailableMessage(
  reason: OverlayUnavailable | undefined,
): string | undefined {
  switch (reason) {
    case "no-workspace-email":
      return "Your Google Calendar cannot be shown: your record in People needs your church Google Workspace address.";
    case "google-refused":
      return "Google did not return your calendar just now. Your week is unaffected.";
    default:
      return undefined;
  }
}

/** Where the show/hide choice is remembered, per browser. */
export const OVERLAY_STORAGE_KEY = "oikonomia.google-calendar-overlay.hidden";
