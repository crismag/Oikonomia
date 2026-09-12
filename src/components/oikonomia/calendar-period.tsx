import { useEffect, type ReactNode } from "react";

import { useSchedule } from "@/components/oikonomia/schedule-provider";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";

/**
 * Telling the provider which period is on screen, and saying so while it loads.
 *
 * A calendar is read by period, not by page: the month grid wants a month and
 * the week view wants a week, and moving to November is a different question
 * rather than the next page of October. The screen names its own days and this
 * asks the provider for exactly those.
 */
export function useCalendarPeriod(days: string[]) {
  const store = useSchedule();
  const from = days[0];
  const to = days[days.length - 1];

  useEffect(() => {
    if (from && to) store.setRange(from, to);
  }, [from, to, store]);

  return store;
}

/**
 * What a calendar screen shows while it is not showing a calendar.
 *
 * §20 requires every backend-connected screen to have somewhere to say
 * loading, empty and failed. The first load gets a skeleton; a failure gets an
 * explanation and a way to try again — never the exception's own text, which
 * is for the log.
 *
 * Moving between months is deliberately **not** a loading state: the provider
 * keeps the previous period on screen, so paging through the year does not
 * flash an empty grid at every step.
 */
export function CalendarState({
  children,
  lines = 6,
}: {
  children: ReactNode;
  /** Roughly how tall the real thing is, so the page does not jump. */
  lines?: number;
}) {
  const store = useSchedule();

  if (store.status === "error") {
    return (
      <ErrorState title="The calendar could not be loaded" onRetry={store.retry}>
        Your entries are safe. This is a problem reaching them.
      </ErrorState>
    );
  }

  if (store.status === "loading") return <ListSkeleton rows={lines} />;

  return <>{children}</>;
}
