import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EntryDetail } from "@/components/oikonomia/entry-detail";
import { QuickAdd } from "@/components/oikonomia/entry-editor";
import { useOverlay } from "@/components/oikonomia/overlay";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { ViewError } from "@/components/oikonomia/workspace";
import { CalendarState, useCalendarPeriod } from "@/components/oikonomia/calendar-period";
import { useSchedule } from "@/components/oikonomia/schedule-provider";
import { useMeetings, useMyMeetingTasks } from "@/components/oikonomia/meeting-provider";
import { planningHref, tasksForDay, type PlanningItem } from "@/domain/planning";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import {
  dayNumber,
  formatTime,
  fromISO,
  monthGridDays,
  monthLabel,
  occurrencesOn,
  shiftMonth,
  toISO,
  weekdayNames,
} from "@/domain/schedule";
import { format, isSameMonth } from "date-fns";
import type { ScheduleOccurrence } from "@/domain/types";

type Filter = "all" | "mine" | "ministry" | "lifegroup" | "church";

export const Route = createFileRoute("/monthly-calendar")({
  validateSearch: (search: Record<string, unknown>): { date?: string; show?: Filter } => {
    const filters: Filter[] = ["all", "mine", "ministry", "lifegroup", "church"];
    return {
      ...(typeof search["date"] === "string" ? { date: search["date"] } : {}),
      ...(filters.includes(search["show"] as Filter) && search["show"] !== "all"
        ? { show: search["show"] as Filter }
        : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Monthly Calendar — Oikonomia" },
      { name: "description", content: "What is happening across the month." },
    ],
  }),
  component: MonthlyCalendarPage,
});

const filterLabel: Record<Filter, string> = {
  all: "All",
  mine: "Mine",
  ministry: "Ministry",
  lifegroup: "LifeGroup",
  church: "Church",
};

/**
 * Monthly Calendar — the month at a glance.
 *
 * Event-centric and visually compact, which is the difference from Weekly
 * Agenda: this answers *when* things happen. Clicking an entry opens the entry;
 * clicking empty space in a day offers to add one. Those are two different
 * intentions and must not collapse into "select the day".
 */
function MonthlyCalendarPage() {
  const { ministries } = useOrganization();
  const { date, show = "all" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const store = useSchedule();

  const today = toISO(new Date());
  const anchor = date ?? today;
  const [selected, setSelected] = useState(anchor);
  const detail = useOverlay<ScheduleOccurrence>();
  const adding = useOverlay<string>();

  const go = (next: Partial<{ date: string; show: Filter }>) => {
    const merged: Record<string, unknown> = {
      date: anchor,
      ...(show !== "all" ? { show } : {}),
      ...next,
    };
    if (merged["show"] === "all") delete merged["show"];
    void navigate({ search: merged as { date?: string; show?: Filter }, replace: true });
  };

  /** Source, not category: where the entry came from. */
  const keep = (occurrence: ScheduleOccurrence) => {
    if (show === "all") return true;
    const { entry } = occurrence;
    if (show === "mine") return entry.source === "leader" || !entry.source;
    if (show === "ministry") return !!entry.ministryId || entry.source === "ministry";
    if (show === "lifegroup") return entry.source === "lifegroup" || entry.category === "lifegroup";
    return entry.source === "church" || entry.source === "event";
  };

  const days = monthGridDays(anchor);
  const month = fromISO(anchor);

  /* Tells the provider which month to fetch, so moving months moves the data. */
  useCalendarPeriod(days);

  return (
    <Page width="workspace">
      <PageHeader
        title="Monthly Calendar"
        description={monthLabel(anchor)}
        actions={
          <>
            {/*
             * The week and the month are two views of the same calendar, so
             * moving between them keeps the day you were looking at — a leader
             * who selects the 23rd and asks for the week should get the week
             * the 23rd is in, not this one.
             */}
            <Link
              to="/weekly-agenda"
              search={{ date: selected }}
              className="rounded-md border border-border px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Week
            </Link>

            <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
              <button
                type="button"
                onClick={() => go({ date: shiftMonth(anchor, -1) })}
                aria-label="Previous month"
                className="grid size-7 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  go({ date: today });
                  setSelected(today);
                }}
                className="rounded-sm px-2.5 py-1 text-[13px] font-medium transition-colors hover:bg-muted"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => go({ date: shiftMonth(anchor, 1) })}
                aria-label="Next month"
                className="grid size-7 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>

            <Button type="button" onClick={() => adding.open(selected)} variant="primary">
              <Plus className="size-3.5" aria-hidden />
              Add event
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(Object.keys(filterLabel) as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => go({ show: option })}
            aria-pressed={show === option}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[13px] transition-colors",
              show === option
                ? "border-primary/30 bg-accent-soft font-medium text-sidebar-accent-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {filterLabel[option]}
          </button>
        ))}
      </div>

      {/*
       * One month, two shapes.
       *
       * A seven-column grid is how a month is read at a desk, and it is
       * unusable on a phone: a cell becomes about forty pixels wide, an entry
       * title truncates to two characters, and every target is below the size
       * a thumb can hit. Below `lg` the same month is presented as an agenda —
       * still the whole month, still called Monthly Calendar, still navigated a
       * month at a time — because the question a leader asks on a phone is
       * "what is coming up", not "what shape is this month".
       */}
      {store.status === "error" ? <ViewError what="The month" onRetry={store.retry} /> : null}
      <CalendarState lines={6}>
        <MonthAgenda
          anchor={anchor}
          today={today}
          keep={keep}
          onOpenEntry={detail.open}
          onAdd={(iso) => adding.open(iso)}
        />

        <div className="hidden gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
            <div className="grid grid-cols-7 border-b border-border">
              {weekdayNames.map((name) => (
                <div
                  key={name}
                  className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {name.slice(0, 3)}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map((iso) => (
                <DayCell
                  key={iso}
                  iso={iso}
                  today={today}
                  inMonth={isSameMonth(fromISO(iso), month)}
                  selected={iso === selected}
                  keep={keep}
                  onSelectDay={setSelected}
                  onOpenEntry={detail.open}
                  onAdd={() => adding.open(iso)}
                />
              ))}
            </div>
          </div>

          <DayPanel
            iso={selected}
            keep={keep}
            onOpenEntry={detail.open}
            onAdd={() => adding.open(selected)}
          />
        </div>
      </CalendarState>

      <EntryDetail occurrence={detail.value} onClose={detail.close} />

      <Sheet open={adding.isOpen} onOpenChange={adding.onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-[20px]">New event</SheetTitle>
            <SheetDescription className="sr-only">Add something to the calendar</SheetDescription>
          </SheetHeader>
          {adding.value ? <QuickAdd date={adding.value} onDone={adding.close} /> : null}
        </SheetContent>
      </Sheet>
    </Page>
  );
}

/**
 * One day in the grid.
 *
 * The day number selects the day; an entry opens the entry; the empty space
 * beneath offers to add one. Three targets, three intentions.
 */
function DayCell({
  iso,
  today,
  inMonth,
  selected,
  keep,
  onSelectDay,
  onOpenEntry,
  onAdd,
}: {
  iso: string;
  today: string;
  inMonth: boolean;
  selected: boolean;
  keep: (occurrence: ScheduleOccurrence) => boolean;
  onSelectDay: (iso: string) => void;
  onOpenEntry: (occurrence: ScheduleOccurrence) => void;
  onAdd: () => void;
}) {
  const store = useSchedule();
  const occurrences = occurrencesOn(store.entries, iso).filter(keep);
  const isToday = iso === today;

  /*
   * A crowded day summarizes rather than overflowing its cell. Two entries,
   * not three: each chip is a 24px target, and a cell that fits three of those
   * plus a day number is taller than a month of them can be on one screen.
   */
  const shown = occurrences.slice(0, 2);
  const extra = occurrences.length - shown.length;

  return (
    <div
      className={cn(
        "flex min-h-28 flex-col gap-0.5 border-b border-r border-border p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0",
        !inMonth && "bg-surface-muted/50",
        selected && "ring-1 ring-inset ring-primary/40",
      )}
    >
      <button
        type="button"
        onClick={() => onSelectDay(iso)}
        className={cn(
          /* At least 24×24, so the day number is a target and not just a label. */
          "grid size-6 shrink-0 place-items-center self-start rounded text-[12px] tabular-nums transition-colors hover:bg-muted",
          isToday
            ? "bg-primary font-medium text-primary-foreground hover:bg-primary"
            : inMonth
              ? "text-foreground"
              : "text-muted-foreground",
        )}
      >
        {dayNumber(iso)}
      </button>

      {shown.map((occurrence) => (
        <button
          key={occurrence.key}
          type="button"
          onClick={() => onOpenEntry(occurrence)}
          title={occurrence.entry.title}
          className="flex min-h-6 items-center gap-1 truncate rounded px-1 text-left text-[11px] leading-tight text-foreground transition-colors hover:bg-muted"
        >
          <span className="h-2.5 w-0.5 shrink-0 rounded-sm bg-primary/50" />
          <span className="truncate">{occurrence.entry.title}</span>
        </button>
      ))}

      {extra > 0 ? (
        <button
          type="button"
          onClick={() => onSelectDay(iso)}
          className="flex min-h-6 items-center rounded px-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          +{extra} more
        </button>
      ) : null}

      {/* Empty space is an invitation to add, not a second way to select. */}
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add an event on ${format(fromISO(iso), "d MMMM")}`}
        className="min-h-6 flex-1 rounded transition-colors hover:bg-muted/60"
      />
    </div>
  );
}

/**
 * The month as an agenda, for a phone.
 *
 * Only days that hold something are listed. An empty Tuesday costs a screenful
 * of scrolling to say nothing, and a leader scanning a month on a phone is
 * looking for the days that are not empty.
 */
function MonthAgenda({
  anchor,
  today,
  keep,
  onOpenEntry,
  onAdd,
}: {
  anchor: string;
  today: string;
  keep: (occurrence: ScheduleOccurrence) => boolean;
  onOpenEntry: (occurrence: ScheduleOccurrence) => void;
  onAdd: (iso: string) => void;
}) {
  const { ministries } = useOrganization();
  const store = useSchedule();
  const myTasks = useMyMeetingTasks();
  const month = fromISO(anchor);
  const ministryName = (id: string | undefined) => ministries.find((m) => m.id === id)?.name;

  const days = monthGridDays(anchor)
    .filter((iso) => isSameMonth(fromISO(iso), month))
    .map((iso) => ({
      iso,
      occurrences: occurrencesOn(store.entries, iso).filter(keep),
      tasks: tasksForDay(iso, store.agenda, ministryName, myTasks.tasks),
    }))
    .filter((day) => day.occurrences.length > 0 || day.tasks.length > 0);

  return (
    <div className="lg:hidden">
      {days.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
          <CalendarDays className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-[14px]">Nothing scheduled in {monthLabel(anchor)}</p>
          <button
            type="button"
            onClick={() => onAdd(today)}
            className="mt-2 inline-flex min-h-8 items-center gap-1 text-[13px] text-primary transition-colors hover:text-primary/80"
          >
            <Plus className="size-3.5" aria-hidden />
            Add an event
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {days.map((day) => (
            <li
              key={day.iso}
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className="min-w-0 truncate text-[13px] font-medium">
                  {format(fromISO(day.iso), "EEEE d MMMM")}
                  {day.iso === today ? (
                    <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
                      Today
                    </span>
                  ) : null}
                </h2>
                <button
                  type="button"
                  onClick={() => onAdd(day.iso)}
                  aria-label={`Add an event on ${format(fromISO(day.iso), "d MMMM")}`}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Plus className="size-4" aria-hidden />
                </button>
              </div>

              <ul className="divide-y divide-border">
                {day.occurrences.map((occurrence) => {
                  const ministry = ministries.find((m) => m.id === occurrence.entry.ministryId);
                  return (
                    <li key={occurrence.key}>
                      <button
                        type="button"
                        onClick={() => onOpenEntry(occurrence)}
                        className="flex w-full min-h-11 items-baseline gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                      >
                        <span className="w-16 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                          {occurrence.entry.allDay || !occurrence.entry.startTime
                            ? "All day"
                            : formatTime(occurrence.entry.startTime)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px]">
                            {occurrence.entry.title}
                          </span>
                          {ministry ? (
                            <span className="block truncate text-[12px] text-muted-foreground">
                              {ministry.name}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {day.tasks.length > 0 ? (
                <div className="border-t border-border px-3 py-2">
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Tasks
                  </h3>
                  <ul className="mt-1 space-y-1">
                    {day.tasks.map((item) => (
                      <PanelTask key={item.id} item={item} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The selected day, in full — month → day → entry. */
function DayPanel({
  iso,
  keep,
  onOpenEntry,
  onAdd,
}: {
  iso: string;
  keep: (occurrence: ScheduleOccurrence) => boolean;
  onOpenEntry: (occurrence: ScheduleOccurrence) => void;
  onAdd: () => void;
}) {
  const { ministries } = useOrganization();
  const store = useSchedule();
  const myTasks = useMyMeetingTasks();
  const occurrences = occurrencesOn(store.entries, iso).filter(keep);
  const tasks = tasksForDay(
    iso,
    store.agenda,
    (id) => ministries.find((m) => m.id === id)?.name,
    myTasks.tasks,
  );

  return (
    <aside className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-[14px] font-medium">{format(fromISO(iso), "EEEE")}</h2>
        <p className="text-[12px] text-muted-foreground">
          {format(fromISO(iso), "d MMMM")} ·{" "}
          {occurrences.length === 0
            ? "nothing scheduled"
            : `${occurrences.length} ${occurrences.length === 1 ? "item" : "items"}`}
        </p>
      </header>

      <div className="px-4 py-3">
        {occurrences.length > 0 ? (
          <ul className="space-y-0.5">
            {occurrences.map((occurrence) => {
              const ministry = ministries.find((m) => m.id === occurrence.entry.ministryId);
              return (
                <li key={occurrence.key}>
                  <button
                    type="button"
                    onClick={() => onOpenEntry(occurrence)}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
                  >
                    <span className="w-14 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {occurrence.entry.allDay || !occurrence.entry.startTime
                        ? "All day"
                        : formatTime(occurrence.entry.startTime)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{occurrence.entry.title}</span>
                      {ministry ? (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {ministry.name}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Nothing scheduled.</p>
        )}

        {tasks.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Tasks
            </p>
            <ul className="mt-1 space-y-1">
              {tasks.map((item) => (
                <PanelTask key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onAdd}
          className="mt-3 inline-flex items-center gap-1 text-[13px] text-primary transition-colors hover:text-primary/80"
        >
          <Plus className="size-3.5" aria-hidden />
          Add to {format(fromISO(iso), "d MMMM")}
        </button>
      </div>
    </aside>
  );
}

/**
 * A task on the day, from the agenda or from a meeting.
 *
 * The box completes it where it lives — the agenda item, or the meeting's own
 * task. The words open it there: an agenda item on the week, a meeting task in
 * its note when this leader may read the note. The month stays about events;
 * it does not become a second week.
 */
function PanelTask({ item }: { item: PlanningItem }) {
  const store = useSchedule();
  const { updateTask } = useMeetings();
  const href = planningHref(item);

  const toggle = () => {
    if (item.source.type === "agenda-item") void store.toggleAgenda(item.source.id);
    if (item.source.type === "meeting-task") {
      void updateTask(item.source.id, { status: item.completed ? "open" : "done" });
    }
  };

  return (
    <li className="flex min-h-6 items-start gap-2 py-0.5">
      <input
        type="checkbox"
        checked={item.completed}
        onChange={toggle}
        aria-label={item.completed ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
        className="mt-1 size-3.5 shrink-0 cursor-pointer accent-[var(--color-primary)]"
      />
      <Link
        to={href.to}
        {...(href.search ? { search: href.search } : {})}
        className="min-w-0 text-[12px] leading-relaxed underline-offset-2 hover:underline"
      >
        <span className={cn("block", item.completed && "text-muted-foreground line-through")}>
          {item.title}
        </span>
        {item.source.type === "meeting-task" && item.contextLabel ? (
          <span className="block text-[11px] text-muted-foreground">{item.contextLabel}</span>
        ) : null}
      </Link>
    </li>
  );
}
