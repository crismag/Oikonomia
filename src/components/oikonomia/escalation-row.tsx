import { Link } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Gavel, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PersonName } from "./person";
import { useLeadershipInbox } from "./escalation-provider";
import { useSchedule } from "./schedule-provider";
import { errorMessage } from "@/lib/calendar-client";
import {
  escalationHref,
  escalationLabel,
  escalationStatusLabel,
  isOverdue,
  type EscalationStatus,
  type EscalationType,
} from "@/domain/escalation";
import type { EscalationView } from "@/lib/escalation-api";

/**
 * One thing somebody has asked of leadership.
 *
 * The row says three things in order: what kind of ask it is, what was
 * actually asked, and where it came from. The controls under it are the whole
 * lifecycle — three buttons for an action, two for a decision, one for
 * attention — because an ask a leader cannot finish in one click becomes a
 * queue, and a queue is what this replaced.
 */

const icon: Record<EscalationType, LucideIcon> = {
  attention: AlertCircle,
  action: CheckCircle2,
  approval: Gavel,
};

const tone: Record<EscalationType, string> = {
  attention: "text-status-waiting",
  action: "text-status-info",
  approval: "text-status-approval",
};

export function EscalationRow({
  item,
  today,
  className,
}: {
  item: EscalationView;
  today: string;
  className?: string;
}) {
  const inbox = useLeadershipInbox();
  const schedule = useSchedule();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<EscalationStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [onTheWeek, setOnTheWeek] = useState(false);

  const Icon = icon[item.type];
  const overdue = isOverdue(item, today);
  const href = escalationHref(item.sourceType, item.sourceId);
  const alreadyFiled = schedule.agenda.some(
    (entry) => entry.text === item.request && !entry.completed,
  );
  const filed = onTheWeek || alreadyFiled;

  const move = async (status: EscalationStatus, withNote?: boolean) => {
    if (withNote && !note.trim()) {
      setAsking(status);
      return;
    }
    setFailure(null);
    try {
      await inbox.move(item.id, status, note.trim() ? { note: note.trim() } : {});
      setNote("");
      setAsking(null);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const putOnWeek = async () => {
    setFailure(null);
    try {
      const date = item.neededBy && item.neededBy >= today ? item.neededBy : today;
      await schedule.addAgenda({ text: item.request, date });
      setOnTheWeek(true);
      if (item.type === "action" && item.status === "requested") {
        await move("in-progress");
      }
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <li className={cn("px-4 py-3.5", className)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone[item.type])} aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              {escalationLabel[item.type]}
            </span>
            {item.contextLabel ? (
              <span className="min-w-0 truncate text-[12px] text-muted-foreground">
                · {item.contextLabel}
              </span>
            ) : null}
            {item.status !== "raised" && item.status !== "requested" ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {escalationStatusLabel[item.status]}
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-[14px] leading-6">{item.request}</p>

          <p className="mt-1 text-[12px] text-muted-foreground">
            Requested by <PersonName personId={item.requestedById} />
            {item.neededBy ? (
              <span className={cn(overdue && "text-status-overdue")}>
                {" · "}
                {overdue ? "Was needed by " : "Needed by "}
                {item.neededBy}
              </span>
            ) : null}
          </p>

          {asking ? (
            <div className="mt-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                  {asking === "declined"
                    ? "Say why, so it can be reworked"
                    : asking === "more-information"
                      ? "What do you need to know?"
                      : "Add a note"}
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
                />
              </label>
              <div className="mt-1.5 flex gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!note.trim() || inbox.saving}
                  onClick={() => void move(asking)}
                >
                  Send
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAsking(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {href ? (
                <Link
                  to={href.to}
                  {...(href.search ? { search: href.search } : {})}
                  className="inline-flex min-h-6 items-center rounded-md border border-border px-2.5 py-1 text-[12px] transition-colors hover:bg-muted"
                >
                  Open context
                </Link>
              ) : null}

              {item.type === "attention" ? (
                <Button type="button" variant="ghost" onClick={() => void move("noted")}>
                  Noted
                </Button>
              ) : null}

              {item.type === "action" ? (
                <>
                  {item.status === "requested" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void move("in-progress")}
                    >
                      Take it on
                    </Button>
                  ) : null}
                  {filed ? (
                    <Link
                      to="/weekly-agenda"
                      search={{
                        date: item.neededBy && item.neededBy >= today ? item.neededBy : today,
                      }}
                      className="inline-flex min-h-6 items-center px-2.5 py-1 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      On your week
                    </Link>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={schedule.saving}
                      onClick={() => void putOnWeek()}
                    >
                      Put on my week
                    </Button>
                  )}
                  <Button type="button" variant="ghost" onClick={() => void move("completed")}>
                    Completed
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setAsking("unable")}>
                    Can&apos;t do it
                  </Button>
                </>
              ) : null}

              {item.type === "approval" ? (
                <>
                  <Button type="button" variant="primary" onClick={() => void move("approved")}>
                    Approve
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setAsking("declined")}>
                    Decline
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setAsking("more-information")}
                  >
                    Ask a question
                  </Button>
                </>
              ) : null}
            </div>
          )}

          {failure ? (
            <p role="alert" className="mt-1.5 text-[12px] text-status-overdue">
              {failure}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
