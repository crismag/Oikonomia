import type { BinderSection, MeetingBlock, ResourceAssociation } from "./types";

/**
 * The document registry, as the domain understands it.
 *
 * `DOCUMENT-REGISTRY.md` is the contract this implements. Two ideas from it
 * shape everything below:
 *
 * - **A document and an association are different concepts.** One registered
 *   resource takes part in many places and is never duplicated to do so.
 * - **The registry is not storage.** A record says what the application knows
 *   about a resource. Where the bytes live is supporting metadata, and nothing
 *   in the system fetches, copies or indexes them.
 *
 * Invariant 8: storage differences must not leak into the user-facing model.
 * So there is no "Drive document" or "Link document" as a category — `kind`
 * says what the thing is, and `origin` is only ever a supporting line.
 */

/** The records a document can take part in. */
export type DocumentEntityType =
  | "ministry"
  | "meeting-note"
  | "gathering"
  | "reach-out-report"
  | "leadership-report"
  | "form"
  | "schedule-entry"
  /* Prototype records that are not persisted yet but do own material: a unit
     of leadership work, and an event being prepared for. */
  | "work"
  | "event";

export const documentEntityTypes: DocumentEntityType[] = [
  "ministry",
  "meeting-note",
  "gathering",
  "reach-out-report",
  "leadership-report",
  "form",
  "schedule-entry",
  "work",
  "event",
];

export const isDocumentEntityType = (value: string): value is DocumentEntityType =>
  (documentEntityTypes as string[]).includes(value);

/**
 * How the document takes part, not merely that it does.
 *
 * Gap 3 in the registry document: Leadership Reports distinguished "Report
 * content" from "Supporting" by which field an id sat in, and the interface
 * inferred a label from the field name. That belongs on the association.
 */
export type DocumentRelationship = "filed-in" | "supporting" | "report-content";

export const relationshipLabel: Record<DocumentRelationship, string> = {
  "filed-in": "Filed here",
  supporting: "Supporting",
  "report-content": "Report content",
};

/**
 * Which binder section a record belongs to.
 *
 * The section is what a leader navigates; the entity type is what the record
 * is. Keeping the mapping here means search, filters and breadcrumbs all agree
 * about where something lives.
 */
export const sectionForEntity: Record<DocumentEntityType, BinderSection> = {
  ministry: "ministry",
  "meeting-note": "meeting-notes",
  gathering: "lifegroup",
  "reach-out-report": "reach-out",
  "leadership-report": "leadership-reports",
  form: "documents-forms",
  "schedule-entry": "monthly-calendar",
  work: "meeting-notes",
  event: "monthly-calendar",
};

/** A registry record. The row, not the search projection over it. */
export interface RegisteredDocument {
  id: string;
  title: string;
  description?: string;
  /** What the thing is, in the leader's words. */
  kind: string;
  origin: "binder" | "file" | "drive" | "link";
  /** Where the content lives, when it is not binder-native. */
  url?: string;
  fileName?: string;
  /** Opens inside the application, for binder-native resources. */
  openRoute?: string;
  tags: string[];
  registeredById: string;
  createdAt: string;
  updatedAt: string;
  associations: DocumentAssociation[];
}

/**
 * What a binder-native document says.
 *
 * Content, kept as a separate idea from the registry record that names it —
 * Invariant 7: the registry is not storage. A Drive document or a link has a
 * record and no content; only what the binder itself keeps has both.
 */
export interface BinderContent {
  documentId: string;
  blocks: MeetingBlock[];
  version: number;
  updatedAt: string;
  updatedById: string;
}

export interface DocumentAssociation {
  id: string;
  entityType: DocumentEntityType;
  /** Empty means the binder area as a whole rather than one record in it. */
  entityId: string;
  relationship: DocumentRelationship;
  createdById: string;
  createdAt: string;
}

/**
 * Whether opening the resource leaves the application.
 *
 * Boundary 2 of the registry contract: when it does, whoever owns the resource
 * decides whether it opens, and the application neither knows nor should
 * pretend to. A Drive document the viewer may find here may still be refused
 * by Google, and that is correct.
 */
export const opensElsewhere = (document: { origin: RegisteredDocument["origin"] }) =>
  document.origin === "drive" || document.origin === "link";

/**
 * What to call where the content lives.
 *
 * Natural language rather than the stored enum — a leader should never have to
 * learn the storage architecture to use their binder.
 */
export const originLabel: Record<RegisteredDocument["origin"], string> = {
  binder: "In the binder",
  file: "Uploaded file",
  drive: "Google Drive",
  link: "Link",
};

/**
 * Where a URL points, as far as the application is willing to claim.
 *
 * This reads the address and nothing else. It does not check that the document
 * exists, that it opens, or that anyone can reach it — there is no Google
 * Workspace integration here (§37), and a guess dressed up as a connection
 * would be exactly the kind of claim the binder should not make.
 */
export function originForUrl(url: string): "drive" | "link" {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "drive.google.com" || host === "docs.google.com" ? "drive" : "link";
  } catch {
    return "link";
  }
}

/** "Ministry › Music Ministry", "LifeGroup › Thomson Park › 3 Sep". */
export function contextPath(association: ResourceAssociation, sectionName: string): string {
  return [sectionName, association.label, association.secondaryLabel].filter(Boolean).join(" › ");
}
