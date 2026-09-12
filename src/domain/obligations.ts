import { differenceInCalendarDays } from "date-fns";

import { config } from "@/config";
import { fromISO } from "./schedule";

/**
 * What a leader owes, and where that stands.
 *
 * A **projection**, not a new domain. Every binder section owns its own
 * records; this describes the shape of the obligation those records satisfy, so
 * one page can answer "what needs my attention?" without any section having to
 * know a dashboard exists.
 *
 * Two rules keep it honest:
 *
 * - **Status is computed, never assigned.** It falls out of the cadence, the
 *   due date and what has actually been recorded. Nothing in the product lets a
 *   leader colour an obligation green by hand, because a status somebody chose
 *   is a status that stops describing reality the moment they stop maintaining
 *   it.
 * - **Done means done.** Not "a record exists". A LifeGroup gathering with
 *   attendance taken and no report written is *in progress*, and saying
 *   otherwise would tell a leader they had finished something they had not.
 *
 * What this deliberately is not is a cadence engine. It answers "is this
 * done" from the records that exist, never "was this due" from a schedule of
 * expectations nobody has entered.
 */

/* ----------------------------------------------------------------- status */

/**
 * The five states, and what each one means.
 *
 * They are deliberately few. A leader scanning this page is asking a question
 * with four or five useful answers, and a sixth shade would be a distinction
 * they have to learn rather than one they can read.
 */
export type ObligationStatus =
  /** The work this cycle required has been satisfied. */
  | "done"
  /** Active, and still within its expected cadence. Not a problem. */
  | "in_progress"
  /** Approaching its deadline, or behind where the cadence expects it. */
  | "warning"
  /** Missed, or stopped by something. Intervention is required. */
  | "blocked"
  /** Real, but not yet inside the period where it is actionable. */
  | "not_started";

export const statusLabel: Record<ObligationStatus, string> = {
  done: "Done",
  in_progress: "In progress",
  warning: "Due soon",
  blocked: "Needs attention",
  not_started: "Upcoming",
};

/**
 * How loudly each state should read.
 *
 * Ordering, not decoration. `attentionOrder` below is the only thing that
 * decides what a leader sees first, and it is derived from this.
 */
const weight: Record<ObligationStatus, number> = {
  blocked: 0,
  warning: 1,
  in_progress: 2,
  not_started: 3,
  done: 4,
};

/** A responsibility's rhythm. Not every obligation has a deadline. */
export type Cadence = "weekly" | "monthly" | "ongoing" | "event" | "once";

export const cadenceLabel: Record<Cadence, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  ongoing: "Ongoing",
  event: "Event-based",
  once: "One-off",
};

/** One step toward satisfying an obligation. */
export interface ObligationStep {
  id: string;
  title: string;
  done: boolean;
  /**
   * Whether the obligation can be complete without it.
   *
   * Optional work must never hold an obligation open — a leader who added no
   * follow-up entries has not left the gathering report unfinished.
   */
  required: boolean;
}

export interface LeadershipObligation {
  id: string;
  /** The binder section that owns the records behind it. */
  module: string;
  title: string;
  /** What is actually being asked for, in one line. */
  description?: string;
  cadence: Cadence;
  /** The period this obligation belongs to — "This week", "September". */
  cycle: string;
  status: ObligationStatus;
  steps: ObligationStep[];
  /** ISO date the work is expected by, when the cadence has one. */
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  /** Set when something is genuinely stopping the work, not merely late. */
  blockedReason?: string;
  /**
   * A truer word than the generic state, where the obligation has one.
   *
   * "Overdue" rather than "Needs attention", "Attendance taken" rather than
   * "In progress". Never a substitute for the state — it sits beside it.
   */
  statusNote?: string;
  /** What the leader would press to continue. */
  nextAction?: string;
  /** Where that leads. An existing route, never a made-up one. */
  destination: string;
}

/* ------------------------------------------------------------- completion */

export const requiredSteps = (steps: ObligationStep[]) => steps.filter((s) => s.required);

/**
 * How far along, counting only what is actually required.
 *
 * Counts rather than a percentage, because "3 of 4" says what the denominator
 * is and "75%" does not.
 */
export function progressOf(steps: ObligationStep[]): { done: number; total: number } {
  const required = requiredSteps(steps);
  return { done: required.filter((s) => s.done).length, total: required.length };
}

/** Every required step taken. Optional ones are not consulted. */
export const isSatisfied = (steps: ObligationStep[]) =>
  requiredSteps(steps).every((step) => step.done);

/** Something has been done, but not everything required. */
export const isStarted = (steps: ObligationStep[]) => steps.some((step) => step.done);

/* ---------------------------------------------------------------- status */

export interface StatusInput {
  steps: ObligationStep[];
  /** ISO date, when the cadence has a deadline. */
  dueAt?: string | undefined;
  /** ISO date from which the work is expected to be possible. */
  activeFrom?: string | undefined;
  /** A real impediment, not lateness. */
  blockedReason?: string | undefined;
  /** How many days before the due date counts as "due soon". */
  warnWithinDays?: number;
}

/*
 * Due today or tomorrow. Wide enough to give a leader a day's notice, narrow
 * enough that "due soon" still means soon — a window that lights up half the
 * week is one people learn to ignore.
 */
const DEFAULT_WARN_WITHIN_DAYS = config.cadence.warnWithinDays;

/**
 * What state an obligation is in, on a given day.
 *
 * The whole of the rule, in one place, so that every station, row and chip on
 * the dashboard is saying the same thing for the same reason.
 *
 * Order matters:
 *
 * 1. **Satisfied wins over everything.** Work finished late is finished, and
 *    colouring it red the next morning would be the system arguing with the
 *    leader about something they already did.
 * 2. **Blocked outranks late**, because being late is a consequence and being
 *    blocked is the cause — telling someone their report is overdue when it was
 *    returned to them describes the symptom.
 * 3. Past its date is `blocked`: it needs intervention, whatever the reason.
 * 4. Inside the warning window, or already begun, is `warning` / `in_progress`.
 * 5. Before its period is `not_started`, and recedes.
 */
export function statusOf(input: StatusInput, today: string): ObligationStatus {
  if (isSatisfied(input.steps)) return "done";
  if (input.blockedReason) return "blocked";

  const now = fromISO(today);

  if (input.activeFrom && differenceInCalendarDays(fromISO(input.activeFrom), now) > 0) {
    return "not_started";
  }

  if (input.dueAt) {
    const days = differenceInCalendarDays(fromISO(input.dueAt), now);
    if (days < 0) return "blocked";
    if (days <= (input.warnWithinDays ?? DEFAULT_WARN_WITHIN_DAYS)) return "warning";
  }

  /*
   * Nothing done yet is `not_started`, deadline or no deadline. Calling an
   * untouched obligation "in progress" because it happens to have a date would
   * describe work nobody has begun.
   */
  return isStarted(input.steps) ? "in_progress" : "not_started";
}

/**
 * How a due date reads to somebody scanning.
 *
 * Words rather than a date wherever a word is clearer — "Due today" is read at
 * a glance and "Sep 13" has to be compared against what day it is.
 */
export function dueLabel(
  dueAt: string | undefined,
  today: string,
  status?: ObligationStatus,
): string | undefined {
  if (!dueAt) return undefined;
  /*
   * Finished work has no deadline left to report. Saying "3 days overdue"
   * beside "Done" is the page arguing with itself, and the leader is left
   * working out which half to believe.
   */
  if (status === "done") return undefined;
  const days = differenceInCalendarDays(fromISO(dueAt), fromISO(today));
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 0) return days === -1 ? "1 day overdue" : `${Math.abs(days)} days overdue`;
  if (days <= 6) return `Due in ${days} days`;
  return undefined;
}

/* --------------------------------------------------------------- ordering */

/**
 * What a leader should see first.
 *
 * Blocked, then due, then work already underway, then what has not started.
 * Within a state, the nearer deadline comes first, and an obligation with no
 * deadline sorts after one that has — it cannot be late.
 */
export function attentionOrder(a: LeadershipObligation, b: LeadershipObligation): number {
  const byStatus = weight[a.status] - weight[b.status];
  if (byStatus !== 0) return byStatus;

  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return a.title.localeCompare(b.title);
}

/**
 * What belongs under "needs my attention".
 *
 * Finished work does not. It is still shown on the page — in the cycle counts
 * and on the board — but a list of what needs doing that includes things that
 * do not is a list a leader stops reading.
 */
export const needsAttention = (obligations: LeadershipObligation[]) =>
  obligations.filter((o) => o.status !== "done").sort(attentionOrder);

/** The counts across the top. Of obligations, never of anything invented. */
export function tally(obligations: LeadershipObligation[]): Record<ObligationStatus, number> {
  const counts: Record<ObligationStatus, number> = {
    done: 0,
    in_progress: 0,
    warning: 0,
    blocked: 0,
    not_started: 0,
  };
  for (const obligation of obligations) counts[obligation.status] += 1;
  return counts;
}

/**
 * How much of a cycle is complete.
 *
 * Of **required steps across the cycle's obligations**, so the denominator is
 * something a leader can point at rather than a number the page chose.
 */
export function cycleProgress(obligations: LeadershipObligation[]): {
  done: number;
  total: number;
} {
  return obligations.reduce(
    (acc, obligation) => {
      const { done, total } = progressOf(obligation.steps);
      return { done: acc.done + done, total: acc.total + total };
    },
    { done: 0, total: 0 },
  );
}

/* --------------------------------------------------------------- workflow */

/**
 * A recurring leadership cycle, as a sequence of stations.
 *
 * The line between stations is **progression through the cycle**, not
 * dependency. LifeGroup does not wait for the meeting notes, and drawing it as
 * though it did would teach a leader a rule the product does not have.
 */
export interface Workflow {
  id: string;
  title: string;
  cadence: Cadence;
  /** "Sep 7–13", "September" — what this run of the cycle covers. */
  period: string;
  stations: LeadershipObligation[];
}

/**
 * Where the leader currently is in the cycle.
 *
 * The first station that is not finished. Returns nothing when every station is
 * done, or when nothing has been started — in both cases an arrow would be
 * pointing at a place the leader is not.
 */
export function youAreHere(stations: LeadershipObligation[]): string | undefined {
  if (stations.length === 0) return undefined;
  if (stations.every((s) => s.status === "done")) return undefined;
  if (stations.every((s) => s.status === "not_started")) return undefined;
  return stations.find((s) => s.status !== "done")?.id;
}
