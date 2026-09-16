/**
 * Information, and the small part of it that asks something of leadership.
 *
 * ## The rule this module exists to enforce
 *
 * **Information is the default.** A leader who writes a report, a note, an
 * entry or a goal update has published information: it reaches its audience,
 * it is new until somebody reads it, and then it is read. It does not become
 * somebody's task, and nobody has to process it for the church to carry on.
 *
 * An obligation appears only when a leader **explicitly asks for one**, in one
 * of three shapes, or when a leader who received information decides on their
 * own that something must be done about it.
 *
 * | Ask | Means | Creates |
 * | --- | --- | --- |
 * | Attention | "notice this, consider it" | elevated information |
 * | Action | "do this specific thing" | work |
 * | Approval | "decide before I proceed" | a decision |
 *
 * Forty weekly reports produce forty pieces of information and, on a normal
 * week, perhaps six obligations. A product that turns them into forty reviews
 * has made its leaders into a processing queue, which is the failure this
 * module is written against.
 *
 * ## What this is not
 *
 * Not a ticketing system. An action has four states and stops; an approval has
 * two outcomes and a way to ask for more information. Attention has no
 * lifecycle at all — a leader may read it and do nothing, and that is a
 * complete and correct outcome.
 */

export type EscalationType = "attention" | "action" | "approval";

/** What the author chose on the submission form. Informational is the default. */
export type LeadershipResponse = "informational" | EscalationType;

export const leadershipResponses: LeadershipResponse[] = [
  "informational",
  "attention",
  "action",
  "approval",
];

/** Human wording. The interface says these; the database stores the keys. */
export const responseLabel: Record<LeadershipResponse, string> = {
  informational: "No — informational only",
  attention: "Please take notice",
  action: "I need an action",
  approval: "I need approval",
};

export const responseHint: Record<LeadershipResponse, string> = {
  informational: "It reaches your leaders and is there to read. Nothing is asked of them.",
  attention: "Leadership should notice and consider this. It does not ask for anything specific.",
  action: "Somebody in leadership needs to do a particular thing.",
  approval: "A decision is needed before this can go ahead.",
};

export const escalationLabel: Record<EscalationType, string> = {
  attention: "Needs attention",
  action: "Action requested",
  approval: "Approval requested",
};

/**
 * What each kind of ask does to the person who receives it.
 *
 * Written down because the difference is the whole point: "consider" is not
 * "act", and "act" is not "decide". Three words, three obligations, and none
 * of them is "process this because it arrived".
 */
export const escalationVerb: Record<EscalationType, string> = {
  attention: "Consider",
  action: "Act",
  approval: "Decide",
};

/* ------------------------------------------------------------- lifecycles */

/** Attention has no lifecycle. It is read, and then it is up to the reader. */
export type AttentionStatus = "raised" | "noted";

export type ActionStatus =
  "requested" | "assigned" | "in-progress" | "completed" | "unable" | "not-required";

export type ApprovalStatus = "requested" | "approved" | "declined" | "more-information";

export type EscalationStatus = AttentionStatus | ActionStatus | ApprovalStatus;

export const statusesFor: Record<EscalationType, EscalationStatus[]> = {
  attention: ["raised", "noted"],
  action: ["requested", "assigned", "in-progress", "completed", "unable", "not-required"],
  approval: ["requested", "approved", "declined", "more-information"],
};

export const escalationStatusLabel: Record<EscalationStatus, string> = {
  raised: "Needs attention",
  noted: "Noted",
  requested: "Requested",
  assigned: "Assigned",
  "in-progress": "In progress",
  completed: "Completed",
  unable: "Unable to complete",
  "not-required": "Not required",
  approved: "Approved",
  declined: "Declined",
  "more-information": "More information requested",
};

/** The status an escalation of this kind starts in. */
export const initialStatus: Record<EscalationType, EscalationStatus> = {
  attention: "raised",
  action: "requested",
  approval: "requested",
};

/**
 * Whether this is finished with.
 *
 * Deliberately generous about attention: noticing it *is* the whole
 * obligation, so a leader who has read it and decided to do nothing has
 * finished, and the workspace must stop asking.
 */
export function isSettled(type: EscalationType, status: EscalationStatus): boolean {
  if (type === "attention") return status === "noted";
  if (type === "action") return ["completed", "unable", "not-required"].includes(status);
  return ["approved", "declined"].includes(status);
}

/** Which statuses one may move to, from where. Refused anywhere else. */
export const allowedTransitions: Record<EscalationStatus, EscalationStatus[]> = {
  raised: ["noted"],
  noted: ["raised"],

  requested: [
    "assigned",
    "in-progress",
    "completed",
    "unable",
    "not-required",
    "approved",
    "declined",
    "more-information",
  ],
  assigned: ["in-progress", "completed", "unable", "not-required"],
  "in-progress": ["completed", "unable", "not-required"],
  completed: ["in-progress"],
  unable: ["in-progress"],
  "not-required": ["in-progress"],

  approved: [],
  declined: [],
  /* Answering a question about a request puts it back in front of the
     approver; the request itself never became a different request. */
  "more-information": ["approved", "declined", "requested"],
};

/* ------------------------------------------------- who it is addressed to */

/**
 * Semantic recipients.
 *
 * A request is addressed to a **position**, not to a name, because the church
 * reorganises and a stored name would quietly send next year's requests to
 * last year's leader. `requestedFromPerson` exists for the case where somebody
 * genuinely means one particular person.
 */
export type RecipientRole =
  "reporting-leader" | "ministry-head" | "campus-leadership" | "church-leadership";

export const recipientRoles: RecipientRole[] = [
  "reporting-leader",
  "ministry-head",
  "campus-leadership",
  "church-leadership",
];

export const recipientLabel: Record<RecipientRole, string> = {
  "reporting-leader": "My reporting leader",
  "ministry-head": "The ministry head",
  "campus-leadership": "Campus leadership",
  "church-leadership": "Church leadership",
};

/** Where an escalation came from, so the inbox can open the right page. */
export type EscalationSourceType =
  | "leadership-report"
  | "reach-out-report"
  | "meeting-note"
  | "lifegroup-entry"
  | "gathering"
  | "goal"
  | "ministry"
  | "work";

/**
 * Where to continue an ask — the record it came from, never a copy of it.
 *
 * Meeting notes are addressed by search (`?note=`), not by a path segment, so
 * this returns a structured href rather than a string a Link would have to
 * parse. A missing type returns nothing: inventing a page would be a dead end.
 */
export function escalationHref(
  sourceType: EscalationSourceType,
  sourceId: string,
): { to: string; search?: Record<string, string> } | null {
  switch (sourceType) {
    case "leadership-report":
      return { to: `/leadership-reports/${sourceId}` };
    case "reach-out-report":
      return { to: `/reach-out/${sourceId}` };
    case "meeting-note":
      return { to: "/meeting-notes", search: { note: sourceId } };
    case "gathering":
    case "lifegroup-entry":
      return { to: `/lifegroups/${sourceId}` };
    case "goal":
      return { to: `/goals/${sourceId}` };
    case "ministry":
      return { to: `/ministries/${sourceId}` };
    case "work":
      return { to: `/work/${sourceId}` };
    default:
      return null;
  }
}

/**
 * The day an ask lands on when a leader puts it on their week.
 *
 * Its needed-by date while that is still ahead; otherwise today, because a
 * date already past is not a day anyone can still plan.
 */
export function weekDateFor(ask: { neededBy?: string | undefined }, today: string): string {
  return ask.neededBy && ask.neededBy >= today ? ask.neededBy : today;
}

/**
 * Whether an ask is already on this leader's week.
 *
 * An agenda item names the ask it was put on the week for, so that is what is
 * matched. Items from before that link existed carry no ask, and only those
 * are recognised by their text — a linked item is never mistaken for another
 * ask worded the same. A completed item does not count: that was the last time.
 */
export function isOnTheWeek(
  ask: { id: string; request: string },
  agenda: readonly { text: string; completed: boolean; escalationId?: string | undefined }[],
): boolean {
  return agenda.some(
    (entry) =>
      !entry.completed &&
      (entry.escalationId ? entry.escalationId === ask.id : entry.text === ask.request),
  );
}

/**
 * Actions asked of this viewer that came from one record.
 *
 * Takes the viewer's own unsettled asks (the inbox's `mine`), never a list of
 * every ask on the record: a recipient's controls belong to the recipient.
 */
export function actionsAskedOn<
  T extends { type: EscalationType; sourceType: EscalationSourceType; sourceId: string },
>(mine: readonly T[], sourceType: EscalationSourceType, sourceId: string): T[] {
  return mine.filter(
    (item) =>
      item.type === "action" && item.sourceType === sourceType && item.sourceId === sourceId,
  );
}

export interface Escalation {
  id: string;
  type: EscalationType;
  status: EscalationStatus;

  sourceType: EscalationSourceType;
  sourceId: string;
  /** The entry within the source, when only one part of it is escalated. */
  entryId?: string;
  /** How to name the place it came from, without opening it. */
  contextLabel: string;

  /** What is being asked. Required: an ask with no words is not an ask. */
  request: string;

  requestedById: string;
  requestedFromRole?: RecipientRole;
  requestedFromPersonId?: string;
  neededBy?: string;

  /** Action only: who picked it up. */
  assigneeId?: string;

  /** Approval only, and the record of it. */
  decidedById?: string;
  decidedAt?: string;
  decisionNote?: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * Is this one mine to deal with?
 *
 * Addressed **to** me, or assigned to me, or asked of a position I hold.
 * Deliberately not "anyone who can read the source": being able to read a
 * report is not being asked to do something about it.
 */
export function addressedTo(
  escalation: Escalation,
  person: { id: string; ministryIds: string[] },
  holds: RecipientRole[],
): boolean {
  if (escalation.assigneeId === person.id) return true;
  if (escalation.requestedFromPersonId === person.id) return true;
  if (escalation.requestedFromRole && holds.includes(escalation.requestedFromRole)) return true;
  return false;
}

/** Most demanding first: decide, then act, then consider. */
const weight: Record<EscalationType, number> = { approval: 0, action: 1, attention: 2 };

export function escalationOrder(a: Escalation, b: Escalation): number {
  if (weight[a.type] !== weight[b.type]) return weight[a.type] - weight[b.type];

  /* A deadline outranks no deadline, and the nearer one comes first. */
  if (a.neededBy && b.neededBy && a.neededBy !== b.neededBy) {
    return a.neededBy.localeCompare(b.neededBy);
  }
  if (a.neededBy && !b.neededBy) return -1;
  if (!a.neededBy && b.neededBy) return 1;

  return b.createdAt.localeCompare(a.createdAt);
}

/** Overdue is only meaningful where somebody named a date. */
export function isOverdue(escalation: Escalation, today: string): boolean {
  if (!escalation.neededBy) return false;
  if (isSettled(escalation.type, escalation.status)) return false;
  return escalation.neededBy < today;
}

/**
 * Whether this person is party to an ask: the one who asked, or the one it is
 * for (by name, by position held, as assignee, or as the one who decided).
 *
 * Notes on an ask — a question, a reason for declining, why something could
 * not be done — are said between these people. Being able to read the record
 * the ask came from does not make somebody party to what was said about it.
 */
export function isPartyTo(
  escalation: Escalation,
  person: { id: string; ministryIds: string[] },
  holds: RecipientRole[],
): boolean {
  return (
    escalation.requestedById === person.id ||
    escalation.decidedById === person.id ||
    addressedTo(escalation, person, holds)
  );
}

/**
 * Whether the person who asked may still take it back.
 *
 * Only while it is open. A settled ask is the record of what happened, and a
 * decision stays on the record even if the requester changes their mind.
 */
export function canWithdraw(escalation: Pick<Escalation, "type" | "status" | "decidedById">) {
  return !escalation.decidedById && !isSettled(escalation.type, escalation.status);
}

/** Whether the ask is waiting on the person who made it to answer a question. */
export const awaitsRequesterReply = (escalation: Pick<Escalation, "status">) =>
  escalation.status === "more-information";

/**
 * What has been said on an ask since it was made, oldest first.
 *
 * The first activity entry is the ask itself, and its note is the request the
 * row already shows, so it is left out. Entries without words (a status moved
 * with nothing said) are not notes.
 */
export function askNotes<T extends { actorId: string; summary: string; note?: string | undefined }>(
  activity: readonly T[],
): (T & { note: string })[] {
  return activity
    .slice(1)
    .filter((entry): entry is T & { note: string } => !!entry.note && entry.note.trim() !== "");
}
