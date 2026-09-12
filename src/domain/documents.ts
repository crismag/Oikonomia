import type { BinderDocument, BinderDocumentType, DocumentOrigin, DocumentOwner } from "./types";

/**
 * Binder documents.
 *
 * One shared model for the working material every binder area accumulates —
 * Ministry's plans and reports, Reach-Out's planning documents and references,
 * and whatever the remaining sections turn out to keep. Sections specialize how
 * documents are *surfaced*; none of them owns a document subsystem of its own.
 *
 * > **A document is not a file.**
 *
 * The binder holds the record; `origin` says where the content actually lives.
 */

export const documentTypeLabel: Record<BinderDocumentType, string> = {
  goals: "Goals",
  plan: "Plan",
  report: "Report",
  update: "Update",
  "meeting-note": "Meeting Note",
  announcement: "Announcement",
  checklist: "Checklist",
  document: "Document",
  spreadsheet: "Spreadsheet",
  form: "Form",
  schedule: "Schedule",
  file: "File",
  link: "Link",
};

/**
 * What the reader is told about where a document lives.
 *
 * Deliberately natural language rather than the internal enum — a leader
 * should never have to learn the storage architecture to use their binder.
 */
export const originLabel: Record<DocumentOrigin, string> = {
  binder: "In the binder",
  file: "Uploaded file",
  drive: "Google Drive",
  link: "Link",
};

/**
 * The origin line under a document title.
 *
 * Left empty when it would only repeat the type — a document of type Link kept
 * behind a link does not need to say "Link · Link".
 */
export function originNote(document: BinderDocument): string {
  if (document.type === "link" && document.origin === "link") return "";
  if (document.type === "file" && document.origin === "file") return "";
  return originLabel[document.origin];
}

/** Binder-native documents are editable here; the rest open where they live. */
export const isBinderNative = (origin: DocumentOrigin) => origin === "binder";

export function ownedBy(document: BinderDocument, owner: DocumentOwner): boolean {
  if (document.owner.kind !== owner.kind) return false;
  if (owner.kind === "ministry" && document.owner.kind === "ministry") {
    return document.owner.ministryId === owner.ministryId;
  }
  return true;
}

/** One area's documents, newest first. */
export function documentsOwnedBy(
  documents: BinderDocument[],
  owner: DocumentOwner,
): BinderDocument[] {
  return documents
    .filter((document) => ownedBy(document, owner))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function pinnedFirst(documents: BinderDocument[]): BinderDocument[] {
  return [...documents].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
}

/** Types actually present, so a filter bar shows no dead options. */
export function usedTypes(documents: BinderDocument[]): BinderDocumentType[] {
  const present = new Set(documents.map((document) => document.type));
  return (Object.keys(documentTypeLabel) as BinderDocumentType[]).filter((type) =>
    present.has(type),
  );
}

export function searchDocuments(documents: BinderDocument[], query: string): BinderDocument[] {
  const q = query.trim().toLowerCase();
  if (!q) return documents;
  return documents.filter(
    (document) =>
      document.title.toLowerCase().includes(q) ||
      (document.description ?? "").toLowerCase().includes(q) ||
      documentTypeLabel[document.type].toLowerCase().includes(q),
  );
}
