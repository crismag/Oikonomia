import { z } from "zod";

/**
 * Google Drive, as the binder understands it.
 *
 * Files live in Drive. The binder keeps a record of each one — its Drive file
 * id, where it opens, what it was called — and asks Drive for the rest when a
 * list is shown. Nothing here holds a file's content, and an upload passes
 * through the server to Drive without being kept.
 *
 * Browser-safe: no React, no database, no Google client. The server module is
 * `src/server/google/drive.ts`.
 */

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/**
 * The largest file an upload may carry.
 *
 * The request is read into memory on its way to Drive, so the limit protects
 * the server as much as it describes Drive. Larger files are uploaded in Drive
 * itself and then chosen here.
 */
export const DRIVE_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

export const uploadTooLarge =
  "That file is larger than 25 MB. Upload it in Google Drive, then choose it here.";

/** A file or folder, as Drive describes it to the person asking. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  folder: boolean;
  iconLink?: string;
  webViewLink?: string;
  /** ISO timestamp. */
  modifiedTime?: string;
  ownerName?: string;
  ownerEmail?: string;
  /** Bytes. Google's own formats have none. */
  size?: number;
}

export interface DriveListing {
  files: DriveFile[];
  nextPageToken?: string;
}

/** Where a leader is looking. */
export type DriveSource = "ministry" | "mine" | "shared";

export const driveSourceLabel: Record<DriveSource, string> = {
  ministry: "Ministry folder",
  mine: "My Drive",
  shared: "Shared with me",
};

/** What a browse answers, including why a ministry folder cannot be shown. */
export interface DriveBrowse extends DriveListing {
  /**
   * `no-root`: this installation names no church Drive folder, so ministries
   * have no folders. `not-yet`: the ministry's folder is made when the first
   * file is added to it.
   */
  folderUnavailable?: "no-root" | "not-yet";
}

/** Google's own file types a leader can start from the binder. */
export type NewGoogleFileKind = "doc" | "sheet" | "slides";

export const googleFileMimeType: Record<NewGoogleFileKind, string> = {
  doc: "application/vnd.google-apps.document",
  sheet: "application/vnd.google-apps.spreadsheet",
  slides: "application/vnd.google-apps.presentation",
};

export const googleFileLabel: Record<NewGoogleFileKind, string> = {
  doc: "Google Doc",
  sheet: "Google Sheet",
  slides: "Google Slides",
};

/**
 * What kind of thing a Drive file is, in the binder's words.
 *
 * The registry's `kind` is what the thing is, never the provider — so a Google
 * Sheet is a Spreadsheet, as an Excel file would be.
 */
export function kindForMimeType(mimeType: string): string {
  if (mimeType === FOLDER_MIME_TYPE) return "Folder";
  if (mimeType === googleFileMimeType.doc) return "Document";
  if (mimeType === googleFileMimeType.sheet) return "Spreadsheet";
  if (mimeType === googleFileMimeType.slides) return "Presentation";
  if (mimeType === "application/vnd.google-apps.form") return "Form";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") {
    return "Spreadsheet";
  }
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "Presentation";
  if (
    mimeType === "application/pdf" ||
    mimeType.includes("wordprocessing") ||
    mimeType === "application/msword" ||
    mimeType.startsWith("text/")
  ) {
    return "Document";
  }
  return "File";
}

/**
 * The Drive file id inside a Drive or Docs address, when there is one.
 *
 * Documents registered by pasting a link before Drive was connected carry only
 * the address; reading the id back out of it lets them show live details too.
 * Only Google's own hosts are read — any other address has no Drive id.
 */
export function driveFileIdFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "drive.google.com" && host !== "docs.google.com") return undefined;

  const path = /\/d\/([A-Za-z0-9_-]{10,})/.exec(parsed.pathname);
  if (path) return path[1];
  const folder = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(parsed.pathname);
  if (folder) return folder[1];
  const id = parsed.searchParams.get("id");
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : undefined;
}

/**
 * Which icon a Drive file is drawn with.
 *
 * Drive's own `iconLink` images are served from Google's hosts, which the
 * page's content security policy does not load — deliberately; so the binder
 * draws its own, chosen from the file's type.
 */
export type DriveIcon = "folder" | "document" | "spreadsheet" | "presentation" | "image" | "file";

export function driveIcon(mimeType: string): DriveIcon {
  if (mimeType === FOLDER_MIME_TYPE) return "folder";
  if (mimeType.startsWith("image/")) return "image";
  const kind = kindForMimeType(mimeType);
  if (kind === "Spreadsheet") return "spreadsheet";
  if (kind === "Presentation") return "presentation";
  if (kind === "Document") return "document";
  return "file";
}

/** "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What Drive says now about a registered document, or that it will not say. */
export type DriveDetails =
  | { documentId: string; available: true; file: DriveFile }
  /* Google refused, or the file is gone. The binder cannot tell which, and
     does not guess: the row still opens its address and Drive decides. */
  | { documentId: string; available: false };

/* ------------------------------------------------------------- contracts */

const driveId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,200}$/, "That is not a Drive item.");

export const browseDrive = z.object({
  source: z.enum(["ministry", "mine", "shared"]),
  ministryId: z.string().trim().max(100).optional(),
  folderId: driveId.optional(),
  search: z.string().trim().max(200).optional(),
  pageToken: z.string().trim().max(2000).optional(),
});

export const registerDriveFile = z.object({
  fileId: driveId,
  ministryId: z.string().trim().min(1).max(100).optional(),
});

export const createGoogleFile = z.object({
  ministryId: z.string().trim().min(1, "A new file goes into a ministry's folder.").max(100),
  kind: z.enum(["doc", "sheet", "slides"]),
  name: z.string().trim().min(1, "Give it a name you would look for it by.").max(200),
});

export const driveDetails = z.object({
  documentIds: z.array(z.string().trim().min(1).max(100)).max(100),
});
