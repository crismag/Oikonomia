import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { PersonName } from "@/components/oikonomia/person";
import { StatusChip } from "@/components/oikonomia/semantic-status";
import { VenuePicker } from "@/components/oikonomia/venue-picker";
import { cn } from "@/lib/utils";
import { gatheringStatusLabel, myAction, myActionLabel } from "@/domain/lifegroup";
import type { ObligationStatus } from "@/domain/obligations";
import type { Gathering, Venue } from "@/domain/types";
import { formatDayMonthShort, formatTime, formatWeekdayShort } from "@/domain/dates";

/**
 * One row of the shared LifeGroup schedule.
 *
 * The row **is** the interface. Common fields are edited where they are read,
 * so maintaining the week is typing into a table rather than opening a form per
 * gathering — which is how this work is actually done, several leaders filling
 * in the roster together while the poll goes round.
 *
 * Two actions live here and they are deliberately different things:
 *
 * - **Assign to me** takes a row nobody is leading.
 * - **Add me** stands beside leaders who already are.
 *
 * Neither is "add a schedule", which makes another row. Conflating those is how
 * a roster fills up with duplicates of the same evening.
 */

/** How a stage reads as one of the five shared states. */
const stageTone: Record<Gathering["status"], ObligationStatus> = {
  planned: "warning",
  assigned: "in_progress",
  confirmed: "in_progress",
  open: "in_progress",
  completed: "done",
  cancelled: "not_started",
};

export function ScheduleRow({
  gathering,
  venues,
  personId,
  mayAmend,
  mayJoin,
  saving,
  onPatch,
  onJoin,
  onOpen,
}: {
  gathering: Gathering;
  venues: Venue[];
  personId: string;
  mayAmend: boolean;
  mayJoin: boolean;
  saving: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onJoin: (action: "claim" | "join" | "leave") => void;
  onOpen: () => void;
}) {
  const action = myAction(gathering, personId, mayJoin);
  const venue = venues.find((v) => v.id === gathering.venueId);
  /* A cancelled row reads as history: it can be restored from its page, not
     retyped in the table. */
  const cancelled = gathering.status === "cancelled";
  const editable = mayAmend && !cancelled;

  return (
    <tr
      className={cn(
        "border-b border-border last:border-0 align-top",
        cancelled && "text-muted-foreground",
      )}
    >
      <td className="px-3 py-2">
        <InlineDate
          value={gathering.date}
          editable={editable}
          onChange={(date) => onPatch({ date })}
        />
      </td>

      <td className="px-3 py-2">
        <InlineTime
          value={gathering.startTime}
          editable={editable}
          onChange={(startTime) => onPatch({ startTime })}
        />
      </td>

      <td className="px-3 py-2">
        {editable ? (
          <VenuePicker
            label="Where"
            venueId={gathering.venueId}
            onChoose={(venueId) => {
              /* Clearing the field is not a change: a row keeps its venue
                 until another is chosen. */
              if (venueId) onPatch({ venueId });
            }}
          />
        ) : (
          <span className="text-[13px]">{venue?.name ?? "Not set"}</span>
        )}
        {venue?.area ? (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">{venue.area}</span>
        ) : null}
      </td>

      <td className="px-3 py-2">
        {gathering.assignedLeaderIds.length > 0 ? (
          <ul className="space-y-0.5">
            {gathering.assignedLeaderIds.map((id) => (
              <li key={id} className="text-[13px]">
                <PersonName personId={id} />
                {gathering.primaryLeaderId === id ? (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">carrying it</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[13px] text-muted-foreground">Leader needed</span>
        )}
      </td>

      <td className="px-3 py-2">
        <StatusChip
          status={stageTone[gathering.status]}
          label={gatheringStatusLabel[gathering.status]}
        />
      </td>

      <td className="px-3 py-2">
        {/* The one action that is this leader's own — never the same control as
            naming somebody else, which is a campus responsibility. */}
        {action === "none" ? (
          <span className="text-[12px] text-muted-foreground">—</span>
        ) : action === "leave" ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-[12px] text-status-done">You&apos;re assigned</span>
            <button
              type="button"
              disabled={saving}
              onClick={() => onJoin("leave")}
              className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Step away
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => onJoin(action)}
            className={cn(
              "rounded-md border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted",
              action === "claim" && "border-primary/40 text-primary",
            )}
          >
            {myActionLabel[action]}
          </button>
        )}
      </td>

      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onOpen}
          className="text-[12px] text-primary underline-offset-2 hover:underline"
        >
          Open
        </button>
      </td>
    </tr>
  );
}

/**
 * A field edited where it is read.
 *
 * Saves on blur rather than per keystroke: a roster is typed across, and a
 * request per character would make a shared table feel like a form again.
 */
function InlineDate({
  value,
  editable,
  onChange,
}: {
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!editable) {
    return <span className="text-[13px]">{formatDayMonthShort(value)}</span>;
  }
  return (
    <input
      type="date"
      aria-label="Date"
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft && draft !== value) onChange(draft);
        setDraft(null);
      }}
      className="w-[130px] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] outline-none hover:border-border focus:border-border-strong"
    />
  );
}

function InlineTime({
  value,
  editable,
  onChange,
}: {
  value: string | undefined;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!editable) {
    return <span className="text-[13px]">{value ?? "—"}</span>;
  }
  return (
    <input
      type="time"
      aria-label="Start time"
      value={draft ?? value ?? ""}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft && draft !== value) onChange(draft);
        setDraft(null);
      }}
      className="w-[104px] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] outline-none hover:border-border focus:border-border-strong"
    />
  );
}

/** The same row, stacked, for a width a seven-column table cannot survive. */
export function ScheduleCard({
  gathering,
  venues,
  personId,
  mayJoin,
  saving,
  onJoin,
  onOpen,
}: {
  gathering: Gathering;
  venues: Venue[];
  personId: string;
  mayJoin: boolean;
  saving: boolean;
  onJoin: (action: "claim" | "join" | "leave") => void;
  onOpen: () => void;
}) {
  const action = myAction(gathering, personId, mayJoin);
  const venue = venues.find((v) => v.id === gathering.venueId);

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px]">
            {formatWeekdayShort(gathering.date)}
            {gathering.startTime ? (
              <span className="text-muted-foreground"> · {formatTime(gathering.startTime)}</span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {venue?.name ?? "Venue not set"}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {gathering.assignedLeaderIds.length > 0 ? (
              gathering.assignedLeaderIds.map((id, i) => (
                <span key={id}>
                  {i > 0 ? ", " : ""}
                  <PersonName personId={id} />
                </span>
              ))
            ) : (
              <span>Leader needed</span>
            )}
          </p>
        </div>
        <StatusChip
          status={stageTone[gathering.status]}
          label={gatheringStatusLabel[gathering.status]}
        />
      </div>

      <div className="mt-2 flex items-center gap-3">
        {action !== "none" ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => onJoin(action === "leave" ? "leave" : action)}
            className="rounded-md border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted"
          >
            {action === "leave" ? "Step away" : myActionLabel[action]}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpen}
          className="text-[12px] text-primary underline-offset-2 hover:underline"
        >
          Open
        </button>
      </div>
    </li>
  );
}

/** Where the gathering's own workspace lives, once there is one to open. */
export function GatheringLink({ gathering }: { gathering: Gathering }) {
  return (
    <Link
      to="/lifegroups/$gatheringId"
      params={{ gatheringId: gathering.id }}
      className="text-[13px] text-primary underline-offset-2 hover:underline"
    >
      Open the gathering
    </Link>
  );
}
