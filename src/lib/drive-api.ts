import { text } from "@/config/messages";
import { createServerFn } from "@tanstack/react-start";

import { withWorkspace } from "./workspace-api";
import type { DriveBrowse, DriveDetails, DriveFile } from "@/domain/drive";
import type { RegisteredDocument } from "@/domain/registry";

/**
 * Google Drive behind the binder's documents.
 *
 * Every call acts as the signed-in leader in Drive; the service
 * (`src/server/services/drive-service.ts`) holds the rules. All of them are
 * refused in a demonstration (`operations.ts`, `integrations`), where
 * Workspace is never configured in any case.
 */

async function driveService(db: import("better-sqlite3").Database) {
  const [
    { createDriveService },
    { createDocumentService },
    { createDocumentRepository },
    { createBinderContentRepository },
    { createDriveFolderRepository },
    { createOrganizationRepository },
    { createLeadershipReportRepository },
    { createWorkRepository },
    { createFormsRepository },
    { ApiError },
  ] = await Promise.all([
    import("@/server/services/drive-service"),
    import("@/server/services/document-service"),
    import("@/server/repositories/document-repository"),
    import("@/server/repositories/binder-content-repository"),
    import("@/server/repositories/drive-folder-repository"),
    import("@/server/repositories/organization-repository"),
    import("@/server/repositories/leadership-report-repository"),
    import("@/server/repositories/work-repository"),
    import("@/server/repositories/forms-repository"),
    import("@/server/api/response"),
  ]);
  const documents = createDocumentRepository(db);
  const organization = createOrganizationRepository(db);
  const registry = createDocumentService(documents, createBinderContentRepository(db), {
    organization,
    reports: createLeadershipReportRepository(db),
    work: createWorkRepository(db),
    forms: createFormsRepository(db),
  });
  const { createAccountRepository } = await import("@/server/repositories/account-repository");
  const accounts = createAccountRepository(db);
  return createDriveService({
    accountEmailOf: (personId) => accounts.findByPerson(personId)?.email,
    documents,
    folders: createDriveFolderRepository(db),
    organization,
    /* The registry's own withholding, so Drive details never describe a
       document the registry would not list. */
    discover: (viewer, id) => {
      try {
        return registry.get(viewer, id);
      } catch (error) {
        if (error instanceof ApiError) return undefined;
        throw error;
      }
    },
  });
}

/** One page of a place in Drive: the ministry's folder, My Drive, or Shared with me. */
export const browseDrive = createServerFn({ method: "GET" })
  .validator((input: unknown) => input)
  .handler(({ data }) =>
    withWorkspace(async ({ viewer, db }): Promise<DriveBrowse> =>
      (await driveService(db)).browse(viewer, data),
    ),
  );

/** Register a file the leader chose in Drive, filed under a ministry when named. */
export const registerDriveFile = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) =>
    withWorkspace(async ({ viewer, db }): Promise<RegisteredDocument> =>
      (await driveService(db)).register(viewer, data),
    ),
  );

/**
 * Upload a file into a ministry's Drive folder and register it there.
 *
 * FormData, because a file is not JSON. The bytes are read only after the
 * size and the leader's right to add to the ministry have been checked, and
 * are sent on to Drive — never written anywhere here.
 */
export const uploadDriveFile = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) =>
    withWorkspace(
      async ({
        viewer,
        db,
        ApiError,
      }): Promise<{ document: RegisteredDocument; file: DriveFile }> => {
        if (!(data instanceof FormData)) {
          throw ApiError.validation({ file: text("refusal.drive.fileMissing") });
        }
        const file = data.get("file");
        const ministryId = data.get("ministryId");
        if (!(file instanceof Blob) || typeof ministryId !== "string" || !ministryId) {
          throw ApiError.validation({ file: text("refusal.drive.fileMissing") });
        }
        return (await driveService(db)).upload(viewer, {
          ministryId,
          name: "name" in file && typeof file.name === "string" ? file.name : "Untitled",
          mimeType: file.type,
          size: file.size,
          bytes: async () => new Uint8Array(await file.arrayBuffer()),
        });
      },
    ),
  );

/** A new Google Doc, Sheet or Slides file in a ministry's folder, registered there. */
export const createDriveFile = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) =>
    withWorkspace(
      async ({ viewer, db }): Promise<{ document: RegisteredDocument; file: DriveFile }> =>
        (await driveService(db)).create(viewer, data),
    ),
  );

/** What Drive says now — name, owner, last change — about documents on a list. */
export const fetchDriveDetails = createServerFn({ method: "GET" })
  .validator((input: unknown) => input)
  .handler(({ data }) =>
    withWorkspace(async ({ viewer, db }): Promise<DriveDetails[]> =>
      (await driveService(db)).details(viewer, data),
    ),
  );
