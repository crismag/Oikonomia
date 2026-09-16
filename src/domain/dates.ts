import { format as formatWith, parseISO, type Locale } from "date-fns";
import { de } from "date-fns/locale/de";
import { enAU } from "date-fns/locale/en-AU";
import { enCA } from "date-fns/locale/en-CA";
import { enGB } from "date-fns/locale/en-GB";
import { enIE } from "date-fns/locale/en-IE";
import { enIN } from "date-fns/locale/en-IN";
import { enNZ } from "date-fns/locale/en-NZ";
import { enUS } from "date-fns/locale/en-US";
import { enZA } from "date-fns/locale/en-ZA";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";
import { frCA } from "date-fns/locale/fr-CA";
import { id } from "date-fns/locale/id";
import { it } from "date-fns/locale/it";
import { ja } from "date-fns/locale/ja";
import { ko } from "date-fns/locale/ko";
import { nl } from "date-fns/locale/nl";
import { pt } from "date-fns/locale/pt";
import { ptBR } from "date-fns/locale/pt-BR";
import { vi } from "date-fns/locale/vi";
import { zhCN } from "date-fns/locale/zh-CN";
import { zhTW } from "date-fns/locale/zh-TW";

import { config } from "@/config";
import type { SiteConfig } from "@/config/schema";

/**
 * Dates and times, the way this church writes them.
 *
 * Screens ask for a date by **intent** — "a day, short", "a moment" — and the
 * site profile (`site.profile`: locale, dateFormat, timeFormat, timezone)
 * decides how it reads. Nothing here adds a setting; it reads the ones the
 * configuration already holds.
 *
 * Two kinds of value, and they must not be confused:
 *
 * - A **calendar date** (`yyyy-MM-dd`, or `yyyy-MM` for a month) is a day, not
 *   an instant. It is read as local midnight (`parseISO`, as `fromISO` does)
 *   and never shifted by a timezone — see `dates-across-timezones.test.ts`.
 * - A **timestamp** (`…T…Z`, or SQLite's UTC `yyyy-MM-dd HH:MM:SS`) is an
 *   instant, and is shown on the church's clock: the site timezone, not the
 *   browser's. A report saved at 01:30 UTC was saved "yesterday" in Toronto.
 *
 * The date *order* (day-first, month-first, year-first) is read from
 * `dateFormat`, so the short and weekday forms follow the church's full date
 * rather than needing a setting each. 24-hour time is read from `timeFormat`
 * (an `H` pattern). An administrator types these patterns, so a pattern
 * date-fns refuses falls back to the shipped one rather than breaking a page.
 */

export type DateSettings = Partial<
  Pick<SiteConfig, "locale" | "timezone" | "dateFormat" | "timeFormat">
>;

/* What the screens printed before they read settings. */
const DEFAULT_DATE_FORMAT = "d MMMM yyyy";
const DEFAULT_TIME_FORMAT = "h:mm a";

const LOCALES: Record<string, Locale> = {
  de,
  en: enUS,
  "en-AU": enAU,
  "en-CA": enCA,
  "en-GB": enGB,
  "en-IE": enIE,
  "en-IN": enIN,
  "en-NZ": enNZ,
  "en-US": enUS,
  "en-ZA": enZA,
  es,
  fr,
  "fr-CA": frCA,
  id,
  it,
  ja,
  ko,
  nl,
  pt,
  "pt-BR": ptBR,
  vi,
  zh: zhCN,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

/** The live site profile, read on every call so a saved change applies at once. */
function current(settings?: DateSettings): DateSettings {
  if (settings) return settings;
  try {
    return config.site;
  } catch {
    return {};
  }
}

/** A locale date-fns has, by exact tag then language; English otherwise. */
export function dateLocale(tag?: string): Locale {
  if (!tag) return enUS;
  return LOCALES[tag] ?? LOCALES[tag.split(/[-_]/)[0] ?? ""] ?? enUS;
}

export type DateOrder = "dmy" | "mdy" | "ymd";

/** Which comes first in the church's full date pattern. Quoted text is ignored. */
export function dateOrder(settings?: DateSettings): DateOrder {
  const pattern = (current(settings).dateFormat ?? DEFAULT_DATE_FORMAT).replace(/'[^']*'/g, "");
  const first = /[dMLy]/.exec(pattern)?.[0];
  if (first === "M" || first === "L") return "mdy";
  if (first === "y") return "ymd";
  return "dmy";
}

/** Whether the church reads a 24-hour clock. */
export function uses24HourClock(settings?: DateSettings): boolean {
  const pattern = (current(settings).timeFormat ?? DEFAULT_TIME_FORMAT).replace(/'[^']*'/g, "");
  return /[Hk]/.test(pattern) && !/[hK]/.test(pattern);
}

/**
 * `Intl.DateTimeFormat` options for the church's clock and zone.
 *
 * Only where a zone name ("EDT") is wanted, which date-fns cannot print. The
 * locale is left to the reader: Intl's en-CA writes "p.m." where the rest of
 * the binder, through date-fns, writes "PM".
 */
export function intlClockOptions(settings?: DateSettings): Intl.DateTimeFormatOptions {
  const site = current(settings);
  return {
    hour12: !uses24HourClock(site),
    ...(site.timezone ? { timeZone: site.timezone } : {}),
  };
}

/* ------------------------------------------------------------ reading values */

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock in `timeZone` at `instant`, as a local Date for date-fns. */
function inZone(instant: Date, timeZone?: string): Date {
  if (!timeZone) return instant;
  let formatter = zoneFormatters.get(timeZone);
  try {
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      zoneFormatters.set(timeZone, formatter);
    }
    const parts = formatter.formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return new Date(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour"),
      read("minute"),
      read("second"),
    );
  } catch {
    /* An unknown zone name: the device's clock, as before settings were read. */
    return instant;
  }
}

/**
 * A stored value as the Date to print.
 *
 * Calendar dates stay on their day; instants move to the site timezone.
 * Returns `undefined` for anything that is not a date, so the caller can show
 * the stored text instead of "Invalid Date".
 */
function toDisplayDate(value: string | Date, settings: DateSettings): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : inZone(value, settings.timezone);
  }
  const text = value.trim();
  if (/^\d{4}-\d{2}$/.test(text)) return parseISO(`${text}-01`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return parseISO(text);
  /* A timestamp without a zone is SQLite's `datetime('now')`, which is UTC. */
  const instant = new Date(
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)
      ? `${text.replace(" ", "T")}Z`
      : text,
  );
  return Number.isNaN(instant.getTime()) ? undefined : inZone(instant, settings.timezone);
}

function render(
  value: string | Date,
  pattern: string,
  fallback: string,
  settings?: DateSettings,
): string {
  const site = current(settings);
  const date = toDisplayDate(value, site);
  if (!date) return typeof value === "string" ? value : "";
  const locale = dateLocale(site.locale);
  try {
    return formatWith(date, pattern, { locale });
  } catch {
    return formatWith(date, fallback, { locale });
  }
}

type Patterns = Record<DateOrder, string>;

function byOrder(patterns: Patterns, value: string | Date, settings?: DateSettings): string {
  const pattern = patterns[dateOrder(settings)];
  return render(value, pattern, patterns.dmy, settings);
}

/* ------------------------------------------------------------------- intents */

/** The church's full date: "12 September 2026". */
export const formatDate = (value: string | Date, settings?: DateSettings) =>
  render(value, current(settings).dateFormat ?? DEFAULT_DATE_FORMAT, DEFAULT_DATE_FORMAT, settings);

/** A date with an abbreviated month: "12 Sep 2026". */
export const formatDateShort = (value: string | Date, settings?: DateSettings) =>
  byOrder({ dmy: "d MMM yyyy", mdy: "MMM d, yyyy", ymd: "yyyy MMM d" }, value, settings);

/** A day this year: "12 September". */
export const formatDayMonth = (value: string | Date, settings?: DateSettings) =>
  byOrder({ dmy: "d MMMM", mdy: "MMMM d", ymd: "MMMM d" }, value, settings);

/** A day this year, compact: "12 Sep". */
export const formatDayMonthShort = (value: string | Date, settings?: DateSettings) =>
  byOrder({ dmy: "d MMM", mdy: "MMM d", ymd: "MMM d" }, value, settings);

/** "Sat 12 Sep". */
export const formatWeekdayShort = (value: string | Date, settings?: DateSettings) =>
  byOrder({ dmy: "EEE d MMM", mdy: "EEE, MMM d", ymd: "MMM d (EEE)" }, value, settings);

/** "Saturday, 12 September". */
export const formatWeekdayLong = (value: string | Date, settings?: DateSettings) =>
  byOrder({ dmy: "EEEE, d MMMM", mdy: "EEEE, MMMM d", ymd: "MMMM d, EEEE" }, value, settings);

/** "Saturday 12 September 2026". */
export const formatWeekdayFull = (value: string | Date, settings?: DateSettings) =>
  byOrder(
    { dmy: "EEEE d MMMM yyyy", mdy: "EEEE, MMMM d, yyyy", ymd: "yyyy MMMM d, EEEE" },
    value,
    settings,
  );

/** "Saturday". */
export const formatWeekday = (value: string | Date, settings?: DateSettings) =>
  render(value, "EEEE", "EEEE", settings);

/** "Sat". */
export const formatWeekdayAbbrev = (value: string | Date, settings?: DateSettings) =>
  render(value, "EEE", "EEE", settings);

/** The day of the month: "12". */
export const formatDayNumber = (value: string | Date, settings?: DateSettings) =>
  render(value, "d", "d", settings);

/** "September". */
export const formatMonth = (value: string | Date, settings?: DateSettings) =>
  render(value, "MMMM", "MMMM", settings);

/** "Sep". */
export const formatMonthShort = (value: string | Date, settings?: DateSettings) =>
  render(value, "MMM", "MMM", settings);

/** "September 2026". Accepts `yyyy-MM`. */
export const formatMonthYear = (value: string | Date, settings?: DateSettings) =>
  byOrder({ dmy: "MMMM yyyy", mdy: "MMMM yyyy", ymd: "yyyy MMMM" }, value, settings);

/** "12–18 September 2026", or "28 Sep – 4 Oct 2026" across a month. */
export function formatDayRange(start: string, end: string, settings?: DateSettings): string {
  const order = dateOrder(settings);
  if (start.slice(0, 7) === end.slice(0, 7)) {
    if (order === "dmy") {
      return `${formatDayNumber(start, settings)}–${render(end, "d MMMM yyyy", "d MMMM yyyy", settings)}`;
    }
    if (order === "mdy") {
      return `${render(start, "MMMM d", "MMMM d", settings)}–${render(end, "d, yyyy", "d, yyyy", settings)}`;
    }
    return `${render(start, "yyyy MMMM d", "yyyy MMMM d", settings)}–${formatDayNumber(end, settings)}`;
  }
  return `${formatDayMonthShort(start, settings)} – ${formatDateShort(end, settings)}`;
}

/**
 * A time of day.
 *
 * A wall-clock `HH:mm` (a gathering's start) is not moved by any timezone.
 * On the shipped 12-hour pattern the binder writes "7:30 PM" and "9 AM" —
 * whole hours without ":00", as it always has. Any other pattern is used as
 * written: "HH:mm" gives "19:30". An instant is shown on the church's clock.
 */
export function formatTime(value: string | Date, settings?: DateSettings): string {
  const site = current(settings);
  const pattern = site.timeFormat ?? DEFAULT_TIME_FORMAT;
  if (typeof value === "string") {
    const clock = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (clock) {
      const hours = Number(clock[1]);
      const minutes = Number(clock[2]);
      if (pattern === DEFAULT_TIME_FORMAT) {
        const suffix = hours >= 12 ? "PM" : "AM";
        const hour = hours % 12 === 0 ? 12 : hours % 12;
        return minutes === 0
          ? `${hour} ${suffix}`
          : `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
      }
      const wall = new Date(2000, 0, 1, hours, minutes);
      const locale = dateLocale(site.locale);
      try {
        return formatWith(wall, pattern, { locale });
      } catch {
        return formatWith(wall, DEFAULT_TIME_FORMAT, { locale });
      }
    }
  }
  return render(value, pattern, DEFAULT_TIME_FORMAT, settings);
}

/** A moment with its year: "12 Sep 2026, 3:05 PM". */
export const formatDateTime = (value: string | Date, settings?: DateSettings) =>
  `${formatDateShort(value, settings)}, ${render(value, current(settings).timeFormat ?? DEFAULT_TIME_FORMAT, DEFAULT_TIME_FORMAT, settings)}`;

/** A recent moment: "12 Sep, 3:05 PM". */
export const formatDayMonthTime = (value: string | Date, settings?: DateSettings) =>
  `${formatDayMonthShort(value, settings)}, ${render(value, current(settings).timeFormat ?? DEFAULT_TIME_FORMAT, DEFAULT_TIME_FORMAT, settings)}`;
