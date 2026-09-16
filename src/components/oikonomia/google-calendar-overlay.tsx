import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CalendarDays, ExternalLink } from "lucide-react";

import { useAuth } from "./auth-provider";
import {
  OVERLAY_STORAGE_KEY,
  overlayOn,
  overlayUnavailableMessage,
  type OverlayEvent,
} from "@/domain/google-calendar";
import { formatTime } from "@/domain/schedule";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { fetchGoogleCalendarOverlay } from "@/lib/google-calendar-api";
import { cn } from "@/lib/utils";

/**
 * A leader's own Google Calendar, laid over their week or month.
 *
 * Offered only where the installation reads calendars (`methods.workspace`),
 * so a church without Workspace — and every demonstration — never sees a
 * control that cannot work. Shown or hidden per browser. What it draws is
 * context: it cannot be opened as a record, ticked, edited or counted.
 */
export function useGoogleCalendarOverlay(days: readonly string[]) {
  const { methods } = useAuth();
  const offered = methods.workspace.calendarOverlay;

  /* Hidden until the browser has said otherwise, so a server render and the
     first client render agree. */
  const [shown, setShownState] = useState(false);
  useEffect(() => {
    try {
      setShownState(window.localStorage.getItem(OVERLAY_STORAGE_KEY) !== "1");
    } catch {
      setShownState(true);
    }
  }, []);

  const setShown = (next: boolean) => {
    setShownState(next);
    try {
      window.localStorage.setItem(OVERLAY_STORAGE_KEY, next ? "0" : "1");
    } catch {
      /* Private mode: the choice lasts for this visit. */
    }
  };

  const from = days[0];
  const to = days.at(-1);
  const query = useQuery({
    queryKey: ["google-calendar-overlay", from, to],
    enabled: offered && shown && !!from && !!to,
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(await withTimeout(fetchGoogleCalendarOverlay({ data: { from: from!, to: to! } }))),
  });

  const active = offered && shown;
  const events = active ? (query.data?.events ?? []) : [];

  return {
    offered,
    shown,
    setShown,
    eventsOn: (iso: string) => overlayOn(events, iso),
    /** Said once, above the days — not on every one of them. */
    notice: active
      ? query.isError
        ? "Your Google Calendar could not be read just now. Your week is unaffected."
        : overlayUnavailableMessage(query.data?.unavailable)
      : undefined,
  };
}

export type GoogleCalendarOverlayState = ReturnType<typeof useGoogleCalendarOverlay>;

/** Show or hide it. Not drawn at all where it is not offered. */
export function OverlayToggle({ overlay }: { overlay: GoogleCalendarOverlayState }) {
  if (!overlay.offered) return null;
  return (
    <button
      type="button"
      aria-pressed={overlay.shown}
      onClick={() => overlay.setShown(!overlay.shown)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
        overlay.shown
          ? "border-border bg-muted text-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <CalendarDays className="size-3.5" aria-hidden />
      Google Calendar
      <span className="sr-only">{overlay.shown ? "(shown)" : "(hidden)"}</span>
    </button>
  );
}

export function OverlayNotice({ overlay }: { overlay: GoogleCalendarOverlayState }) {
  if (!overlay.notice) return null;
  return (
    <p className="mb-3 flex items-start gap-2 text-[13px] text-muted-foreground">
      <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {overlay.notice}
    </p>
  );
}

const when = (event: OverlayEvent) =>
  event.allDay ? "All day" : (formatTime(event.startTime) ?? "");

/**
 * A day's events from the leader's Google Calendar.
 *
 * Muted and dashed so it never reads as Oikonomia's own; the words say where it
 * is from. The title opens the event in Google, which is where it is changed.
 */
export function OverlayEvents({
  events,
  compact = false,
  className,
}: {
  events: OverlayEvent[];
  compact?: boolean;
  className?: string;
}) {
  if (events.length === 0) return null;
  return (
    <div className={cn("rounded-lg border border-dashed border-border px-2 py-1.5", className)}>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <CalendarDays className="size-3 shrink-0" aria-hidden />
        {compact ? "Google Calendar" : "From your Google Calendar"}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {events.map((event) => {
          const label = (
            <>
              <span className="shrink-0 tabular-nums">{when(event)}</span>{" "}
              <span className={cn("min-w-0", compact ? "truncate" : "")}>{event.title}</span>
            </>
          );
          return (
            <li
              key={`${event.id}@${event.date}`}
              className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-[12px]")}
            >
              {event.htmlLink ? (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex min-w-0 items-baseline gap-1 hover:text-foreground"
                >
                  {label}
                  <ExternalLink
                    className="size-2.5 shrink-0 self-center opacity-0 group-hover:opacity-100"
                    aria-label="Opens Google Calendar"
                  />
                </a>
              ) : (
                <span className="flex min-w-0 items-baseline gap-1">{label}</span>
              )}
              {!compact && event.location ? (
                <span className="block truncate pl-0.5 text-[11px]">{event.location}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
