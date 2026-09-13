import type { Database as Db } from "better-sqlite3";

import { nowIso } from "../db/records";

/**
 * What one person has starred, for their own quick access.
 *
 * No row means not starred. Modelled on `createReadStateRepository`
 * (`escalation-repository.ts`) — the same `(person_id, item_type, item_id)`
 * shape, because this is the same kind of fact (a private relationship one
 * person has to one record) with a different verb.
 */
export function createStarredItemRepository(db: Db) {
  return {
    starredIds(personId: string, itemType: string): Set<string> {
      const rows = db
        .prepare("SELECT item_id FROM starred_item WHERE person_id = ? AND item_type = ?")
        .all(personId, itemType) as { item_id: string }[];
      return new Set(rows.map((row) => row.item_id));
    },

    allStarred(personId: string): { itemType: string; itemId: string; starredAt: string }[] {
      const rows = db
        .prepare("SELECT item_type, item_id, starred_at FROM starred_item WHERE person_id = ?")
        .all(personId) as { item_type: string; item_id: string; starred_at: string }[];
      return rows.map((row) => ({
        itemType: row.item_type,
        itemId: row.item_id,
        starredAt: row.starred_at,
      }));
    },

    star(personId: string, itemType: string, itemId: string): void {
      db.prepare(
        `INSERT INTO starred_item (person_id, item_type, item_id, starred_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (person_id, item_type, item_id) DO NOTHING`,
      ).run(personId, itemType, itemId, nowIso());
    },

    unstar(personId: string, itemType: string, itemId: string): void {
      db.prepare(
        "DELETE FROM starred_item WHERE person_id = ? AND item_type = ? AND item_id = ?",
      ).run(personId, itemType, itemId);
    },
  };
}

export type StarredItemRepository = ReturnType<typeof createStarredItemRepository>;
