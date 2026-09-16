import { ApiError } from "../api/response";
import {
  DRIVE_UPLOAD_LIMIT_BYTES,
  FOLDER_MIME_TYPE,
  googleFileMimeType,
  uploadTooLarge,
  type DriveFile,
  type DriveListing,
  type NewGoogleFileKind,
} from "@/domain/drive";
import { googleRequest, WORKSPACE_SCOPES, type WorkspaceConfig } from "./workspace";

/**
 * Google Drive, through Workspace delegation.
 *
 * Every call names who it acts as. For a leader's own browsing, choosing,
 * uploading and creating that is the leader — so Google's sharing decides what
 * they may see and where they may write, and Oikonomia never reaches a file the
 * leader could not open in Drive themselves. Only ministry folders are made as
 * the church mailbox (`ensureMinistryFolder` in `drive-service.ts`), because they belong to the church, not
 * to whoever happened to add the first file.
 *
 * Nothing here keeps a file. An upload's bytes arrive, are sent on, and are
 * gone.
 */

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/** The fields every listing and lookup asks for — no more. */
const FILE_FIELDS =
  "id,name,mimeType,iconLink,webViewLink,modifiedTime,owners(displayName,emailAddress),size";

const scopes = [WORKSPACE_SCOPES.drive] as const;

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  owners?: { displayName?: string; emailAddress?: string }[];
  size?: string;
}

/** Drive's reply, in the binder's shape. Absent fields stay absent. */
export function toDriveFile(raw: RawFile): DriveFile {
  const owner = raw.owners?.[0];
  const size = raw.size !== undefined ? Number(raw.size) : undefined;
  return {
    id: raw.id,
    name: raw.name,
    mimeType: raw.mimeType,
    folder: raw.mimeType === FOLDER_MIME_TYPE,
    ...(raw.iconLink ? { iconLink: raw.iconLink } : {}),
    ...(raw.webViewLink ? { webViewLink: raw.webViewLink } : {}),
    ...(raw.modifiedTime ? { modifiedTime: raw.modifiedTime } : {}),
    ...(owner?.displayName ? { ownerName: owner.displayName } : {}),
    ...(owner?.emailAddress ? { ownerEmail: owner.emailAddress } : {}),
    ...(size !== undefined && Number.isFinite(size) ? { size } : {}),
  };
}

/** A value inside a Drive query string: `'` and `\` escaped, as Drive requires. */
export const quoteDrive = (value: string) =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export type ListRequest =
  | { in: "folder"; folderId: string; search?: string | undefined; pageToken?: string | undefined }
  | { in: "my-drive"; search?: string | undefined; pageToken?: string | undefined }
  | { in: "shared"; search?: string | undefined; pageToken?: string | undefined };

/**
 * The `files.list` address for a request.
 *
 * Kept apart from the call so what is asked of Drive can be read in a test.
 * A search inside My Drive or Shared with me searches that place, not all of
 * Drive — the tab a leader is on is where they are looking.
 */
export function listUrl(request: ListRequest): string {
  const clauses = ["trashed = false"];
  if (request.in === "folder") clauses.push(`${quoteDrive(request.folderId)} in parents`);
  if (request.in === "my-drive") clauses.push("'root' in parents");
  if (request.in === "shared") clauses.push("sharedWithMe = true");
  if (request.search?.trim()) clauses.push(`name contains ${quoteDrive(request.search.trim())}`);

  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: "50",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    /* A ministry folder may sit in a shared drive; a leader's own Drive and
       what is shared with them are theirs. */
    corpora: request.in === "folder" ? "allDrives" : "user",
    /* Drive refuses ordering on sharedWithMe queries. */
    ...(request.in === "shared" ? {} : { orderBy: "folder,modifiedTime desc" }),
  });
  if (request.pageToken) params.set("pageToken", request.pageToken);
  return `${API}?${params.toString()}`;
}

export async function listFiles(
  config: WorkspaceConfig,
  subject: string,
  request: ListRequest,
): Promise<DriveListing> {
  const reply = await googleRequest<{ files?: RawFile[]; nextPageToken?: string }>(config, {
    subject,
    scopes,
    url: listUrl(request),
  });
  return {
    files: (reply?.files ?? []).map(toDriveFile),
    ...(reply?.nextPageToken ? { nextPageToken: reply.nextPageToken } : {}),
  };
}

export async function getFile(
  config: WorkspaceConfig,
  subject: string,
  fileId: string,
): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: "true" });
  const raw = await googleRequest<RawFile>(config, {
    subject,
    scopes,
    url: `${API}/${encodeURIComponent(fileId)}?${params.toString()}`,
  });
  return toDriveFile(raw);
}

/**
 * Many files, each as the person asking.
 *
 * A file Google will not show them — gone, or never shared — comes back as
 * `undefined` rather than failing the whole list. A handful at a time, so a
 * long shelf does not open fifty connections at once.
 */
export async function getFiles(
  config: WorkspaceConfig,
  subject: string,
  fileIds: string[],
): Promise<Map<string, DriveFile | undefined>> {
  const out = new Map<string, DriveFile | undefined>();
  const unique = [...new Set(fileIds)];
  for (let i = 0; i < unique.length; i += 8) {
    const batch = unique.slice(i, i + 8);
    const results = await Promise.all(
      batch.map((id) =>
        getFile(config, subject, id).then(
          (file) => file,
          (error: unknown) => {
            if (
              error instanceof ApiError &&
              (error.code === "not-found" || error.code === "forbidden")
            ) {
              return undefined;
            }
            throw error;
          },
        ),
      ),
    );
    batch.forEach((id, index) => out.set(id, results[index]));
  }
  return out;
}

async function createMetadataOnly(
  config: WorkspaceConfig,
  subject: string,
  body: { name: string; mimeType: string; parents: string[] },
): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: "true" });
  const raw = await googleRequest<RawFile>(config, {
    subject,
    scopes,
    method: "POST",
    url: `${API}?${params.toString()}`,
    json: body,
  });
  return toDriveFile(raw);
}

export function createFolder(
  config: WorkspaceConfig,
  subject: string,
  name: string,
  parentId: string,
): Promise<DriveFile> {
  return createMetadataOnly(config, subject, {
    name,
    mimeType: FOLDER_MIME_TYPE,
    parents: [parentId],
  });
}

/** A new, empty Google Doc, Sheet or Slides file in a folder. */
export function createGoogleFile(
  config: WorkspaceConfig,
  subject: string,
  input: { name: string; kind: NewGoogleFileKind; parentId: string },
): Promise<DriveFile> {
  return createMetadataOnly(config, subject, {
    name: input.name,
    mimeType: googleFileMimeType[input.kind],
    parents: [input.parentId],
  });
}

/**
 * The body of a Drive multipart upload: metadata, then the bytes.
 *
 * Exported so a test can read exactly what would be sent.
 */
export function multipartBody(
  metadata: { name: string; mimeType: string; parents: string[] },
  bytes: Uint8Array,
  boundary: string,
): { body: Uint8Array; contentType: string } {
  const head = Buffer.from(
    `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${metadata.mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: new Uint8Array(Buffer.concat([head, Buffer.from(bytes), tail])),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

/**
 * Upload a file into a folder, as `subject`.
 *
 * Refused above the limit before Google is asked. The bytes are not kept
 * anywhere in Oikonomia — this is the whole of their journey.
 */
export async function uploadFile(
  config: WorkspaceConfig,
  subject: string,
  input: { name: string; mimeType: string; bytes: Uint8Array; parentId: string },
): Promise<DriveFile> {
  if (input.bytes.byteLength > DRIVE_UPLOAD_LIMIT_BYTES) {
    throw ApiError.validation({ file: uploadTooLarge }, uploadTooLarge);
  }
  const boundary = `oikonomia-${crypto.randomUUID()}`;
  const { body, contentType } = multipartBody(
    {
      name: input.name,
      mimeType: input.mimeType || "application/octet-stream",
      parents: [input.parentId],
    },
    input.bytes,
    boundary,
  );
  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: FILE_FIELDS,
    supportsAllDrives: "true",
  });
  const raw = await googleRequest<RawFile>(config, {
    subject,
    scopes,
    method: "POST",
    url: `${UPLOAD}?${params.toString()}`,
    body: body as BodyInit,
    headers: { "content-type": contentType },
  });
  return toDriveFile(raw);
}
