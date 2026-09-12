import { documentsOwnedBy } from "./documents";
import type {
  BinderDocument,
  MeetingNote,
  Ministry,
  MinistryActivity,
  MinistryRelationship,
} from "./types";

/**
 * Ministry logic.
 *
 * A ministry is an organizational working area that owns its information. A
 * person's relationship to it — lead, participate, shared — decides what they
 * see and what they can do, and is derived rather than stored per person.
 */

/* --------------------------------------------------------- relationships */

export function relationshipTo(ministry: Ministry, personId: string): MinistryRelationship {
  if (ministry.leadId === personId) return "lead";
  if (ministry.teamIds.includes(personId)) return "participate";
  if (ministry.sharedWithIds?.includes(personId)) return "shared";
  return "none";
}

export const relationshipLabel: Record<MinistryRelationship, string> = {
  lead: "You lead this ministry",
  participate: "You serve here",
  shared: "Shared with you",
  none: "",
};

/** Leading grants management; participating grants contribution. */
export function canManage(relationship: MinistryRelationship): boolean {
  return relationship === "lead";
}

export function canContribute(relationship: MinistryRelationship): boolean {
  return relationship === "lead" || relationship === "participate";
}

/** Ministries a person is connected to, strongest relationship first. */
export function ministriesFor(ministries: Ministry[], personId: string): Ministry[] {
  const order: MinistryRelationship[] = ["lead", "participate", "shared"];
  return ministries
    .filter((m) => relationshipTo(m, personId) !== "none")
    .sort(
      (a, b) =>
        order.indexOf(relationshipTo(a, personId)) - order.indexOf(relationshipTo(b, personId)),
    );
}

/* -------------------------------------------------------------- documents */

/*
 * Ministry does not own a document model. It surfaces the binder's shared one,
 * scoped to the ministry that the documents belong to — see `documents.ts`.
 */
export function documentsFor(documents: BinderDocument[], ministryId: string): BinderDocument[] {
  return documentsOwnedBy(documents, { kind: "ministry", ministryId });
}

/* ---------------------------------------------------------- meeting notes */

/**
 * Meeting notes that were held for, or about, this ministry.
 *
 * The association is a binder link on the note itself, so the note stays one
 * record: the ministry shows it, Meeting Notes owns it, nothing is copied.
 */
export function notesForMinistry(notes: MeetingNote[], ministryId: string): MeetingNote[] {
  return notes
    .filter((note) => note.links.some((link) => link.kind === "ministry" && link.id === ministryId))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/* --------------------------------------------------------------- activity */

export function activityFor(activity: MinistryActivity[], ministryId: string): MinistryActivity[] {
  return activity
    .filter((entry) => entry.ministryId === ministryId)
    .sort((a, b) => b.at.localeCompare(a.at));
}
