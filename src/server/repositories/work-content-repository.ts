import type { Database as Db } from "better-sqlite3";

import { nowIso } from "../db/records";
import type { MeetingBlock } from "@/domain/types";

/**
 * What binder-native work records say.
 *
 * The content store for leadership journal entries, kept apart from the record
 * itself for the same reason `document_content` is: a record of something and
 * the something are different concerns.
 *
 * It authorizes nothing. Whose journal this is, and whether anyone else may
 * read a word of it, is the work record's audience policy.
 */

export interface WorkContent {
  workId: string;
  blocks: MeetingBlock[];
  version: number;
  updatedAt: string;
  updatedById: string;
}

interface ContentRow {
  work_id: string;
  blocks: string;
  version: number;
  updated_at: string;
  updated_by: string;
}

const toContent = (row: ContentRow): WorkContent => ({
  workId: row.work_id,
  blocks: JSON.parse(row.blocks) as MeetingBlock[],
  version: row.version,
  updatedAt: row.updated_at,
  updatedById: row.updated_by,
});

export function createWorkContentRepository(db: Db) {
  return {
    find(workId: string): WorkContent | undefined {
      const row = db.prepare("SELECT * FROM work_content WHERE work_id = ?").get(workId) as
        ContentRow | undefined;
      return row ? toContent(row) : undefined;
    },

    create(workId: string, blocks: MeetingBlock[], authorId: string): WorkContent {
      db.prepare(
        `INSERT INTO work_content (work_id, blocks, updated_at, updated_by) VALUES (?, ?, ?, ?)`,
      ).run(workId, JSON.stringify(blocks), nowIso(), authorId);
      return this.find(workId)!;
    },

    /** Save, if nobody else has saved since. */
    save(
      workId: string,
      blocks: MeetingBlock[],
      editorId: string,
      version: number,
    ): WorkContent | "stale" | undefined {
      const result = db
        .prepare(
          `UPDATE work_content
              SET blocks = @blocks, updated_at = @updated_at,
                  updated_by = @updated_by, version = version + 1
            WHERE work_id = @id AND version = @version`,
        )
        .run({
          id: workId,
          blocks: JSON.stringify(blocks),
          updated_at: nowIso(),
          updated_by: editorId,
          version,
        });

      if (result.changes === 0) return this.find(workId) ? "stale" : undefined;
      return this.find(workId);
    },
  };
}

export type WorkContentRepository = ReturnType<typeof createWorkContentRepository>;
