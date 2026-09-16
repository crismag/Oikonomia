import type { Database as Db } from "better-sqlite3";

import { nowIso } from "../db/records";

/**
 * Which Drive folder is each ministry's.
 *
 * One row per ministry, written once. The folder itself is in Drive; this only
 * remembers its id so it is never made twice.
 */
export function createDriveFolderRepository(db: Db) {
  return {
    folderFor(ministryId: string): string | undefined {
      const row = db
        .prepare("SELECT folder_id FROM ministry_drive_folder WHERE ministry_id = ?")
        .get(ministryId) as { folder_id: string } | undefined;
      return row?.folder_id;
    },

    /**
     * Remember a ministry's folder.
     *
     * If another request recorded one first, theirs stands and is returned —
     * the caller then knows its own folder was surplus.
     */
    record(ministryId: string, folderId: string, createdBy: string): string {
      db.prepare(
        `INSERT OR IGNORE INTO ministry_drive_folder (ministry_id, folder_id, created_by, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(ministryId, folderId, createdBy, nowIso());
      return this.folderFor(ministryId)!;
    },
  };
}

export type DriveFolderRepository = ReturnType<typeof createDriveFolderRepository>;
