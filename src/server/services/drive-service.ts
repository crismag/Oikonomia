import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import {
  browseDrive,
  createGoogleFile as createGoogleFileInput,
  driveDetails,
  DRIVE_UPLOAD_LIMIT_BYTES,
  kindForMimeType,
  registerDriveFile,
  uploadTooLarge,
  type DriveBrowse,
  type DriveDetails,
  type DriveFile,
} from "@/domain/drive";
import { driveFileIdFromUrl } from "@/domain/drive";
import { canContribute, relationshipTo } from "@/domain/ministry";
import type { RegisteredDocument } from "@/domain/registry";
import type { Ministry } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";
import * as drive from "../google/drive";
import { mayActAs, workspaceConfig, type WorkspaceConfig } from "../google/workspace";
import type { DocumentRepository } from "../repositories/document-repository";
import type { DriveFolderRepository } from "../repositories/drive-folder-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";

/**
 * Documents that live in Google Drive.
 *
 * ## Who acts, and who decides
 *
 * Browsing, choosing, uploading and creating all happen **as the signed-in
 * leader**, through their person record's church Google address. Google's
 * sharing then decides what they see and where they may write; this service
 * adds Oikonomia's own rules on top and never takes any away:
 *
 * | Operation                            | Oikonomia's rule                              |
 * | ------------------------------------ | --------------------------------------------- |
 * | Browse, choose a file to register    | The same as registering a link: signed in     |
 * | Upload or create into a ministry     | Contributes to that ministry (`canContribute`) |
 * | Live details for listed documents    | Only documents the viewer may already discover |
 *
 * A ministry's folder is the one thing made **as the church mailbox**, inside
 * the church's Drive root, because it belongs to the ministry and not to
 * whoever added the first file.
 *
 * ## What it keeps
 *
 * A registry record: the Drive file id, where it opens, its name and type.
 * Never the file. An upload passes through on its way to Drive.
 */

export interface DriveServiceDeps {
  documents: DocumentRepository;
  folders: DriveFolderRepository;
  organization: OrganizationRepository;
  /**
   * A document, if this viewer may discover it — the document registry's own
   * `get`, so details are withheld exactly where the registry withholds. Falls
   * back to the repository's SQL gate alone.
   */
  discover?: (viewer: Viewer, documentId: string) => RegisteredDocument | undefined;
  /** How the Workspace configuration is read. Replaced in tests. */
  workspace?: () => WorkspaceConfig | undefined;
  /**
   * The address a person signs in with, when their person record has none —
   * the same fallback the calendar overlay uses, so Drive and the calendar
   * agree on who a leader is in Google.
   */
  accountEmailOf?: (personId: string) => string | undefined;
}

export interface UploadInput {
  ministryId: string;
  name: string;
  mimeType: string;
  size: number;
  bytes: () => Promise<Uint8Array>;
}

/*
 * One folder creation per ministry at a time, in this process. Two leaders
 * uploading into a new ministry at once would otherwise both make a folder,
 * leaving an empty twin in Drive.
 */
const creating = new Map<string, Promise<string>>();

export function createDriveService(deps: DriveServiceDeps) {
  const readConfig = deps.workspace ?? workspaceConfig;
  const discover =
    deps.discover ?? ((viewer: Viewer, id: string) => deps.documents.find(id, viewer.person.id));

  function config(): WorkspaceConfig {
    const found = readConfig();
    if (!found) {
      throw ApiError.forbidden(text("refusal.drive.notConnected"));
    }
    return found;
  }

  /** The address Oikonomia acts as for this viewer, or a calm refusal. */
  function subjectFor(viewer: Viewer, settings: WorkspaceConfig): string {
    const email =
      deps.organization.findPerson(viewer.person.id)?.email ??
      deps.accountEmailOf?.(viewer.person.id);
    if (!mayActAs(settings, email)) {
      throw ApiError.forbidden(
        text("refusal.drive.googleAddressMissing", { domain: settings.domain }),
      );
    }
    return email.trim().toLowerCase();
  }

  function ministry(ministryId: string): Ministry {
    const found = deps.organization.findMinistry(ministryId);
    if (!found) throw ApiError.validation({ ministryId: text("refusal.ministry.unknown") });
    return found;
  }

  /** Writing into a ministry's folder is writing on its shelf. */
  function contributorOf(viewer: Viewer, ministryId: string): Ministry {
    const found = ministry(ministryId);
    if (!canContribute(relationshipTo(found, viewer.person.id))) {
      throw ApiError.forbidden(text("refusal.ministry.write"));
    }
    return found;
  }

  /**
   * The ministry's Drive folder, made the first time it is needed.
   *
   * As the church mailbox, under the church's Drive root. Without a root there
   * is nowhere agreed to put ministry folders, and this refuses rather than
   * scattering them through somebody's My Drive.
   */
  async function ensureMinistryFolder(
    target: Ministry,
    requestedBy: string,
    settings: WorkspaceConfig = config(),
  ): Promise<string> {
    const existing = deps.folders.folderFor(target.id);
    if (existing) return existing;
    const root = settings.driveRoot;
    if (!root) {
      throw ApiError.forbidden(text("refusal.drive.ministryFoldersMissing"));
    }

    const pending = creating.get(target.id);
    if (pending) return pending;
    const work = (async () => {
      const folder = await drive.createFolder(settings, settings.appUser, target.name, root);
      return deps.folders.record(target.id, folder.id, requestedBy);
    })();
    creating.set(target.id, work);
    try {
      return await work;
    } finally {
      creating.delete(target.id);
    }
  }

  /**
   * Keep a record of a Drive file, filed under a ministry when one is named.
   *
   * One Drive file is one record: choosing it again, or from another ministry,
   * files the existing record there too rather than making a second.
   */
  function record(viewer: Viewer, file: DriveFile, ministryId?: string): RegisteredDocument {
    const existing = deps.documents.findByDriveFile(file.id);
    const document =
      existing ??
      deps.documents.insert({
        title: file.name,
        kind: kindForMimeType(file.mimeType),
        origin: "drive",
        url: file.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`,
        driveFileId: file.id,
        driveMimeType: file.mimeType,
        registeredById: viewer.person.id,
        tags: [],
      });

    if (ministryId) {
      deps.documents.associate({
        documentId: document.id,
        entityType: "ministry",
        entityId: ministryId,
        relationship: "filed-in",
        createdById: viewer.person.id,
      });
    }
    return deps.documents.findUnguarded(document.id)!;
  }

  return {
    ensureMinistryFolder: (viewer: Viewer, ministryId: string) =>
      ensureMinistryFolder(contributorOf(viewer, ministryId), viewer.person.id),

    /**
     * One page of a place in Drive, as the viewer sees it.
     *
     * Looking at a ministry's folder never creates it — a read does not write
     * to Drive. An absent folder is described, so the dialog can say when it
     * will appear.
     */
    async browse(viewer: Viewer, input: unknown): Promise<DriveBrowse> {
      const query = parse(browseDrive, input);
      const settings = config();
      const subject = subjectFor(viewer, settings);
      const common = { search: query.search, pageToken: query.pageToken };

      if (query.folderId) {
        return drive.listFiles(settings, subject, {
          in: "folder",
          folderId: query.folderId,
          ...common,
        });
      }
      if (query.source === "mine")
        return drive.listFiles(settings, subject, { in: "my-drive", ...common });
      if (query.source === "shared")
        return drive.listFiles(settings, subject, { in: "shared", ...common });

      if (!query.ministryId)
        throw ApiError.validation({ ministryId: text("refusal.drive.ministryMissing") });
      ministry(query.ministryId);
      if (!settings.driveRoot) return { files: [], folderUnavailable: "no-root" };
      const folderId = deps.folders.folderFor(query.ministryId);
      if (!folderId) return { files: [], folderUnavailable: "not-yet" };
      return drive.listFiles(settings, subject, { in: "folder", folderId, ...common });
    },

    /**
     * Register a file the viewer chose in Drive.
     *
     * The same rule as registering a link. Drive is asked about the file as the
     * viewer first, so a file id they cannot open in Drive cannot be registered
     * by guessing it.
     */
    async register(viewer: Viewer, input: unknown): Promise<RegisteredDocument> {
      const parsed = parse(registerDriveFile, input);
      const settings = config();
      const subject = subjectFor(viewer, settings);
      if (parsed.ministryId) ministry(parsed.ministryId);
      const file = await drive.getFile(settings, subject, parsed.fileId);
      return record(viewer, file, parsed.ministryId);
    },

    /** Upload into the ministry's folder, as the viewer, and register it there. */
    async upload(
      viewer: Viewer,
      input: UploadInput,
    ): Promise<{ document: RegisteredDocument; file: DriveFile }> {
      /* Refused before anything else is read or asked — including the bytes. */
      if (input.size > DRIVE_UPLOAD_LIMIT_BYTES) {
        throw ApiError.validation({ file: uploadTooLarge }, uploadTooLarge);
      }
      const name = input.name.trim().slice(0, 200);
      if (!name) throw ApiError.validation({ file: text("refusal.drive.fileMissing") });

      const target = contributorOf(viewer, input.ministryId);
      const settings = config();
      const subject = subjectFor(viewer, settings);
      const folderId = await ensureMinistryFolder(target, viewer.person.id, settings);
      const file = await drive.uploadFile(settings, subject, {
        name,
        mimeType: input.mimeType,
        bytes: await input.bytes(),
        parentId: folderId,
      });
      return { document: record(viewer, file, target.id), file };
    },

    /** A new Google Doc, Sheet or Slides file in the ministry's folder, registered there. */
    async create(
      viewer: Viewer,
      input: unknown,
    ): Promise<{ document: RegisteredDocument; file: DriveFile }> {
      const parsed = parse(createGoogleFileInput, input);
      const target = contributorOf(viewer, parsed.ministryId);
      const settings = config();
      const subject = subjectFor(viewer, settings);
      const folderId = await ensureMinistryFolder(target, viewer.person.id, settings);
      const file = await drive.createGoogleFile(settings, subject, {
        name: parsed.name,
        kind: parsed.kind,
        parentId: folderId,
      });
      return { document: record(viewer, file, target.id), file };
    },

    /**
     * What Drive says now about documents on a list.
     *
     * Only documents this viewer may already discover, and only as this
     * viewer: a file Google will not show them comes back unavailable. A
     * viewer without a church Google address simply gets no details — the
     * list still works, and opening a document still goes to Drive.
     */
    async details(viewer: Viewer, input: unknown): Promise<DriveDetails[]> {
      const parsed = parse(driveDetails, input);
      const settings = config();
      let subject: string;
      try {
        subject = subjectFor(viewer, settings);
      } catch {
        return [];
      }

      const wanted = parsed.documentIds
        .map((id) => discover(viewer, id))
        .filter((document): document is RegisteredDocument => !!document)
        .map((document) => ({
          documentId: document.id,
          fileId: document.driveFileId ?? driveFileIdFromUrl(document.url),
        }))
        .filter((entry): entry is { documentId: string; fileId: string } => !!entry.fileId);

      const files = await drive.getFiles(
        settings,
        subject,
        wanted.map((entry) => entry.fileId),
      );
      return wanted.map(({ documentId, fileId }) => {
        const file = files.get(fileId);
        return file ? { documentId, available: true, file } : { documentId, available: false };
      });
    },
  };
}

export type DriveService = ReturnType<typeof createDriveService>;
