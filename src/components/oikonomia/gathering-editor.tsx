import { useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/oikonomia/combobox";
import { errorMessage } from "@/lib/calendar-client";
import { useLifegroup } from "@/components/oikonomia/lifegroup-provider";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { useOrganization } from "./organization-provider";
import { canAssignGatheringLeaders } from "@/domain/authorize";
import { venueTypeLabel } from "@/domain/types";
import type { Gathering } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * Scheduling and amending a gathering.
 *
 * A gathering is when, where and who leads — and nothing else. Everything a
 * leader *records* about it (attendance, exhortation, sharing, summary) belongs
 * to the gathering's own page, because that is the account of what happened and
 * it must not be reachable from a form whose job is to move a date.
 *
 * There is deliberately no group here. A LifeGroup gathering is an occasion at
 * a venue, not a standing roster with a membership list — see
 * The venue is reused; it is never owned by a gathering.
 */
export function GatheringEditor({
  gathering,
  viewer,
  onDone,
  onCancel,
}: {
  /** Present when amending; absent when scheduling a new one. */
  gathering?: Gathering;
  viewer: Viewer;
  onDone: (gatheringId: string) => void;
  onCancel: () => void;
}) {
  const { people, venues } = useOrganization();
  const store = useLifegroup();
  const mayAssignOthers = canAssignGatheringLeaders(viewer);

  const [date, setDate] = useState(gathering?.date ?? "");
  const [startTime, setStartTime] = useState(gathering?.startTime ?? "");
  const [endTime, setEndTime] = useState(gathering?.endTime ?? "");
  const [venueId, setVenueId] = useState(gathering?.venueId ?? "");
  const [venueText, setVenueText] = useState(
    gathering ? (venues.find((v) => v.id === gathering.venueId)?.name ?? "") : "",
  );

  /*
   * A leader schedules gatherings they will lead, so they start on the list.
   * Only campus oversight can take themselves off it or add somebody else.
   */
  const [leaderIds, setLeaderIds] = useState<string[]>(
    gathering?.assignedLeaderIds ?? [viewer.person.id],
  );

  const [touched, setTouched] = useState(false);

  const problems = {
    ...(date ? {} : { date: "Pick the date this gathering meets." }),
    ...(venueId ? {} : { venue: "Choose where it meets." }),
    ...(leaderIds.length > 0 ? {} : { leaders: "A gathering needs someone leading it." }),
    ...(startTime && endTime && endTime <= startTime
      ? { endTime: "The end time is before the start." }
      : {}),
  };
  const ready = Object.keys(problems).length === 0;

  const [failure, setFailure] = useState<unknown>(null);

  const save = async () => {
    setTouched(true);
    if (!ready) return;
    setFailure(null);

    try {
      await saveGathering();
    } catch (error) {
      setFailure(error);
    }
  };

  /* Closing before the server agreed would tell a leader they had scheduled
     something that does not exist — §20. */
  const saveGathering = async () => {
    if (gathering) {
      await store.updateGathering(gathering.id, {
        date,
        venueId,
        assignedLeaderIds: leaderIds,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
      });
      onDone(gathering.id);
      return;
    }

    const id = await store.addGathering({
      date,
      venueId,
      assignedLeaderIds: leaderIds,
      createdBy: viewer.person.id,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
    });
    onDone(id);
  };

  const addLeader = (personId: string) =>
    setLeaderIds((current) => (current.includes(personId) ? current : [...current, personId]));

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Date" error={touched ? problems.date : undefined}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ring"
          />
        </Field>

        <Field label="Start">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ring"
          />
        </Field>

        <Field label="End" error={touched ? problems.endTime : undefined}>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-ring"
          />
        </Field>
      </div>

      <Field label="Where" error={touched ? problems.venue : undefined}>
        <Combobox
          label="Venue"
          value={venueText}
          placeholder="Baronia Residence, SC Church…"
          width="w-full"
          suggestions={venues.map((venue) => ({
            id: venue.id,
            label: venue.name,
            meta: venue.area,
            group: venueTypeLabel[venue.type],
          }))}
          onChange={(text, id) => {
            setVenueText(text);
            /* Only a chosen venue counts. A half-typed name is not a place. */
            setVenueId(id ?? "");
          }}
        />
      </Field>

      <div>
        <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
          Leading this gathering
        </span>

        <ul className="flex flex-wrap gap-1.5">
          {leaderIds.map((id) => (
            <li
              key={id}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pl-1 pr-1"
            >
              <PersonAvatar personId={id} size="sm" />
              <span className="text-[13px]">
                <PersonName personId={id} />
              </span>
              {mayAssignOthers ? (
                <button
                  type="button"
                  onClick={() => setLeaderIds((current) => current.filter((x) => x !== id))}
                  aria-label={`Remove ${people.find((p) => p.id === id)?.name ?? "leader"}`}
                  className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" aria-hidden />
                </button>
              ) : (
                <span className="pr-1.5" />
              )}
            </li>
          ))}
        </ul>

        {mayAssignOthers ? (
          <div className="mt-2">
            <Combobox
              label="Assign another leader"
              value=""
              placeholder="Add a leader…"
              width="w-full"
              suggestions={people
                .filter((person) => !leaderIds.includes(person.id))
                .map((person) => ({ id: person.id, label: person.name, meta: person.role }))}
              onChange={(_text, id) => {
                if (id) addLeader(id);
              }}
            />
          </div>
        ) : (
          /*
           * Not a disabled control — a leader who cannot reassign should not be
           * shown a reassignment box they can never use. They are told why, in
           * one sentence, and that is the whole of it.
           */
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            You are leading this gathering. Assigning someone else is a campus responsibility.
          </p>
        )}

        {touched && problems.leaders ? (
          <p className="mt-1.5 text-[12px] text-status-overdue">{problems.leaders}</p>
        ) : null}
      </div>

      {failure ? (
        <p role="alert" className="text-[13px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => void save()}
          disabled={store.saving}
          busy={store.saving}
        >
          {gathering ? "Save changes" : "Schedule gathering"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-status-overdue">{error}</span> : null}
    </label>
  );
}
