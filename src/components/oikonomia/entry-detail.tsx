import { useState } from "react";

import { errorMessage } from "@/lib/calendar-client";
import { canEdit } from "@/domain/authorize";
import { useViewer } from "@/domain/session";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink, MapPin, Pencil, Repeat, Trash2, Users, Video } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useOrganization } from "./organization-provider";
import { agendaOn, formatTime, recurrenceLabel, shortDayLabel } from "@/domain/schedule";
import type { RecurrenceScope, ScheduleOccurrence } from "@/domain/types";
import { EntryEditor } from "./entry-editor";
import { useSchedule } from "./schedule-provider";
import { formatWeekdayLong } from "@/domain/dates";

/**
 * One calendar entry, inspected without leaving the calendar.
 *
 * A drawer rather than a page because the leader is mid-scan: they clicked an
 * entry to find out what it is, and should be able to close it and carry on.
 * Editing opens in place; nothing here navigates away by itself.
 */
export function EntryDetail({
  occurrence,
  onClose,
}: {
  occurrence: ScheduleOccurrence | null;
  onClose: () => void;
}) {
  const { ministries, personById } = useOrganization();
  const store = useSchedule();
  const [editing, setEditing] = useState(false);
  const [confirmScope, setConfirmScope] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const viewer = useViewer();

  if (!occurrence) return null;
  const { entry, date } = occurrence;

  /*
   * Church-wide rhythms are not one leader's to change, so a leader who cannot
   * change this one is not shown controls that would refuse them. Duplicating
   * is not gated: a copy is a new entry, and it belongs to whoever made it.
   */
  const mayAmend = canEdit(viewer, { kind: "schedule-entry", entry });

  const ministry = ministries.find((m) => m.id === entry.ministryId);
  const tasks = agendaOn(store.agenda, date).filter((item) => item.relatedEntryId === entry.id);

  const close = () => {
    setEditing(false);
    setConfirmScope(false);
    onClose();
  };

  const when = entry.allDay
    ? "All day"
    : entry.startTime
      ? `${formatTime(entry.startTime)}${entry.endTime ? ` – ${formatTime(entry.endTime)}` : ""}`
      : "No set time";

  /* Close only once the server has actually removed it: closing first and
     failing afterwards would tell the leader a lie about their calendar. */
  const remove = async (scope: RecurrenceScope) => {
    setFailure(null);
    try {
      await store.removeOccurrence(entry.id, date, scope);
      close();
    } catch (error) {
      setFailure(error);
    }
  };

  const duplicate = async () => {
    setFailure(null);
    try {
      await store.duplicateEntry(entry.id, date);
      close();
    } catch (error) {
      setFailure(error);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : close())}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        {editing ? (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="font-display text-[20px]">Edit entry</SheetTitle>
              <SheetDescription className="sr-only">Change this calendar entry</SheetDescription>
            </SheetHeader>
            <EntryEditor
              entry={entry}
              occurrenceDate={date}
              onDone={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          </>
        ) : (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="font-display text-[20px] leading-tight">
                {entry.title}
              </SheetTitle>
              <SheetDescription className="text-[13px] text-muted-foreground">
                {formatWeekdayLong(date)} · {when}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-3 text-[14px]">
              {occurrence.recurring && entry.recurrence ? (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Repeat className="size-3.5 shrink-0" aria-hidden />
                  {recurrenceLabel[entry.recurrence.frequency]}
                </p>
              ) : null}

              {entry.location ? (
                <p className="flex items-center gap-2 text-[13px]">
                  <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {entry.location}
                </p>
              ) : null}

              {entry.meetingUrl ? (
                <a
                  href={entry.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-[13px] text-primary transition-colors hover:text-primary/80"
                >
                  <Video className="size-3.5 shrink-0" aria-hidden />
                  Join the meeting
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}

              {entry.note ? <p className="leading-relaxed text-foreground">{entry.note}</p> : null}

              {entry.participantIds && entry.participantIds.length > 0 ? (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Users className="size-3.5" aria-hidden />
                    People
                  </p>
                  <ul className="space-y-0.5 text-[13px]">
                    {entry.participantIds.map((id) => (
                      <li key={id}>{personById(id)?.name ?? "Unknown"}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Tasks are the leader's own; ticking one means it is done. */}
              <div>
                <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                  Tasks
                </p>
                {tasks.length > 0 ? (
                  <ul className="space-y-1">
                    {tasks.map((task) => (
                      <li key={task.id}>
                        <label className="flex min-h-6 cursor-pointer items-start gap-2 py-0.5">
                          <input
                            type="checkbox"
                            checked={task.completed}
                            onChange={() => store.toggleAgenda(task.id)}
                            className="mt-1 size-3.5 shrink-0 accent-[var(--color-primary)]"
                          />
                          <span
                            className={cn(
                              "text-[13px] leading-relaxed",
                              task.completed && "text-muted-foreground line-through",
                            )}
                          >
                            {task.text}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted-foreground">Nothing to do for this.</p>
                )}
                <AddTask entryId={entry.id} date={date} />
              </div>

              {ministry ? (
                <div>
                  <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                    Related
                  </p>
                  <Link
                    to="/ministries/$ministryId"
                    params={{ ministryId: ministry.id }}
                    className="text-[13px] text-primary transition-colors hover:text-primary/80"
                  >
                    {ministry.name} →
                  </Link>
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {mayAmend ? (
                <Button type="button" onClick={() => setEditing(true)} variant="secondary">
                  <Pencil className="size-3.5" aria-hidden />
                  Edit
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => void duplicate()}
                disabled={store.saving}
                busy={store.saving}
                variant="secondary"
              >
                <Copy className="size-3.5" aria-hidden />
                Duplicate
              </Button>
              {mayAmend ? (
                <button
                  type="button"
                  onClick={() => (entry.recurrence ? setConfirmScope(true) : void remove("series"))}
                  className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-status-overdue"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Delete
                </button>
              ) : null}
            </div>

            {/* Said once, plainly, instead of offering controls that refuse. */}
            {!mayAmend ? (
              <p className="mt-2 text-[12px] text-muted-foreground">
                This is part of the church&rsquo;s schedule, so it is not yours to change. You can
                still make your own copy of it.
              </p>
            ) : null}

            {failure ? (
              <p
                role="alert"
                className="mt-2 rounded-md border border-status-overdue/35 bg-status-overdue-soft px-3 py-2 text-[13px] text-status-overdue"
              >
                {errorMessage(failure)}
              </p>
            ) : null}

            {/*
             * A repeating entry cannot be deleted without saying how far the
             * deletion reaches — removing a whole rhythm because somebody
             * cancelled one week would be the wrong answer to a click.
             */}
            {confirmScope ? (
              <div className="mt-3 rounded-xl border border-border bg-surface-muted px-3.5 py-3">
                <p className="text-[13px] font-medium">This entry repeats.</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">What should be deleted?</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {(
                    [
                      ["occurrence", "This occurrence only"],
                      ["following", "This and everything after"],
                      ["series", "The whole series"],
                    ] as [RecurrenceScope, string][]
                  ).map(([scope, label]) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => void remove(scope)}
                      className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setConfirmScope(false)}
                    className="px-2.5 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Adding something to do about this entry, without leaving it. */
function AddTask({ entryId, date }: { entryId: string; date: string }) {
  const store = useSchedule();
  const [text, setText] = useState("");

  const add = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      await store.addAgenda({ text: value, date, relatedEntryId: entryId });
      /* Clear only on success, so a failed save does not eat what was typed. */
      setText("");
    } catch {
      /* The sheet's alert reports it; the text stays for another attempt. */
    }
  };

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="Add a task"
        aria-label={`Add a task for ${shortDayLabel(date)}`}
        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-ring"
      />
      {text.trim() ? (
        <button
          type="button"
          onClick={add}
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground"
        >
          Add
        </button>
      ) : null}
    </div>
  );
}
