import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useLeadershipInbox } from "./escalation-provider";
import { useSchedule } from "./schedule-provider";
import { errorMessage } from "@/lib/calendar-client";
import {
  actionsAskedOn,
  isOnTheWeek,
  isOverdue,
  weekDateFor,
  type EscalationSourceType,
} from "@/domain/escalation";
import { toISO } from "@/domain/schedule";
import { cn } from "@/lib/utils";
import { PersonName } from "./person";
import { AskNotes } from "./ask-notes";
import type { EscalationView } from "@/lib/escalation-api";

/**
 * "Put on my week" for an action somebody asked of this leader.
 *
 * One control wherever the ask is met — the inbox row and the record it came
 * from — so the two cannot drift on which day it lands or what counts as
 * already filed. It creates an ordinary agenda item that names the ask, and
 * nothing else; once filed it becomes a link to that day.
 */
export function PutOnWeekButton({
  item,
  today,
  onFailure,
}: {
  item: EscalationView;
  today: string;
  /** Receives the error message, or null when a new attempt starts. */
  onFailure: (message: string | null) => void;
}) {
  const inbox = useLeadershipInbox();
  const schedule = useSchedule();
  const [filed, setFiled] = useState(false);

  const date = weekDateFor(item, today);

  if (filed || isOnTheWeek(item, schedule.agenda)) {
    return (
      <Link
        to="/weekly-agenda"
        search={{ date }}
        className="inline-flex min-h-6 items-center px-2.5 py-1 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
      >
        On your week
      </Link>
    );
  }

  const putOnWeek = async () => {
    onFailure(null);
    try {
      await schedule.addAgenda({ text: item.request, date, escalationId: item.id });
      setFiled(true);
      /* Dating the work is taking it on; an ask already moving stays where it is. */
      if (item.status === "requested") await inbox.move(item.id, "in-progress");
    } catch (error) {
      onFailure(errorMessage(error));
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={schedule.saving}
      onClick={() => void putOnWeek()}
    >
      Put on my week
    </Button>
  );
}

/**
 * Actions somebody asked of this viewer about one record, on that record's page.
 *
 * A leader who followed an ask to its source should be able to date the work
 * without going back to the inbox. Only the recipient's own unsettled actions
 * appear, and nothing is filed until they choose to: opening a record is
 * reading it. Every other response to the ask still lives in the Leadership
 * Inbox.
 */
export function AskedOfYou({
  sourceType,
  sourceId,
}: {
  sourceType: EscalationSourceType;
  sourceId: string;
}) {
  const inbox = useLeadershipInbox();
  const [failure, setFailure] = useState<string | null>(null);
  const asks = actionsAskedOn(inbox.mine, sourceType, sourceId);
  if (asks.length === 0) return null;

  const today = toISO(new Date());

  return (
    <section
      aria-label="Asked of you"
      className="rounded-lg border border-border bg-surface px-4 py-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium">Asked of you</h3>
        <Link
          to="/inbox"
          className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
        >
          Respond in Leadership Inbox
        </Link>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {asks.map((item) => {
          const overdue = isOverdue(item, today);
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-6">{item.request}</p>
                <p className="text-[12px] text-muted-foreground">
                  Requested by <PersonName personId={item.requestedById} />
                  {item.neededBy ? (
                    <span className={cn(overdue && "text-status-overdue")}>
                      {" · "}
                      {overdue ? "Was needed by " : "Needed by "}
                      {item.neededBy}
                    </span>
                  ) : null}
                </p>
                <AskNotes item={item} />
              </div>
              <PutOnWeekButton item={item} today={today} onFailure={setFailure} />
            </li>
          );
        })}
      </ul>
      {failure ? (
        <p role="alert" className="mt-1.5 text-[12px] text-status-overdue">
          {failure}
        </p>
      ) : null}
    </section>
  );
}
