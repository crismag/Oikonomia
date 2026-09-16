import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, MapPin, Plus, Printer, Repeat } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/oikonomia/async-state";
import { EntryDetail } from "@/components/oikonomia/entry-detail";
import { QuickAdd } from "@/components/oikonomia/entry-editor";
import { useOverlay } from "@/components/oikonomia/overlay";
import { Page, PageHeader } from "@/components/oikonomia/page";
import {
  MenuOption,
  PeriodNav,
  ViewError,
  WorkspaceMenu,
  WorkspaceSearch,
  WorkspaceTabs,
} from "@/components/oikonomia/workspace";
import { PlanningList, WeekCalendar } from "@/components/oikonomia/planning-views";
import { AgendaSheet, weekOfLabel } from "@/components/oikonomia/agenda-sheet";
import { TaskDetail } from "@/components/oikonomia/task-detail";
import {
  completionFor,
  filterPlanning,
  groupPlanning,
  planningForDay,
  planningForDays,
  planningKindLabel,
  sortPlanning,
  type MeetingTaskEntry,
  type PlanningGroup,
  type PlanningItem,
  type PlanningKind,
} from "@/domain/planning";
import { CalendarState, useCalendarPeriod } from "@/components/oikonomia/calendar-period";
import { useSchedule } from "@/components/oikonomia/schedule-provider";
import { useMeetings, useMyMeetingTasks } from "@/components/oikonomia/meeting-provider";
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
  agendaOn,
  dayLabel,
  formatTime,
  fromISO,
  notesForWeek,
  occurrencesOn,
  shiftWeek,
  shortDayLabel,
  toISO,
  weekDays,
  weekLabel,
  weekOf,
} from "@/domain/schedule";
import { format } from "date-fns";
import type { AgendaItem, ScheduleOccurrence } from "@/domain/types";

export const Route = createFileRoute("/weekly-agenda")({
  /*
   * The view and the week both live in the URL, so a workspace can be linked
   * to and Back returns to the view the leader was in rather than the default.
   */
  validateSearch: (
    search: Record<string, unknown>,
  ): { date?: string; view?: WorkspaceView; print?: true; open?: string } => {
    const views: WorkspaceView[] = ["agenda", "list", "calendar"];
    const view = views.includes(search["view"] as WorkspaceView)
      ? (search["view"] as WorkspaceView)
      : undefined;
    return {
      ...(typeof search["date"] === "string" ? { date: search["date"] } : {}),
      ...(view ? { view } : {}),
      ...(search["print"] ? { print: true as const } : {}),
      ...(typeof search["open"] === "string" && search["open"] ? { open: search["open"] } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Weekly Agenda — Oikonomia" },
      {
        name: "description",
        content: "What is happening this week, and what to do about it.",
      },
    ],
  }),
  component: WeeklyAgendaPage,
});

/** Three ways of looking at one week. Views belong to the workspace. */
type WorkspaceView = "agenda" | "list" | "calendar";

const groupLabel: Record<PlanningGroup, string> = {
  day: "Day",
  context: "Ministry",
  kind: "Type",
  status: "Status",
};

/**
 * What the filter menu says about itself.
 *
 * A control that has been changed and does not say so is how a leader comes to
 * believe the workspace is hiding things at random.
 */
function kindFilterLabel(kind: PlanningKind | null, hideCompleted: boolean): string | undefined {
  if (kind && hideCompleted) return `${planningKindLabel[kind]}, unfinished`;
  if (kind) return planningKindLabel[kind];
  if (hideCompleted) return "Unfinished";
  return undefined;
}

/**
 * Weekly Agenda — the leader's operational week.
 *
 * Deliberately **not** the month grid. Monthly Calendar tells the leader when
 * things happen; this helps them run the week, so it reads as a list they can
 * work down rather than cells they must decipher: each day in order, all-day
 * items above timed ones, and the things to *do* beneath what is scheduled.
 */
function WeeklyAgendaPage() {
  const { ministries } = useOrganization();
  const { date, view = "agenda", print, open } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const opened = useRef<string | null>(null);

  const today = toISO(new Date());
  const anchor = date ?? today;
  const days = weekDays(anchor);

  /* Tells the provider which week to fetch, so moving weeks moves the data. */
  const store = useCalendarPeriod(days);
  /* Tasks a meeting gave this leader. The same records, in their week. */
  const myTasks = useMyMeetingTasks();

  const detail = useOverlay<ScheduleOccurrence>();
  /* A task is a record too, and until now clicking one did nothing. */
  const taskDetail = useOverlay<PlanningItem>();
  const adding = useOverlay<string>();

  const go = (next: string) =>
    navigate({ search: (prev) => ({ ...prev, date: next }), replace: true });
  const setView = (next: WorkspaceView) =>
    navigate({ search: (prev) => ({ ...prev, view: next }), replace: true });

  /* Narrowing and rearranging are about what is on screen, not about the
     records, so they stay in component state rather than in the URL. */
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<PlanningKind | null>(null);
  const [group, setGroup] = useState<PlanningGroup>("day");
  const [hideCompleted, setHideCompleted] = useState(false);

  const ministryName = (id: string | undefined) =>
    id ? ministries.find((m) => m.id === id)?.name : undefined;

  /*
   * One projection, three views. Nothing below builds planning information of
   * its own, so switching view cannot change what exists.
   */
  const shaped = (items: PlanningItem[]) =>
    sortPlanning(
      filterPlanning(items, {
        ...(kind ? { kinds: [kind] } : {}),
        ...(hideCompleted ? { hideCompleted } : {}),
        ...(search.trim() ? { search } : {}),
      }),
      "time",
    );

  const weekItems = shaped(
    planningForDays(days, store.entries, store.agenda, ministryName, myTasks.tasks),
  );
  const dayItems = (iso: string) =>
    shaped(planningForDay(iso, store.entries, store.agenda, ministryName, myTasks.tasks));

  const openItem = (item: PlanningItem) => {
    /*
     * Back to the record, never to a copy of it. A projected item carries the
     * source it came from, which is what makes opening one possible at all —
     * and which of the two detail surfaces it belongs to.
     *
     * A meeting task is a piece of a note: opening it on this page used to do
     * nothing, which is how a leader saw work on their week and could not
     * reach the conversation that produced it.
     */
    if (item.source.type === "meeting-task") {
      /* Only a note this leader may read is named; the item is already on
         this page otherwise. */
      const meetingId = item.source.relatedId;
      if (meetingId) {
        void navigate({ to: "/meeting-notes", search: { note: meetingId } });
      }
      return;
    }
    if (item.source.type === "agenda-item") {
      taskDetail.open(item);
      return;
    }
    if (item.source.type !== "schedule-entry") return;
    const entry = store.entries.find((e) => e.id === item.source.id);
    if (!entry) return;
    detail.open({
      key: item.id,
      entry,
      date: item.date,
      recurring: item.recurring,
    });
  };

  /*
   * Home (and anything else) can name an item in the URL. Open it once the
   * week is loaded, and only once — `opened` is what prevents a second open
   * when the projected list is a new array.
   */
  useEffect(() => {
    if (!open || store.status === "loading") return;
    if (opened.current === open) return;
    const item = weekItems.find((candidate) => candidate.id === open);
    if (!item) return;
    opened.current = open;
    openItem(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, store.status, weekItems]);

  /** The rest of the day, for context inside a drawer. */
  const openTask = taskDetail.value
    ? store.agenda.find((a) => a.id === taskDetail.value!.source.id)
    : undefined;

  /* The same box as the Agenda view's and the month's, so it completes a
     meeting task too — in the meeting, where the task lives. */
  const { updateTask } = useMeetings();
  const toggleItem = (item: PlanningItem) => {
    const completion = completionFor(item);
    if (completion?.kind === "agenda-item") void store.toggleAgenda(completion.id);
    if (completion?.kind === "meeting-task") {
      void updateTask(completion.id, { status: completion.status });
    }
  };
  const notes = notesForWeek(store.agenda, anchor);

  /*
   * Whether the week has anything on it.
   *
   * Counts meeting tasks as well as the schedule: a week whose only entry is
   * something a meeting asked of this leader is not an empty week, and telling
   * them "nothing scheduled" while they owe somebody a venue by Saturday is
   * the page contradicting itself.
   */
  const busy = days.some((iso) => dayItems(iso).length > 0);

  /*
   * The binder page this collection came from.
   *
   * Not a styled screenshot of the workspace: the physical Weekly Agenda has
   * its own shape — Monday to Saturday in two rows of three, Sunday beside the
   * week's NOTE box — and a leader taking this to a meeting should recognize
   * the page they already keep.
   */
  if (print) {
    return (
      <Page width="regular">
        <div data-print="hide" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/weekly-agenda"
            search={{ date: anchor }}
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Back to the week
          </Link>
          <Button type="button" onClick={() => window.print()} variant="primary">
            <Printer className="size-3.5" aria-hidden />
            Print
          </Button>
        </div>

        <AgendaSheet
          days={days}
          itemsByDay={dayItems}
          notes={notes}
          monthLabel={format(fromISO(anchor), "MMMM")}
          weekOfLabel={weekOfLabel(days[0]!)}
        />
      </Page>
    );
  }

  return (
    <Page width="workspace">
      <PageHeader title="Weekly Agenda" description={weekLabel(anchor)} />

      {/*
       * The workspace toolbar. Only creation is emphasized; everything that
       * rearranges what is already on screen is a quiet control, because a row
       * of primary buttons is a row nobody reads.
       */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border pb-3">
        <WorkspaceTabs
          label="Weekly Agenda views"
          active={view}
          onChange={setView}
          views={[
            { id: "agenda" as const, label: "Agenda" },
            { id: "list" as const, label: "List" },
            { id: "calendar" as const, label: "Calendar" },
          ]}
        />

        {/* The other view of the same calendar, keeping the week you are in. */}
        <Link
          to="/monthly-calendar"
          search={{ date: anchor }}
          className="rounded-md border border-border px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Month
        </Link>

        <PeriodNav
          unit="week"
          label={weekLabel(anchor)}
          onPrevious={() => go(shiftWeek(anchor, -1))}
          onToday={() => go(today)}
          onNext={() => go(shiftWeek(anchor, 1))}
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <WorkspaceSearch value={search} onChange={setSearch} />

          {/* The binder page this collection came from. */}
          <Link
            to="/weekly-agenda"
            search={{ date: anchor, print: true as const }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Printer className="size-3.5" aria-hidden />
            Printable page
          </Link>

          <WorkspaceMenu label="Filter" active={kindFilterLabel(kind, hideCompleted)}>
            {(close) => (
              <>
                <MenuOption
                  selected={kind === null}
                  onSelect={() => {
                    setKind(null);
                    close();
                  }}
                >
                  Everything
                </MenuOption>
                {(["task", "event", "gathering", "activity", "information"] as PlanningKind[]).map(
                  (option) => (
                    <MenuOption
                      key={option}
                      selected={kind === option}
                      onSelect={() => {
                        setKind(option);
                        close();
                      }}
                    >
                      {planningKindLabel[option]}
                    </MenuOption>
                  ),
                )}
                <div className="my-1 h-px bg-border" />
                {/* Finished work is part of the record of the week, so it is
                    hidden only on request. */}
                <MenuOption
                  selected={hideCompleted}
                  onSelect={() => {
                    setHideCompleted(!hideCompleted);
                    close();
                  }}
                >
                  Hide completed
                </MenuOption>
              </>
            )}
          </WorkspaceMenu>

          {view === "list" ? (
            <WorkspaceMenu label="Group" active={groupLabel[group]}>
              {(close) => (
                <>
                  {(["day", "context", "kind", "status"] as PlanningGroup[]).map((option) => (
                    <MenuOption
                      key={option}
                      selected={group === option}
                      onSelect={() => {
                        setGroup(option);
                        close();
                      }}
                    >
                      {groupLabel[option]}
                    </MenuOption>
                  ))}
                </>
              )}
            </WorkspaceMenu>
          ) : null}

          <Button
            type="button"
            onClick={() => adding.open(today >= days[0]! && today <= days[6]! ? today : days[0]!)}
            variant="primary"
          >
            <Plus className="size-3.5" aria-hidden />
            Add
          </Button>
        </div>
      </div>

      {store.status === "error" ? (
        /* One workspace, not one apology: the tabs and the toolbar above stay
           usable, and only the view says it could not be drawn. */
        <ViewError what="This week" onRetry={store.retry} />
      ) : store.status === "loading" ? (
        <ListSkeleton rows={7} />
      ) : view === "agenda" ? (
        busy ? (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {days.map((iso) => (
              <Day
                key={iso}
                iso={iso}
                today={today}
                onOpen={detail.open}
                onAdd={() => adding.open(iso)}
              />
            ))}
          </div>
        ) : (
          /* Inline, not a page-sized empty state: what a leader needs here is
             the way to add the first thing, not a picture. */
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 py-6 text-[14px] text-muted-foreground">
            Nothing scheduled this week.
            <button
              type="button"
              onClick={() => adding.open(days[0]!)}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Add your first item
            </button>
          </p>
        )
      ) : view === "list" ? (
        weekItems.length > 0 ? (
          <PlanningList
            groups={groupPlanning(weekItems, group, (iso) => shortDayLabel(iso))}
            onOpen={openItem}
            onToggle={toggleItem}
            showDate={group !== "day"}
          />
        ) : (
          <p className="py-6 text-[14px] text-muted-foreground">
            Nothing matches what you are looking for.
          </p>
        )
      ) : (
        <WeekCalendar days={days} today={today} itemsByDay={dayItems} onOpen={openItem} />
      )}

      {/* The binder's notes area: belongs to the week, not to any one day. */}
      {notes.length > 0 ? (
        <section className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-2.5 text-[14px] font-medium">This week</h2>
          <ul className="space-y-1 px-4 py-3">
            {notes.map((item) => (
              <Task key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ) : null}

      <EntryDetail occurrence={detail.value} onClose={detail.close} />

      {taskDetail.value && openTask ? (
        <TaskDetail
          item={taskDetail.value}
          task={openTask}
          alsoThatDay={dayItems(taskDetail.value.date).filter(
            (other) => other.id !== taskDetail.value!.id,
          )}
          onClose={taskDetail.close}
          onOpenItem={(other) => {
            taskDetail.close();
            openItem(other);
          }}
        />
      ) : null}

      <Sheet open={adding.isOpen} onOpenChange={adding.onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-[20px]">New agenda item</SheetTitle>
            <SheetDescription className="sr-only">Add something to the week</SheetDescription>
          </SheetHeader>
          {adding.value ? <QuickAdd date={adding.value} onDone={adding.close} /> : null}
        </SheetContent>
      </Sheet>
    </Page>
  );
}

/**
 * One day of the week.
 *
 * Scheduled things first, then what the leader has to do about them — the
 * order the day is actually lived in.
 */
function Day({
  iso,
  today,
  onOpen,
  onAdd,
}: {
  iso: string;
  today: string;
  onOpen: (occurrence: ScheduleOccurrence) => void;
  onAdd: () => void;
}) {
  const store = useSchedule();
  /* Tasks a meeting gave this leader. The same records, in their week. */
  const myTasks = useMyMeetingTasks();
  const occurrences = occurrencesOn(store.entries, iso);
  const tasks = agendaOn(store.agenda, iso);
  /*
   * What a meeting asked of this leader, due on this day. The same task
   * record, shown in the week rather than only inside the meeting that
   * produced it — which is where it used to be findable and nowhere else.
   */
  const meetingTasks = myTasks.tasks.filter((entry) => entry.task.dueDate === iso);
  const isToday = iso === today;

  /* All-day items are not "at 00:00"; they belong above the clock. */
  const allDay = occurrences.filter((o) => o.entry.allDay || !o.entry.startTime);
  const timed = occurrences.filter((o) => !o.entry.allDay && o.entry.startTime);

  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-x-4 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)]",
        isToday && "bg-accent-soft/40",
      )}
    >
      <div className="mb-1.5 flex items-baseline gap-2 sm:mb-0 sm:block">
        <h2
          className={cn(
            "text-[13px] font-medium uppercase tracking-wide",
            isToday ? "text-sidebar-accent-foreground" : "text-muted-foreground",
          )}
        >
          {dayLabel(iso).slice(0, 3)} {format(fromISO(iso), "d")}
        </h2>
        {isToday ? (
          <span className="text-[11px] text-sidebar-accent-foreground sm:block">Today</span>
        ) : null}
      </div>

      <div className="min-w-0">
        {allDay.length === 0 &&
        timed.length === 0 &&
        tasks.length === 0 &&
        meetingTasks.length === 0 ? (
          <button
            type="button"
            onClick={onAdd}
            className="text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            No scheduled items
          </button>
        ) : null}

        {allDay.map((occurrence) => (
          <EntryLine key={occurrence.key} occurrence={occurrence} onOpen={onOpen} allDay />
        ))}
        {timed.map((occurrence) => (
          <EntryLine key={occurrence.key} occurrence={occurrence} onOpen={onOpen} />
        ))}

        {tasks.length > 0 || meetingTasks.length > 0 ? (
          <div className="mt-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              To do
            </p>
            <ul className="mt-1 space-y-1">
              {tasks.map((item) => (
                <Task key={item.id} item={item} />
              ))}
              {meetingTasks.map((entry) => (
                <MeetingTaskLine key={entry.task.id} entry={entry} />
              ))}
            </ul>
          </div>
        ) : null}

        {allDay.length > 0 || timed.length > 0 || tasks.length > 0 || meetingTasks.length > 0 ? (
          <button
            type="button"
            onClick={onAdd}
            className="mt-1 inline-flex min-h-6 items-center gap-1 rounded px-1 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3" aria-hidden />
            Add
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Every entry is clickable — clicking one opens it, never merely the day. */
function EntryLine({
  occurrence,
  onOpen,
  allDay,
}: {
  occurrence: ScheduleOccurrence;
  onOpen: (occurrence: ScheduleOccurrence) => void;
  allDay?: boolean;
}) {
  const { ministries } = useOrganization();
  const { entry } = occurrence;
  const ministry = ministries.find((m) => m.id === entry.ministryId);

  return (
    <button
      type="button"
      onClick={() => onOpen(occurrence)}
      className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
    >
      <span className="w-16 shrink-0 text-[12px] tabular-nums text-muted-foreground">
        {allDay ? "All day" : formatTime(entry.startTime ?? "")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">
          {entry.title}
          {occurrence.recurring ? (
            <Repeat className="ml-1.5 inline size-3 text-muted-foreground" aria-label="Repeats" />
          ) : null}
        </span>
        {ministry || entry.location ? (
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
            {ministry ? <span className="truncate">{ministry.name}</span> : null}
            {entry.location ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{entry.location}</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * A task.
 *
 * Ticking it means the leader did it. Nothing else happens: no report, no
 * approval, no notification.
 */
/**
 * A task a meeting gave this leader.
 *
 * Ticking it here completes the **meeting's** task — one record, seen in the
 * week. Where it came from is named only when they may read that meeting;
 * otherwise it says "From a meeting", because the responsibility is theirs to
 * know and the note is not.
 */
function MeetingTaskLine({ entry }: { entry: MeetingTaskEntry }) {
  const { updateTask } = useMeetings();
  const done = entry.task.status === "done";

  return (
    <li>
      <label className="flex min-h-6 cursor-pointer items-start gap-2 py-0.5">
        <input
          type="checkbox"
          checked={done}
          onChange={() => void updateTask(entry.task.id, { status: done ? "open" : "done" })}
          className="mt-1 size-3.5 shrink-0 accent-[var(--color-primary)]"
        />
        <span className="min-w-0">
          <span
            className={cn(
              "block text-[13px] leading-relaxed",
              done && "text-muted-foreground line-through",
            )}
          >
            {entry.task.title}
          </span>
          <span className="block text-[12px] text-muted-foreground">{entry.contextLabel}</span>
        </span>
      </label>
    </li>
  );
}

function Task({ item }: { item: AgendaItem }) {
  const store = useSchedule();
  return (
    <li>
      {/* The label is the target: a 14px box alone is neither hittable nor
          obviously connected to the text beside it. */}
      <label className="flex min-h-6 cursor-pointer items-start gap-2 py-0.5">
        <input
          type="checkbox"
          checked={item.completed}
          onChange={() => store.toggleAgenda(item.id)}
          className="mt-1 size-3.5 shrink-0 accent-[var(--color-primary)]"
        />
        <span
          className={cn(
            "text-[13px] leading-relaxed",
            item.completed && "text-muted-foreground line-through",
          )}
        >
          {item.text}
        </span>
      </label>
    </li>
  );
}
