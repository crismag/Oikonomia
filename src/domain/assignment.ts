import { config } from "@/config";

/**
 * Where a person serves, and on whose authority.
 *
 * ## The four questions
 *
 * An assignment answers all four, where membership used to answer one:
 *
 * | Question                              | Field      |
 * | ------------------------------------- | ---------- |
 * | Where does this person serve?         | `groupId`  |
 * | What do they do there?                | `function` |
 * | Is it current, or is it history?      | `status`   |
 * | Did the church say so, or did they?   | `status`   |
 *
 * The last is the one that matters. A leader saying "I am part of the music
 * ministry" during onboarding is a **claim**, and a claim is not an
 * organisational fact until somebody who may decide says it is.
 *
 * ## Function is not permission
 *
 * `function` is what the church calls the job — "Head", "Coordinator" — and it
 * grants **nothing**. Authorization reads capabilities, membership and
 * ownership. Naming somebody "Head" here gives them no more access than naming
 * them "Member": `roles-are-not-permissions.test.ts` is the guard, and this is
 * the sentence it exists to keep true.
 *
 * ## Two storages, one answer
 *
 * Ministries keep their own membership table because a ministry is not a kind
 * of group — it carries goals, documents and a lead. The columns are identical
 * so both read as assignments, and `assignmentsFor` unions them. There is one
 * authoritative answer to "where does this person serve"; there are two places
 * it is written.
 */

export const assignmentStatuses = [
  /** The church has said so. This is the only status that counts as serving. */
  "confirmed",
  /** The person said so, and nobody has confirmed it. */
  "pending",
  /** Somebody has said the record is wrong; an administrator is to look. */
  "correction-requested",
  /** It was true and is not any more. History, kept. */
  "ended",
] as const;

export type AssignmentStatus = (typeof assignmentStatuses)[number];

/** Which organisational thing the person is assigned to. */
export type AssignmentScope = "ministry" | "group";

export interface Assignment {
  scope: AssignmentScope;
  /** The ministry or responsibility group. */
  targetId: string;
  personId: string;
  /** What the church calls the job here. Free text; grants nothing. */
  function: string;
  status: AssignmentStatus;
  startedAt?: string;
  endedAt?: string;
  /** Ministries only: given access to the ministry's information without joining it. */
  shared?: boolean;
}

/**
 * Whether this assignment is the church's own answer about where somebody
 * serves.
 *
 * **Only `confirmed`.** A pending claim is not membership, and a correction
 * request means somebody has said the record is wrong — neither is something
 * to grant a workspace from. An unrecognised status is not current either: the
 * closed direction, as everywhere else.
 */
export const isServing = (status: string): boolean => status === "confirmed";

/** Still part of what is going on, rather than history. */
export const isCurrentAssignment = (status: string): boolean =>
  status === "confirmed" || status === "pending" || status === "correction-requested";

/** Waiting for somebody to decide. What the administration screen counts. */
export const needsDecision = (status: string): boolean =>
  status === "pending" || status === "correction-requested";

export const assignmentStatusLabel: Record<AssignmentStatus, string> = {
  confirmed: "Confirmed",
  pending: "Awaiting confirmation",
  "correction-requested": "Correction requested",
  ended: "Ended",
};

/** What a church calls this job, when the id is one it configured. */
export function functionLabel(value: string): string {
  if (!value) return "";
  const option = config
    .options("organization.assignmentFunctions")
    .find((candidate) => candidate.id === value);
  return option?.label ?? value;
}

/** What a church calls this kind of group. */
export function groupTypeLabel(value: string): string {
  const option = config.options("organization.groupTypes").find((c) => c.id === value);
  return option?.label ?? value;
}

/**
 * A sentence describing one assignment, for a person's own page.
 *
 * Written for somebody reading their own record during onboarding, so it says
 * what is true rather than what a database row contains: an unconfirmed claim
 * reads as a claim.
 */
export function assignmentSentence(assignment: Assignment, targetName: string): string {
  const role = functionLabel(assignment.function);
  const where = role ? `${role} · ${targetName}` : targetName;

  switch (assignment.status) {
    case "confirmed":
      return where;
    case "pending":
      return `${where} — awaiting confirmation`;
    case "correction-requested":
      return `${where} — correction requested`;
    default:
      return `${where} — ended`;
  }
}
