/**
 * When a public demonstration next returns to its original data.
 *
 * At fixed wall-clock hours in the church's own timezone — midnight, six,
 * noon and six — rather than every six hours from whenever the server last
 * started. "The demo refreshes at 6 pm" is something a visitor can plan
 * around; "six hours after a deployment nobody saw" is not.
 *
 * Computed with `Intl` alone, so the same function runs on the server and in
 * the browser, and daylight-saving changes are the timezone database's
 * problem rather than arithmetic here.
 */

/** The hours, in the site's timezone, at which a demonstration refreshes. */
export const REFRESH_HOURS = [0, 6, 12, 18] as const;

/** The site timezone if the runtime knows it; otherwise UTC, rather than a crash. */
export function usableTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The date and time an instant reads as on a clock in `timeZone`. */
function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** How far `timeZone`'s clock is ahead of UTC at an instant, in milliseconds. */
function offset(instant: Date, timeZone: string): number {
  const clock = wallClock(instant, timeZone);
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a wall-clock time in `timeZone` happens.
 *
 * Twice through, because the offset at the guess can differ from the offset at
 * the answer when a daylight-saving change lies between them. A time that does
 * not exist on that day (inside a spring-forward gap) resolves to the instant
 * just after it.
 */
function instantOf(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const naive = Date.UTC(year, month - 1, day, hour);
  let instant = naive - offset(new Date(naive), timeZone);
  instant = naive - offset(new Date(instant), timeZone);
  return new Date(instant);
}

/** The first refresh strictly after `now`. */
export function nextRefreshAt(
  now: Date,
  timeZone: string,
  hours: readonly number[] = REFRESH_HOURS,
): Date {
  const zone = usableTimeZone(timeZone);
  const today = wallClock(now, zone);

  for (let days = 0; days <= 2; days++) {
    /* Calendar arithmetic on a UTC date, so a month or year end rolls over. */
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
    for (const hour of [...hours].sort((a, b) => a - b)) {
      const candidate = instantOf(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        hour,
        zone,
      );
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  /* Unreachable with any non-empty list of hours: two days always hold one. */
  throw new Error("No refresh hour could be found.");
}

/**
 * The latest refresh at or before `now`.
 *
 * What a scheduled reset asks: has a refresh time passed since the last reset?
 * The same hours and the same timezone as the countdown a visitor sees, so the
 * screen and the reset cannot describe different schedules.
 */
export function previousRefreshAt(
  now: Date,
  timeZone: string,
  hours: readonly number[] = REFRESH_HOURS,
): Date {
  const zone = usableTimeZone(timeZone);
  const today = wallClock(now, zone);

  for (let days = 0; days >= -2; days--) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
    for (const hour of [...hours].sort((a, b) => b - a)) {
      const candidate = instantOf(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        hour,
        zone,
      );
      if (candidate.getTime() <= now.getTime()) return candidate;
    }
  }
  throw new Error("No refresh hour could be found.");
}

/** "2h 14m", "9m", "under a minute" — how a countdown reads at a glance. */
export function countdown(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}
