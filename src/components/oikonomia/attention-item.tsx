import { Link } from "@tanstack/react-router";

import { ProgressMeter, StatusChip } from "@/components/oikonomia/semantic-status";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dueLabel, progressOf, statusLabel, type LeadershipObligation } from "@/domain/obligations";

/**
 * One thing that needs the leader.
 *
 * The row is built so the answer arrives in this order: **what state, which
 * section, what is being asked, and the one press that continues it.** Anything
 * else a leader might eventually want is in the section, not here — the point
 * of this page is to shorten the distance back to work, not to be a second
 * place to do it.
 */
export function AttentionItem({
  obligation,
  today,
}: {
  obligation: LeadershipObligation;
  today: string;
}) {
  const progress = progressOf(obligation.steps);
  const due = obligation.blockedReason ?? dueLabel(obligation.dueAt, today, obligation.status);

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip
              status={obligation.status}
              {...(obligation.statusNote ? { label: obligation.statusNote } : {})}
            />
            <span className="text-[12px] text-muted-foreground">{obligation.module}</span>
          </div>

          <p className="mt-1.5 text-[15px] leading-snug">{obligation.title}</p>
          {obligation.description ? (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {obligation.description}
            </p>
          ) : null}

          {/* Never colour alone: the state has a word above, and the date has
              words rather than a number to compare against today. */}
          {due ? (
            <p
              className={cn(
                "mt-1 text-[12px]",
                obligation.status === "blocked"
                  ? "text-status-overdue"
                  : obligation.status === "warning"
                    ? "text-status-waiting"
                    : "text-muted-foreground",
              )}
            >
              {due}
            </p>
          ) : null}

          {progress.total > 1 ? (
            <ProgressMeter
              done={progress.done}
              total={progress.total}
              noun="steps"
              label="Progress"
              className="mt-2 max-w-[220px]"
            />
          ) : null}
        </div>

        <Link
          to={obligation.destination}
          className={cn(buttonVariants({ variant: "secondary" }), "shrink-0")}
          aria-label={`${obligation.nextAction ?? "Open"} — ${obligation.title}, ${statusLabel[obligation.status]}`}
        >
          {obligation.nextAction ?? "Open"}
        </Link>
      </div>
    </li>
  );
}
