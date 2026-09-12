import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The former combined Schedule page.
 *
 * It served both sidebar destinations with a Month/Week toggle, which made the
 * two destinations duplicates of each other — and, because the sidebar never
 * passed its search parameters, Weekly Agenda actually rendered the month grid.
 *
 * Weekly Agenda and Monthly Calendar are now separate routes that specialize.
 * This redirect keeps old links working, honouring `?view=week` where present.
 */
export const Route = createFileRoute("/schedule")({
  validateSearch: (search: Record<string, unknown>): { view?: string; date?: string } => ({
    ...(typeof search["view"] === "string" ? { view: search["view"] } : {}),
    ...(typeof search["date"] === "string" ? { date: search["date"] } : {}),
  }),
  beforeLoad: ({ search }) => {
    const date = typeof search.date === "string" ? { date: search.date } : {};
    throw redirect({
      to: search.view === "week" ? "/weekly-agenda" : "/monthly-calendar",
      search: date,
    });
  },
});
