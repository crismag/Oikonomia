import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSchedule } from "@/components/oikonomia/schedule-provider";
import { cn } from "@/lib/utils";
import { useOrganization } from "./organization-provider";
import { useLeadershipInbox } from "./escalation-provider";
import { useReports } from "./report-provider";
import { PersonName } from "./person";
import { escalationHref } from "@/domain/escalation";
import { planningTime, type PlanningItem } from "@/domain/planning";
import { shortDayLabel } from "@/domain/schedule";
import type { AgendaItem } from "@/domain/types";
import { formatDayMonth } from "@/domain/dates";

/**
 * One task, opened from wherever it was seen.
 *
 * Until now a task could be ticked and nothing else: clicking one in the list
 * or the calendar did nothing, because the only detail surface belonged to
 * scheduled entries. A task is a real record with a day, a ministry and words
 * somebody chose, and it deserved somewhere to be read and changed.
 *
 * What it shows is what a task **has** — including the ask it was put on the
 * week for, when there was one. There is no assignee, no priority and
 * no attachments here, because the binder's task has none of those — a
 * checklist item on the Weekly Agenda means the leader did it, and inventing
 * fields would be inventing a workflow nobody asked for.
 *
 * The rest of the day is shown beside it, which is the question a leader
 * actually has when they open one: what else is this sitting next to?
 */
export function TaskDetail({
  item,
  task,
  alsoThatDay,
  onClose,
  onOpenItem,
}: {
  item: PlanningItem;
  task: AgendaItem;
  /** Everything else on the same day. Context, never a second list. */
  alsoThatDay: PlanningItem[];
  onClose: () => void;
  onOpenItem: (item: PlanningItem) => void;
}) {
  const { ministries } = useOrganization();
  const store = useSchedule();
  const [text, setText] = useState<string | null>(null);
  const ministry = ministries.find((m) => m.id === task.ministryId);

  const save = () => {
    if (text !== null && text.trim() && text !== task.text) {
      void store.updateAgenda(task.id, { text: text.trim() });
    }
    setText(null);
  };

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-[20px] leading-tight">
            <input
              value={text ?? task.text}
              onChange={(e) => setText(e.target.value)}
              onBlur={save}
              aria-label="What needs doing"
              className="w-full bg-transparent outline-none"
            />
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            {task.date ? shortDayLabel(task.date) : "This week"}
            {ministry ? ` · ${ministry.name}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-[14px]">
          <button
            type="button"
            onClick={() => void store.toggleAgenda(task.id)}
            aria-pressed={task.completed}
            className="flex items-center gap-2.5 text-left"
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                task.completed
                  ? "border-status-done bg-status-done text-white"
                  : "border-border-strong",
              )}
            >
              {task.completed ? <Check className="size-3" aria-hidden /> : null}
            </span>
            <span className="text-[13px]">{task.completed ? "Done" : "Mark done"}</span>
          </button>

          {/*
           * A task filed to the week rather than to a day is the binder's NOTE
           * area, and it is worth saying so — it is not a task somebody forgot
           * to date.
           */}
          {!task.date ? (
            <p className="text-[13px] text-muted-foreground">
              Filed to the week rather than to a day — it prints in the NOTE box.
            </p>
          ) : null}

          {task.escalationId ? <FromAnAsk escalationId={task.escalationId} /> : null}
          {task.reportId ? <FromYourReport reportId={task.reportId} /> : null}

          {alsoThatDay.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                Also that day
              </p>
              <ul className="space-y-1">
                {alsoThatDay.map((other) => {
                  const time = planningTime(other);
                  return (
                    <li key={other.id}>
                      <button
                        type="button"
                        onClick={() => onOpenItem(other)}
                        className="block w-full text-left text-[13px] hover:underline"
                      >
                        {time ? <span className="text-muted-foreground">{time} </span> : null}
                        <span
                          className={cn(other.completed && "text-muted-foreground line-through")}
                        >
                          {other.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => {
              void store.removeAgenda(task.id);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-status-overdue"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remove
          </button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** "11 September" — how the drawer names the day it is about. */
export const taskDayLabel = (iso: string) => formatDayMonth(iso);

/**
 * Where a task put on the week for an ask came from.
 *
 * Read from this leader's own inbox, so it only ever names an ask that was
 * made of them and is still open. Once the ask is settled the task is simply
 * the leader's record of what they meant to do, and says no more.
 */
function FromAnAsk({ escalationId }: { escalationId: string }) {
  const inbox = useLeadershipInbox();
  const ask = inbox.mine.find((item) => item.id === escalationId);
  if (!ask) return null;
  const href = escalationHref(ask.sourceType, ask.sourceId);

  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-[13px]">
      <p className="text-muted-foreground">
        Put on your week for something <PersonName personId={ask.requestedById} /> asked of you
        {ask.contextLabel ? ` · ${ask.contextLabel}` : ""}.
      </p>
      {href ? (
        <Link
          to={href.to}
          {...(href.search ? { search: href.search } : {})}
          className="mt-1 inline-flex font-medium text-primary underline-offset-2 hover:underline"
        >
          Open where it was asked
        </Link>
      ) : null}
    </div>
  );
}

/** The report whose follow-up this was, while this leader may still read it. */
function FromYourReport({ reportId }: { reportId: string }) {
  const reports = useReports();
  const report = reports.byId(reportId);
  if (!report) return null;

  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-[13px]">
      <p className="text-muted-foreground">A follow-up from your report.</p>
      <Link
        to="/leadership-reports/$reportId"
        params={{ reportId: report.id }}
        className="mt-1 inline-flex font-medium text-primary underline-offset-2 hover:underline"
      >
        {report.title || "Untitled report"}
      </Link>
    </div>
  );
}
