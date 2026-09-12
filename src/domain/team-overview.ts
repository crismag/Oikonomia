import type { LeadershipObligation, ObligationStatus } from "./obligations";

/**
 * The organization's leadership work, seen from above.
 *
 * A different **information level** from My Binder, not a larger version of it.
 * My Binder asks "what do I need to do?"; this asks "how are we doing, and
 * where should leadership attention go?" — so it summarizes state and hands the
 * reader onward, and it owns no records and offers no place to do the work.
 *
 * Three rules shape every type below.
 *
 * ## It reports workflow state, never what a report says
 *
 * That a leadership report is late is organizational information. What it says
 * is between its author and its audience. So a `LeaderStatus` carries a module
 * and a state and nothing else — no titles, no descriptions, no ids — because a
 * title is content: "Concern raised about a Music Ministry volunteer" discloses
 * the concern.
 *
 * ## It is not a ranking
 *
 * There is no score, no rank and no ordering of people against one another.
 * Leaders are listed alphabetically and sorted only by state, so the page reads
 * as "who needs following up" rather than "who is winning". A church is not a
 * league table.
 *
 * ## It flags conditions, never people
 *
 * Every attention reason is an observable workflow condition with a period and
 * a destination. Nothing here judges a person.
 */

/** Why something was flagged. Observable conditions, not opinions. */
export type AttentionReason =
  "overdue" | "due-soon" | "incomplete" | "unread" | "repeated-late" | "blocked";

export const attentionReasonLabel: Record<AttentionReason, string> = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  incomplete: "Incomplete",
  unread: "Not yet read",
  "repeated-late": "Late more than once",
  blocked: "Blocked",
};

/**
 * One thing leadership should look at.
 *
 * `personId` is present only when the viewer may know who it concerns; the item
 * is still shown without it, because "a LifeGroup report is overdue somewhere in
 * your campus" is worth knowing even when whose is not yours to see.
 */
export interface TeamAttentionItem {
  id: string;
  reason: AttentionReason;
  status: ObligationStatus;
  /** The binder section it arose in. */
  module: string;
  /** What happened, in the system's own terms. Never an interpretation. */
  summary: string;
  period: string;
  personId?: string;
  /** An existing route, so the reader can go and look. */
  destination: string;
}

/** One leader's state across the sections, for the matrix. */
export interface LeaderStatus {
  personId: string;
  /** Section → state. Deliberately the whole of what is shown about someone. */
  areas: Record<string, ObligationStatus>;
  overall: ObligationStatus;
  /** How many of their obligations are unmet. A count, never a score. */
  outstanding: number;
}

export interface WorkAreaHealth {
  module: string;
  done: number;
  total: number;
  /** Where the reader goes to act on it. */
  destination: string;
}

/**
 * Reporting, counted the way the operational situation actually divides.
 *
 * **Reporting completion is not review completion.** "23 of 25 submitted" says
 * whether leaders wrote what they were asked to write. It does not mean
 * twenty-three things need processing — leadership reads what it wants to
 * read, and the things that genuinely need somebody are the asks, counted
 * separately.
 *
 * `outstanding` is a leader who has not written. `unread` is information
 * leadership has not opened, which is a fact about reading and never a
 * deadline. One number would hide which.
 */
export interface ReportingHealth {
  expected: number;
  submitted: number;
  onTime: number;
  late: number;
  outstanding: number;
  /** Published and not yet opened by this viewer. Not a queue. */
  unread: number;
}

export interface TrendPoint {
  /** The period, as a leader would say it. */
  label: string;
  done: number;
  total: number;
}

/** One leader in one period, for the consistency view. */
export interface HeatmapCell {
  personId: string;
  period: string;
  status: ObligationStatus;
}

export interface TeamOverview {
  scope: TeamScope;
  period: string;
  leaderCount: number;
  counts: Record<ObligationStatus, number>;
  attention: TeamAttentionItem[];
  leaders: LeaderStatus[];
  workAreas: WorkAreaHealth[];
  reporting: ReportingHealth;
  trend: TrendPoint[];
  heatmap: { periods: string[]; cells: HeatmapCell[] };
}

/**
 * Whose work this reader may see, and why.
 *
 * `reason` is shown to the reader. Somebody looking at an organizational page
 * should be able to tell what they are looking at the whole of — a page that
 * quietly shows a subset reads as the whole church.
 */
export interface TeamScope {
  label: string;
  reason: string;
  /** False when the reader may see aggregates but not who they are about. */
  namesVisible: boolean;
}

/* --------------------------------------------------------------- summary */

/**
 * One leader's overall state.
 *
 * The worst of their sections, because an overview exists to surface trouble:
 * a leader with five healthy areas and one overdue report is a leader with an
 * overdue report. Deliberately **not** an average — averaging would let a real
 * problem disappear into otherwise good work.
 */
export function overallStatus(areas: ObligationStatus[]): ObligationStatus {
  const order: ObligationStatus[] = ["blocked", "warning", "in_progress", "not_started", "done"];
  return order.find((status) => areas.includes(status)) ?? "done";
}

export const overallLabel: Record<ObligationStatus, string> = {
  done: "On track",
  in_progress: "In progress",
  warning: "Needs attention",
  blocked: "Overdue",
  not_started: "Not started",
};

/**
 * How a set of obligations divides across the states.
 *
 * Percentages are derived from these in the interface, never stored: a count
 * says what the denominator is.
 */
export function distribution(
  obligations: LeadershipObligation[],
): Record<ObligationStatus, number> {
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
 * What share of expected work is complete.
 *
 * Returns the count as well as the percentage, because the interface must be
 * able to show both — "91%" alone leaves a reader guessing at the denominator,
 * and 91% of eleven things is a different situation from 91% of four hundred.
 */
export function completion(
  done: number,
  total: number,
): { pct: number; done: number; total: number } {
  return { pct: total === 0 ? 0 : Math.round((done / total) * 100), done, total };
}

/**
 * Which way a trend is going.
 *
 * Compares the most recent period against the average of what came before, and
 * says nothing at all when there is too little history — a direction claimed
 * from two data points is a guess wearing a label.
 */
export function trendDirection(
  points: TrendPoint[],
): { direction: "improving" | "stable" | "declining"; delta: number } | undefined {
  if (points.length < 4) return undefined;

  const rate = (p: TrendPoint) => (p.total === 0 ? 0 : (p.done / p.total) * 100);
  const latest = rate(points[points.length - 1]!);
  const earlier = points.slice(0, -1);
  const baseline = earlier.reduce((sum, p) => sum + rate(p), 0) / earlier.length;
  const delta = Math.round(latest - baseline);

  if (delta >= 5) return { direction: "improving", delta };
  if (delta <= -5) return { direction: "declining", delta };
  return { direction: "stable", delta };
}

/**
 * Leaders in the order an overview should read them.
 *
 * By state — whoever needs following up first — and alphabetically within it.
 * Never by a score, and never best-to-worst: the ordering exists so nothing
 * urgent is missed, not so anyone can be ranked.
 */
export function matrixOrder(
  leaders: LeaderStatus[],
  nameOf: (id: string) => string,
): LeaderStatus[] {
  const weight: Record<ObligationStatus, number> = {
    blocked: 0,
    warning: 1,
    in_progress: 2,
    not_started: 3,
    done: 4,
  };
  return [...leaders].sort(
    (a, b) =>
      weight[a.overall] - weight[b.overall] || nameOf(a.personId).localeCompare(nameOf(b.personId)),
  );
}
