import type { Database as Db } from "better-sqlite3";

import { newId, nowIso } from "../db/records";

/**
 * The people a public demonstration offers, and the visitors it has made.
 *
 * Only rows in `demo_identity` (migration 035). Everything a demo identity
 * *is* — a name, an access role, an account — lives in the ordinary tables
 * and is read through their ordinary repositories.
 */

export type DemoIdentityKind = "designated" | "visitor";

export interface DemoIdentity {
  id: string;
  personId: string;
  kind: DemoIdentityKind;
  displayOrder: number;
  createdAt: string;
}

interface Row {
  id: string;
  person_id: string;
  kind: DemoIdentityKind;
  display_order: number;
  created_at: string;
}

const toIdentity = (row: Row): DemoIdentity => ({
  id: row.id,
  personId: row.person_id,
  kind: row.kind,
  displayOrder: row.display_order,
  createdAt: row.created_at,
});

export function createDemoIdentityRepository(db: Db) {
  return {
    /** The identities a visitor may choose, in the order they are offered. */
    designated(): DemoIdentity[] {
      return (
        db
          .prepare(
            "SELECT * FROM demo_identity WHERE kind = 'designated' ORDER BY display_order, created_at",
          )
          .all() as Row[]
      ).map(toIdentity);
    },

    find(id: string): DemoIdentity | undefined {
      const row = db.prepare("SELECT * FROM demo_identity WHERE id = ?").get(id) as Row | undefined;
      return row ? toIdentity(row) : undefined;
    },

    count(kind: DemoIdentityKind): number {
      return (
        db.prepare("SELECT COUNT(*) AS n FROM demo_identity WHERE kind = ?").get(kind) as {
          n: number;
        }
      ).n;
    },

    insert(values: {
      personId: string;
      kind: DemoIdentityKind;
      displayOrder?: number;
    }): DemoIdentity {
      const id = newId("demo");
      db.prepare(
        `INSERT INTO demo_identity (id, person_id, kind, display_order, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, values.personId, values.kind, values.displayOrder ?? 0, nowIso());
      return this.find(id)!;
    },
  };
}

export type DemoIdentityRepository = ReturnType<typeof createDemoIdentityRepository>;
