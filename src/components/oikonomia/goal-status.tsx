import { Check, PauseCircle, ArrowRightCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatTargetShort, goalStatusLabel, targetState } from "@/domain/goals";
import type { Goal } from "@/domain/types";

/**
 * Goal status and target, shown together because they only mean anything
 * together: a target matters while a goal is active, and stops mattering the
 * moment it is completed or held.
 *
 * Status is quiet text, not a badge. A page of twelve goals with twelve pills
 * reads as noise; the completed check is the one thing that should catch a
 * leader's eye when they scan the year.
 */

const statusTone: Record<Goal["status"], string> = {
  active: "text-muted-foreground",
  completed: "text-status-done",
  "on-hold": "text-status-waiting",
  "carried-forward": "text-muted-foreground",
};

export function GoalStatusLine({ goal, className }: { goal: Goal; className?: string }) {
  const target = formatTargetShort(goal.target);
  const state = targetState(goal);

  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]", className)}
    >
      <span className={cn("inline-flex items-center gap-1", statusTone[goal.status])}>
        {goal.status === "completed" ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
        {goal.status === "on-hold" ? (
          <PauseCircle className="size-3.5 shrink-0" aria-hidden />
        ) : null}
        {goal.status === "carried-forward" ? (
          <ArrowRightCircle className="size-3.5 shrink-0" aria-hidden />
        ) : null}
        {goalStatusLabel[goal.status]}
      </span>

      {goal.status === "completed" && goal.completedAt ? (
        <span className="text-muted-foreground">· {formatMonthOf(goal.completedAt)}</span>
      ) : null}

      {goal.status === "on-hold" && goal.holdSince ? (
        <span className="text-muted-foreground">· since {formatMonthOf(goal.holdSince)}</span>
      ) : null}

      {target && goal.status === "active" ? (
        <span
          className={cn(
            state === "passed"
              ? "text-status-overdue"
              : state === "approaching"
                ? "text-status-waiting"
                : "text-muted-foreground",
          )}
        >
          · target {target}
        </span>
      ) : null}
    </span>
  );
}

/** Accepts yyyy-MM or yyyy-MM-dd; the binder writes both. */
function formatMonthOf(value: string): string {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en", { month: "long", year: "numeric" });
}
