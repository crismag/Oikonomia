import type { Database as Db } from "better-sqlite3";

import { nowIso } from "../db/records";
import type { BinderContent } from "@/domain/registry";
import type { MeetingBlock } from "@/domain/types";

/**
 * What binder-native documents say.
 *
 * The **content store**, kept apart from the registry on purpose. The registry
 * says a resource exists and where it lives (`document-repository.ts`); this
 * holds the bytes for the one place the application itself stores them.
 * Invariant 7: the registry is not a repository.
 *
 * It authorizes nothing and knows nothing about ministries. Who may write a
 * ministry's plan is the service's to decide.
 */

interface ContentRow {
  document_id: string;
  blocks: string;
  version: number;
  updated_at: string;
  updated_by: string;
}

const toContent = (row: ContentRow): BinderContent => ({
  documentId: row.document_id,
  blocks: JSON.parse(row.blocks) as MeetingBlock[],
  version: row.version,
  updatedAt: row.updated_at,
  updatedById: row.updated_by,
});

export function createBinderContentRepository(db: Db) {
  return {
    find(documentId: string): BinderContent | undefined {
      const row = db
        .prepare("SELECT * FROM document_content WHERE document_id = ?")
        .get(documentId) as ContentRow | undefined;
      return row ? toContent(row) : undefined;
    },

    create(documentId: string, blocks: MeetingBlock[], authorId: string): BinderContent {
      db.prepare(
        `INSERT INTO document_content (document_id, blocks, updated_at, updated_by)
         VALUES (?, ?, ?, ?)`,
      ).run(documentId, JSON.stringify(blocks), nowIso(), authorId);
      return this.find(documentId)!;
    },

    /**
     * Save, if nobody else has saved since.
     *
     * The version is part of the WHERE, so the check and the write are one
     * statement. `"stale"` means somebody else moved it on; `undefined` means
     * it is gone — two different things to tell a leader.
     */
    save(
      documentId: string,
      blocks: MeetingBlock[],
      editorId: string,
      version: number,
    ): BinderContent | "stale" | undefined {
      const result = db
        .prepare(
          `UPDATE document_content
              SET blocks = @blocks, updated_at = @updated_at,
                  updated_by = @updated_by, version = version + 1
            WHERE document_id = @id AND version = @version`,
        )
        .run({
          id: documentId,
          blocks: JSON.stringify(blocks),
          updated_at: nowIso(),
          updated_by: editorId,
          version,
        });

      if (result.changes === 0) return this.find(documentId) ? "stale" : undefined;
      return this.find(documentId);
    },
  };
}

export type BinderContentRepository = ReturnType<typeof createBinderContentRepository>;
