import { canContribute, relationshipTo } from "./ministry";
import { sectionLabel } from "./resources";
import { isWebAddress } from "./web-address";
import type {
  DocumentAssociation,
  DocumentEntityType,
  DocumentRelationship,
  RegisteredDocument,
} from "./registry";
import type { BinderSection, Ministry } from "./types";

/**
 * One registered document, as its own page shows it.
 *
 * The rules here are the service's rules, stated once so the page and the
 * server cannot disagree: a page that offers "Unfile" to someone the server
 * refuses is a dead end dressed up as a control.
 */

/** Where a document takes part, named for this viewer. */
export interface DocumentPlace {
  /** The association's id — what unfiling removes. */
  id: string;
  entityType: DocumentEntityType;
  entityId: string;
  relationship: DocumentRelationship;
  section: BinderSection;
  label?: string;
  secondaryLabel?: string;
  /** Whether this viewer may remove the document from this place. */
  mayUnfile: boolean;
}

/** What `/documents/$documentId` needs to show a registered document. */
export interface DocumentRecord {
  document: RegisteredDocument;
  /** Only places this viewer may discover. A place they may not is not listed. */
  places: DocumentPlace[];
  mayEdit: boolean;
  /** The Drive file behind it, recorded or read from its address. */
  driveFileId?: string;
}

/** The ministry a document belongs to: the first ministry it is filed in. */
export function ministryIdOf(document: Pick<RegisteredDocument, "associations">) {
  return document.associations.find((a) => a.entityType === "ministry")?.entityId;
}

/**
 * Who may change a document's record.
 *
 * A ministry's material is changed by the people who work in that ministry —
 * being shared with it is not membership. A document filed in no ministry is
 * its registrant's.
 *
 * `ministry` is the one `ministryIdOf` names, or undefined when there is none
 * (or it no longer exists, in which case the registrant still may).
 */
export function mayChangeDocument(
  document: Pick<RegisteredDocument, "registeredById">,
  ministry: Ministry | undefined,
  personId: string,
): boolean {
  if (ministry) return canContribute(relationshipTo(ministry, personId));
  return document.registeredById === personId;
}

/**
 * Whether a filing may be removed.
 *
 * A binder-native document lives in its ministry — that filing is where it
 * is, not a reference to it — so it is never offered for unfiling.
 */
export function mayUnfile(
  document: Pick<RegisteredDocument, "origin">,
  association: Pick<DocumentAssociation, "entityType">,
  mayChange: boolean,
): boolean {
  if (!mayChange) return false;
  return !(document.origin === "binder" && association.entityType === "ministry");
}

/**
 * An address safe to open, or nothing.
 *
 * Stored addresses are validated on the way in; this is the second check on
 * the way out, because a row written before that validation existed is still
 * rendered as an `href` for everybody who opens the record.
 */
export function openableUrl(url: string | undefined): string | undefined {
  return url && isWebAddress(url) ? url : undefined;
}

/** "Music Ministry", or the binder area when the filing names no one record. */
export function placeName(place: Pick<DocumentPlace, "section" | "label">): string {
  return place.label ?? sectionLabel[place.section];
}

/** A document's own page. Every list that shows a document leads here. */
export const documentHref = (id: string) => ({
  to: "/documents/$documentId" as const,
  params: { documentId: id },
});

/**
 * The record a place names, when the binder has a page for it.
 *
 * An area-wide filing (no id) and records without a page of their own (events,
 * calendar entries) have no link, and are shown as words only.
 */
export function placeHref(
  place: Pick<DocumentPlace, "entityType" | "entityId">,
): { to: string; search?: Record<string, string> } | undefined {
  if (!place.entityId) return undefined;
  const id = encodeURIComponent(place.entityId);
  switch (place.entityType) {
    case "ministry":
      return { to: `/ministries/${id}`, search: { view: "documents" } };
    case "gathering":
      return { to: `/lifegroups/${id}` };
    case "reach-out-report":
      return { to: `/reach-out/${id}` };
    case "leadership-report":
      return { to: `/leadership-reports/${id}` };
    case "form":
      return { to: `/forms/${id}` };
    case "work":
      return { to: `/work/${id}` };
    case "meeting-note":
      return { to: "/meeting-notes", search: { note: place.entityId } };
    default:
      return undefined;
  }
}
