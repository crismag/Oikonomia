import { Link } from "@tanstack/react-router";
import { Check, Circle, CircleDot, X } from "lucide-react";

import { ProgressMeter, StatusChip } from "@/components/oikonomia/semantic-status";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cadenceLabel,
  dueLabel,
  progressOf,
  requiredSteps,
  type LeadershipObligation,
} from "@/domain/obligations";

/**
 * What one station actually involves.
 *
 * Its whole job is **understand where this stands, then continue** — so it
 * shows the steps, says which are required, and offers the one action. It is
 * deliberately not a second reporting surface: everything a leader would
 * actually write happens in the section, which the action opens.
 *
 * Required and optional are distinguished in words as well as by mark, because
 * the distinction is load-bearing: optional work must never read as though it
 * were holding the obligation open.
 */
export function WorkflowDetail({
  obligation,
  today,
  onClose,
}: {
  obligation: LeadershipObligation;
  today: string;
  onClose: () => void;
}) {
  const progress = progressOf(obligation.steps);
  const due = obligation.blockedReason ?? dueLabel(obligation.dueAt, today, obligation.status);

  return (
    <section
      aria-label={`${obligation.title} — detail`}
      className="mt-3 rounded-xl border border-border bg-surface-muted px-4 py-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">
            {obligation.module} · {cadenceLabel[obligation.cadence]} · {obligation.cycle}
          </p>
          <h3 className="mt-0.5 text-[15px] leading-snug">{obligation.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusChip
            status={obligation.status}
            {...(obligation.statusNote ? { label: obligation.statusNote } : {})}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {due ? (
        <p
          className={cn(
            "mt-1.5 text-[12px]",
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

      {obligation.steps.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {obligation.steps.map((step) => {
            const Icon = step.done ? Check : step.required ? CircleDot : Circle;
            return (
              <li key={step.id} className="flex items-start gap-2.5 text-[14px] leading-relaxed">
                <Icon
                  className={cn(
                    "mt-[3px] size-3.5 shrink-0",
                    step.done ? "text-status-done" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className={cn("min-w-0 flex-1", step.done && "text-muted-foreground")}>
                  {step.title}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {step.done ? "Done" : step.required ? "Required" : "Optional"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {requiredSteps(obligation.steps).length > 1 ? (
        <ProgressMeter
          done={progress.done}
          total={progress.total}
          noun="required steps"
          label="Progress"
          className="mt-3 max-w-[260px]"
        />
      ) : null}

      <div className="mt-3.5">
        <Link
          to={obligation.destination}
          className={buttonVariants({ variant: "primary" })}
          aria-label={`${obligation.nextAction ?? "Open"} — ${obligation.title}`}
        >
          {obligation.nextAction ?? "Open"}
        </Link>
      </div>
    </section>
  );
}
