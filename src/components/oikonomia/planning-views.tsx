import { Check, MapPin, Repeat } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  planningKindLabel,
  planningTime,
  type PlanningGroupResult,
  type PlanningItem,
} from "@/domain/planning";
import { dayNumber, fromISO, shortDayLabel } from "@/domain/schedule";
import { format } from "date-fns";

/**
 * The views. All three read the same projected items.
 *
 * Nothing here holds records of its own, and nothing constructs a planning item
 * — they arrive shaped, already filtered and grouped, so switching view cannot
 * change what exists. That is the whole architectural point of the workspace:
 * the record is not the view.
 */

const kindTone: Record<PlanningItem["kind"], string> = {
  task: "text-foreground",
  event: "text-foreground",
  gathering: "text-foreground",
  activity: "text-foreground",
  information: "text-muted-foreground",
};

/**
 * One line of planning information.
 *
 * A task gets a box to tick; nothing else does, because ticking is what a task
 * means. Everything keeps its kind in words so the row is not relying on where
 * it happens to sit to say what it is.
 */
export function PlanningRow({
  item,
  onOpen,
  onToggle,
  showDate,
  showKind = true,
}: {
  item: PlanningItem;
  onOpen: (item: PlanningItem) => void;
  onToggle?: (item: PlanningItem) => void;
  showDate?: boolean;
  showKind?: boolean;
}) {
  const time = planningTime(item);

  return (
    <li className="group flex items-start gap-2.5 px-1 py-1.5">
      {item.may.complete && onToggle ? (
        <button
          type="button"
          onClick={() => onToggle(item)}
          aria-pressed={!!item.completed}
          aria-label={
            item.completed ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`
          }
          className={cn(
            "mt-[3px] flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
            item.completed
              ? "border-status-done bg-status-done text-white"
              : "border-border-strong hover:border-foreground",
          )}
        >
          {item.completed ? <Check className="size-3" aria-hidden /> : null}
        </button>
      ) : (
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
      )}

      <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            "block text-[14px] leading-snug",
            kindTone[item.kind],
            /* Finished work stays on the week — it is part of the record of
               what happened — but stops competing for attention. */
            item.completed && "text-muted-foreground line-through",
          )}
        >
          {item.title}
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted-foreground">
          {showDate ? <span>{format(fromISO(item.date), "d MMM")}</span> : null}
          {time ? <span>{time}</span> : null}
          {showKind ? <span>{planningKindLabel[item.kind]}</span> : null}
          {item.contextLabel ? <span>{item.contextLabel}</span> : null}
          {item.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {item.location}
            </span>
          ) : null}
          {item.recurring ? (
            <span className="inline-flex items-center gap-1">
              <Repeat className="size-3" aria-hidden />
              <span className="sr-only">Repeats</span>
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/**
 * The list. Grouped however the leader asked, and nothing more.
 *
 * No enclosing card: the workspace is the surface, and a heading plus a rule
 * separates a group more quietly than a border around everything.
 */
export function PlanningList({
  groups,
  onOpen,
  onToggle,
  showDate = true,
}: {
  groups: PlanningGroupResult[];
  onOpen: (item: PlanningItem) => void;
  onToggle: (item: PlanningItem) => void;
  showDate?: boolean;
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
            <span className="font-normal normal-case tracking-normal">{group.items.length}</span>
          </h3>
          <ul>
            {group.items.map((item) => (
              <PlanningRow
                key={item.id}
                item={item}
                onOpen={onOpen}
                onToggle={onToggle}
                showDate={showDate}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The week, as days across.
 *
 * The same items the agenda and the list are showing, arranged by when. Below
 * `md` it stacks: seven columns on a phone is a grid nobody can read, and
 * squeezing one in is worse than showing the days in order.
 */
export function WeekCalendar({
  days,
  itemsByDay,
  today,
  onOpen,
}: {
  days: string[];
  itemsByDay: (iso: string) => PlanningItem[];
  today: string;
  onOpen: (item: PlanningItem) => void;
}) {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-7">
      {days.map((iso) => {
        const items = itemsByDay(iso);
        const isToday = iso === today;

        return (
          <div
            key={iso}
            className={cn("min-h-[140px] bg-surface p-2", isToday && "bg-accent-soft")}
          >
            <p className="mb-1.5 flex items-baseline gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {format(fromISO(iso), "EEE")}
              </span>
              <span className={cn("text-[14px]", isToday && "font-medium")}>{dayNumber(iso)}</span>
              {isToday ? <span className="sr-only">Today</span> : null}
            </p>

            {items.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => {
                  const time = planningTime(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(item)}
                        className="block w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-muted"
                      >
                        <span
                          className={cn(
                            "block truncate text-[12px]",
                            item.completed && "text-muted-foreground line-through",
                          )}
                        >
                          {/* The kind reaches a screen reader even where the
                              row is too narrow to spell it out. */}
                          <span className="sr-only">{planningKindLabel[item.kind]}: </span>
                          {time ? <span className="text-muted-foreground">{time} </span> : null}
                          {item.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A day's heading in the agenda, the way the binder writes it. */
export const agendaDayLabel = (iso: string) => shortDayLabel(iso);
