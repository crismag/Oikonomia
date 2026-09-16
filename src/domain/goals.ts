import { differenceInCalendarDays, format, parse } from "date-fns";

import { fromISO, toISO } from "./schedule";
import { config } from "@/config";
import type { Goal, GoalStatus, GoalTarget, GoalUpdate, ReportableItem } from "./types";

/**
 * Goal logic.
 *
 * Progress is expressed as updates, status, target and evidence — never as a
 * percentage. "Training for excellence" cannot be 47% done, and pretending
 * otherwise would misrepresent what the binder records.
 */

export const goalStatusLabel = config.labels("goals.statuses") as Record<GoalStatus, string>;

/* ------------------------------------------------------------- targets */

/** "June 2026" for a month, "18 June 2026" for a date. Never a fake day. */
export function formatTarget(target?: GoalTarget): string | undefined {
  if (!target) return undefined;
  if (target.precision === "month") {
    return format(parse(target.value, "yyyy-MM", new Date()), "MMMM yyyy");
  }
  return format(fromISO(target.value), "d MMMM yyyy");
}

/** Short form for dense rows: "June", "18 Jun". */
export function formatTargetShort(target?: GoalTarget): string | undefined {
  if (!target) return undefined;
  if (target.precision === "month") {
    return format(parse(target.value, "yyyy-MM", new Date()), "MMMM");
  }
  return format(fromISO(target.value), "d MMM");
}

/** The last day a month-precision target can still be met. */
function targetDeadline(target: GoalTarget): Date {
  if (target.precision === "date") return fromISO(target.value);
  const first = parse(target.value, "yyyy-MM", new Date());
  return new Date(first.getFullYear(), first.getMonth() + 1, 0);
}

/**
 * A target is "approaching" inside 30 days and "passed" after it. Only active
 * goals can be either — a completed or held goal is not late.
 */
export function targetState(
  goal: Goal,
  today = new Date(),
): "none" | "approaching" | "passed" | "ok" {
  if (!goal.target || goal.status !== "active") return "none";
  const days = differenceInCalendarDays(targetDeadline(goal.target), today);
  if (days < 0) return "passed";
  if (days <= 30) return "approaching";
  return "ok";
}

/* -------------------------------------------------------------- queries */

export function goalsForYear(goals: Goal[], year: number): Goal[] {
  return goals.filter((goal) => goal.year === year).sort((a, b) => a.number - b.number);
}

export function goalYears(goals: Goal[]): number[] {
  return Array.from(new Set(goals.map((goal) => goal.year))).sort((a, b) => b - a);
}

/** Next annual number, so a new goal continues the list rather than restarting. */
export function nextGoalNumber(goals: Goal[], year: number): number {
  const used = goalsForYear(goals, year).map((goal) => goal.number);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

export function updatesFor(updates: GoalUpdate[], goalId: string): GoalUpdate[] {
  return updates
    .filter((update) => update.goalId === goalId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function latestUpdate(updates: GoalUpdate[], goalId: string): GoalUpdate | undefined {
  return updatesFor(updates, goalId)[0];
}

export function goalCounts(goals: Goal[]) {
  return {
    total: goals.length,
    active: goals.filter((g) => g.status === "active").length,
    completed: goals.filter((g) => g.status === "completed").length,
    onHold: goals.filter((g) => g.status === "on-hold").length,
    carried: goals.filter((g) => g.status === "carried-forward").length,
  };
}

/** Active goals whose target is close or already past, soonest first. */
export function needsAttention(goals: Goal[], today = new Date()): Goal[] {
  return goals
    .filter((goal) => {
      const state = targetState(goal, today);
      return state === "approaching" || state === "passed";
    })
    .sort((a, b) => (a.target?.value ?? "").localeCompare(b.target?.value ?? ""));
}

/* ----------------------------------------------------------- reportable */

/**
 * Reportable material derived from goal records, not retyped each cycle.
 *
 * Completions and holds are meaningful state changes; ordinary progress notes
 * are offered too. The leader still chooses what actually goes in the report —
 * this only stops them rewriting the year from memory.
 */
export function reportableFromGoals(goals: Goal[], updates: GoalUpdate[]): ReportableItem[] {
  const items: ReportableItem[] = [];

  for (const goal of goals) {
    const label = `Goal ${String(goal.number).padStart(2, "0")}`;

    if (goal.status === "completed" && goal.completedAt) {
      items.push({
        id: `rep-${goal.id}-done`,
        source: { kind: "goal", id: goal.id, label },
        date: goal.completedAt,
        text: `${goal.title} completed`,
        emphasis: "completed",
        ...(goal.ministryId ? { ministryId: goal.ministryId } : {}),
      });
    }

    if (goal.status === "on-hold" && goal.holdSince) {
      items.push({
        id: `rep-${goal.id}-hold`,
        source: { kind: "goal", id: goal.id, label },
        date: goal.holdSince,
        text: goal.holdReason
          ? `${goal.title} placed on hold — ${goal.holdReason}`
          : `${goal.title} placed on hold`,
        emphasis: "on-hold",
        ...(goal.ministryId ? { ministryId: goal.ministryId } : {}),
      });
    }

    for (const update of updatesFor(updates, goal.id)) {
      if (update.kind !== "note") continue;
      items.push({
        id: `rep-${update.id}`,
        source: { kind: "goal", id: goal.id, label },
        date: update.date,
        text: `${goal.title}: ${update.text}`,
        emphasis: "progress",
        ...(goal.ministryId ? { ministryId: goal.ministryId } : {}),
      });
    }
  }

  return items.sort((a, b) => b.date.localeCompare(a.date));
}

/** Today as an ISO date, for update stamps. */
/**
 * Goals as a leader who receives reports should reach them: one owner or one
 * ministry at a time.
 *
 * A leader's goals are theirs. Pooled with everybody else's and sorted by
 * progress they stop meaning anything — "In progress" across twelve people
 * and four ministries is a list, not a picture of anyone. So they are grouped
 * by whose they are, and each is a way into its own record:
 *
 * - **people who report to this leader** — every goal that person owns, even
 *   one filed under a ministry: a goal with an owner is that leader's goal,
 *   and the ministry is only its context;
 * - **ministries** this leader leads or serves in, or that one of their
 *   people leads — only the ministry's own goals, which nobody owns;
 * - **shared** goals, which belong to no one person or ministry.
 *
 * Pass only goals the viewer may read. A group with no goals is omitted.
 */
export interface GoalsByWhose {
  people: { personId: string; goals: Goal[] }[];
  ministries: { ministryId: string; goals: Goal[] }[];
  shared: Goal[];
}

export function goalsByWhose(
  goals: Goal[],
  context: {
    year: number;
    viewerId: string;
    people: { id: string; reportsToId?: string | undefined }[];
    ministries: { id: string; leadId: string; teamIds: string[] }[];
  },
): GoalsByWhose {
  const ofYear = goalsForYear(goals, context.year);
  const reportees = context.people.filter((person) => person.reportsToId === context.viewerId);
  const reporteeIds = new Set(reportees.map((person) => person.id));

  const people = reportees
    .map((person) => ({
      personId: person.id,
      goals: ofYear.filter((goal) => goal.ownerId === person.id),
    }))
    .filter((group) => group.goals.length > 0);

  const ministries = context.ministries
    .filter(
      (ministry) =>
        ministry.leadId === context.viewerId ||
        ministry.teamIds.includes(context.viewerId) ||
        reporteeIds.has(ministry.leadId),
    )
    .map((ministry) => ({
      ministryId: ministry.id,
      goals: ofYear.filter((goal) => goal.ministryId === ministry.id && !goal.ownerId),
    }))
    .filter((group) => group.goals.length > 0);

  const shared = ofYear.filter((goal) => !goal.ministryId && !goal.ownerId);

  return { people, ministries, shared };
}

export const todayISO = () => toISO(new Date());
