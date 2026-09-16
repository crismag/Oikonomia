import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/oikonomia/combobox";
import { errorMessage, fieldErrors } from "@/lib/calendar-client";
import { cn } from "@/lib/utils";
import { useOrganization } from "./organization-provider";
import { recurrenceFrequencies, recurrenceLabel, shortDayLabel } from "@/domain/schedule";
import type {
  RecurrenceFrequency,
  RecurrenceScope,
  ScheduleCategory,
  ScheduleEntry,
} from "@/domain/types";
import { useSchedule } from "./schedule-provider";

/**
 * Creating and editing a calendar entry.
 *
 * A title and a date are enough. Everything else — a time, a place, people, a
 * rhythm — is offered underneath and never demanded, because "Friday, 7:30,
 * CHAT" is a complete thought and the editor should not argue with it.
 *
 * What is deliberately *not* offered is a reminder. See below.
 */

export function EntryEditor({
  entry,
  date,
  occurrenceDate,
  onDone,
  onCancel,
}: {
  /** Present when editing; absent when creating. */
  entry?: ScheduleEntry;
  /** The day a new entry lands on. */
  date?: string;
  /** Which occurrence of a repeating entry was opened. */
  occurrenceDate?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { ministries, people } = useOrganization();
  const store = useSchedule();

  const [title, setTitle] = useState(entry?.title ?? "");
  const [when, setWhen] = useState(entry?.date ?? occurrenceDate ?? date ?? "");
  const [startTime, setStartTime] = useState(entry?.startTime ?? "");
  const [endTime, setEndTime] = useState(entry?.endTime ?? "");
  const [allDay, setAllDay] = useState(entry?.allDay ?? false);
  const [note, setNote] = useState(entry?.note ?? "");
  const [location, setLocation] = useState(entry?.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(entry?.meetingUrl ?? "");
  const [ministryId, setMinistryId] = useState(entry?.ministryId ?? "");
  const [participantIds, setParticipantIds] = useState<string[]>(entry?.participantIds ?? []);
  const [frequency, setFrequency] = useState<RecurrenceFrequency | "">(
    entry?.recurrence?.frequency ?? "",
  );
  const [scope, setScope] = useState<RecurrenceScope>("occurrence");
  const [more, setMore] = useState(!!entry);
  /* A save that failed must leave the form open with what was typed still in
     it — §20. Closing first and reporting afterwards loses the leader's work. */
  const [failure, setFailure] = useState<unknown>(null);

  const repeating = !!entry?.recurrence;
  const relatedName = ministries.find((m) => m.id === ministryId)?.name ?? "";

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed || !when) return;
    setFailure(null);

    const shape = {
      title: trimmed,
      category: (entry?.category ?? "other") as ScheduleCategory,
      ...(allDay ? { allDay: true } : {}),
      ...(!allDay && startTime ? { startTime } : {}),
      ...(!allDay && endTime ? { endTime } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(meetingUrl.trim() ? { meetingUrl: meetingUrl.trim() } : {}),
      ...(ministryId ? { ministryId } : {}),
      ...(participantIds.length > 0 ? { participantIds } : {}),
      ...(frequency
        ? {
            recurrence: {
              frequency,
              from: when,
              ...(entry?.recurrence?.skip ? { skip: entry.recurrence.skip } : {}),
            },
          }
        : { date: when }),
    };

    try {
      if (entry)
        await store.editOccurrence(
          entry.id,
          occurrenceDate ?? when,
          repeating ? scope : "series",
          shape,
        );
      else await store.addEntry({ ...shape, source: "leader" } as Omit<ScheduleEntry, "id">);
      onDone();
    } catch (error) {
      setFailure(error);
    }
  };

  /* The server is authoritative, so its messages win over the form's. */
  const serverFields = fieldErrors(failure);

  return (
    <div className="mt-4 space-y-3">
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          placeholder="CHAT"
          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-ring"
        />
      </label>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Date</span>
          <input
            type="date"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ring"
          />
        </label>

        {!allDay ? (
          <>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                Start
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ring"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted-foreground">End</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ring"
              />
            </label>
          </>
        ) : null}

        <label className="flex items-center gap-1.5 pb-1.5 text-[13px]">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="size-3.5 accent-[var(--color-primary)]"
          />
          All day
        </label>
      </div>

      {!more ? (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="text-[13px] text-primary transition-colors hover:text-primary/80"
        >
          More options
        </button>
      ) : (
        <div className="space-y-3 border-t border-border pt-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Description
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="What is this for?"
              className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] leading-relaxed outline-none focus:border-ring"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Location or meeting link
            </span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="SC Church, a phone call, Messenger…"
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Meeting link
            </span>
            <input
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
            />
          </label>

          <div className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Related to
            </span>
            <Combobox
              label="What this relates to"
              value={relatedName}
              placeholder="Nothing in particular"
              width="w-full"
              suggestions={ministries.map((m) => ({
                id: m.id,
                label: m.name,
                group: "Ministries",
              }))}
              onChange={(_text, id) => setMinistryId(id ?? "")}
            />
          </div>

          <div className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              Repeats
            </span>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency | "")}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ring"
            >
              <option value="">Does not repeat</option>
              {recurrenceFrequencies.map((option) => (
                <option key={option} value={option}>
                  {recurrenceLabel[option]}
                </option>
              ))}
            </select>
          </div>

          {/*
           * No reminder picker.
           *
           * The field is in the model and the column is in the database, but
           * nothing sends a reminder and §37 lists notification
           * infrastructure as a stop condition. A control that promises to
           * remind a leader and then does not is worse than no control, so
           * it is not offered until something can keep the promise.
           */}

          <div className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">People</span>
            <div className="flex flex-wrap gap-1.5">
              {people.slice(0, 8).map((candidate) => {
                const on = participantIds.includes(candidate.id);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() =>
                      setParticipantIds((current) =>
                        on
                          ? current.filter((id) => id !== candidate.id)
                          : [...current, candidate.id],
                      )
                    }
                    aria-pressed={on}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[12px] transition-colors",
                      on
                        ? "border-primary/30 bg-area-soft text-area-ink"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {candidate.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/*
       * Editing one occurrence of a rhythm must say how far the change reaches,
       * or a corrected time silently rewrites months of history.
       */}
      {repeating ? (
        <fieldset className="rounded-xl border border-border bg-surface-muted px-3 py-2.5">
          <legend className="px-1 text-[12px] font-medium text-muted-foreground">
            This entry repeats
          </legend>
          {(
            [
              ["occurrence", "This occurrence"],
              ["following", "This and following"],
              ["series", "The whole series"],
            ] as [RecurrenceScope, string][]
          ).map(([option, label]) => (
            <label key={option} className="flex items-center gap-2 py-0.5 text-[13px]">
              <input
                type="radio"
                name="recurrence-scope"
                checked={scope === option}
                onChange={() => setScope(option)}
                className="accent-[var(--color-primary)]"
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-status-overdue/35 bg-status-overdue-soft px-3 py-2"
        >
          <p className="text-[13px] text-status-overdue">{errorMessage(failure)}</p>
          {Object.entries(serverFields).map(([field, message]) => (
            <p key={field} className="mt-0.5 text-[12px] text-status-overdue">
              {message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!title.trim() || !when || store.saving}
          busy={store.saving}
          variant="primary"
        >
          {entry ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The fast path.
 *
 * Clicking a day should not open a form. A title and a time are usually the
 * whole thought; anything more is one click away.
 */
export function QuickAdd({ date, onDone }: { date: string; onDone: () => void }) {
  const store = useSchedule();
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [full, setFull] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  if (full) {
    return <EntryEditor date={date} onDone={onDone} onCancel={onDone} />;
  }

  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setFailure(null);
    try {
      await store.addEntry({
        title: trimmed,
        date,
        category: "other",
        source: "leader",
        ...(time ? { startTime: time } : {}),
      } as Omit<ScheduleEntry, "id">);
      onDone();
    } catch (error) {
      setFailure(error);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <p className="text-[13px] text-muted-foreground">Add to {shortDayLabel(date)}</p>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void add();
        }}
        autoFocus
        placeholder="What is happening?"
        aria-label="Title"
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-ring"
      />

      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        Time
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-ring"
        />
      </label>

      {failure ? (
        <p role="alert" className="text-[13px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setFull(true)}
          className="inline-flex min-h-6 items-center text-[13px] text-primary transition-colors hover:text-primary/80"
        >
          More options
        </button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void add()}
            disabled={!title.trim() || store.saving}
            busy={store.saving}
            variant="primary"
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
