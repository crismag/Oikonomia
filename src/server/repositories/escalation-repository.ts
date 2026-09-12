import type { Database as Db } from "better-sqlite3";

import { newId, nowIso } from "../db/records";
import type {
  Escalation,
  EscalationSourceType,
  EscalationStatus,
  EscalationType,
  RecipientRole,
} from "@/domain/escalation";

/**
 * Asks made of leadership, and what became of them.
 *
 * One row is one ask. It is never a copy of the information it is about — it
 * points at the source and, where only one paragraph needed somebody, at the
 * entry inside it.
 */

interface Row {
  id: string;
  type: EscalationType;
  status: EscalationStatus;
  source_type: EscalationSourceType;
  source_id: string;
  entry_id: string | null;
  context_label: string;
  request: string;
  requested_by: string;
  requested_from_role: RecipientRole | null;
  requested_from_person: string | null;
  needed_by: string | null;
  assignee_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface EscalationValues {
  type: EscalationType;
  status: EscalationStatus;
  sourceType: EscalationSourceType;
  sourceId: string;
  entryId?: string | undefined;
  contextLabel?: string | undefined;
  request: string;
  requestedById: string;
  requestedFromRole?: RecipientRole | undefined;
  requestedFromPersonId?: string | undefined;
  neededBy?: string | undefined;
}

export interface EscalationActivity {
  id: string;
  at: string;
  actorId: string;
  summary: string;
  note?: string;
}

const toEscalation = (row: Row): Escalation => ({
  id: row.id,
  type: row.type,
  status: row.status,
  sourceType: row.source_type,
  sourceId: row.source_id,
  ...(row.entry_id ? { entryId: row.entry_id } : {}),
  contextLabel: row.context_label,
  request: row.request,
  requestedById: row.requested_by,
  ...(row.requested_from_role ? { requestedFromRole: row.requested_from_role } : {}),
  ...(row.requested_from_person ? { requestedFromPersonId: row.requested_from_person } : {}),
  ...(row.needed_by ? { neededBy: row.needed_by } : {}),
  ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
  ...(row.decided_by ? { decidedById: row.decided_by } : {}),
  ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
  ...(row.decision_note ? { decisionNote: row.decision_note } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function createEscalationRepository(db: Db) {
  return {
    all(): Escalation[] {
      const rows = db.prepare("SELECT * FROM escalation ORDER BY created_at DESC").all() as Row[];
      return rows.map(toEscalation);
    },

    find(id: string): Escalation | undefined {
      const row = db.prepare("SELECT * FROM escalation WHERE id = ?").get(id) as Row | undefined;
      return row ? toEscalation(row) : undefined;
    },

    /** Everything asked from one place, so a report can show its own asks. */
    forSource(sourceType: EscalationSourceType, sourceId: string): Escalation[] {
      const rows = db
        .prepare(
          "SELECT * FROM escalation WHERE source_type = ? AND source_id = ? ORDER BY created_at",
        )
        .all(sourceType, sourceId) as Row[];
      return rows.map(toEscalation);
    },

    insert(values: EscalationValues): Escalation {
      const id = newId("esc");
      const at = nowIso();
      db.prepare(
        `INSERT INTO escalation (
           id, type, status, source_type, source_id, entry_id, context_label, request,
           requested_by, requested_from_role, requested_from_person, needed_by,
           created_at, updated_at
         ) VALUES (
           @id, @type, @status, @sourceType, @sourceId, @entryId, @contextLabel, @request,
           @requestedById, @role, @person, @neededBy, @at, @at
         )`,
      ).run({
        id,
        type: values.type,
        status: values.status,
        sourceType: values.sourceType,
        sourceId: values.sourceId,
        entryId: values.entryId ?? null,
        contextLabel: values.contextLabel ?? "",
        request: values.request,
        requestedById: values.requestedById,
        role: values.requestedFromRole ?? null,
        person: values.requestedFromPersonId ?? null,
        neededBy: values.neededBy ?? null,
        at,
      });
      return this.find(id)!;
    },

    /**
     * Move it along.
     *
     * `assigneeId`, `decidedById` and the decision fields are named only when
     * they are being set, so a status change never quietly clears who decided.
     */
    setStatus(
      id: string,
      status: EscalationStatus,
      fields: {
        assigneeId?: string | undefined;
        decidedById?: string | undefined;
        decisionNote?: string | undefined;
      } = {},
    ): Escalation | undefined {
      const current = this.find(id);
      if (!current) return undefined;

      db.prepare(
        `UPDATE escalation
            SET status = @status,
                assignee_id = @assignee,
                decided_by = @decidedBy,
                decided_at = @decidedAt,
                decision_note = @note,
                updated_at = @at
          WHERE id = @id`,
      ).run({
        id,
        status,
        assignee:
          "assigneeId" in fields ? (fields.assigneeId ?? null) : (current.assigneeId ?? null),
        decidedBy:
          "decidedById" in fields ? (fields.decidedById ?? null) : (current.decidedById ?? null),
        decidedAt: fields.decidedById ? nowIso() : (current.decidedAt ?? null),
        note:
          "decisionNote" in fields ? (fields.decisionNote ?? null) : (current.decisionNote ?? null),
        at: nowIso(),
      });
      return this.find(id);
    },

    addActivity(escalationId: string, entry: { actorId: string; summary: string; note?: string }) {
      db.prepare(
        `INSERT INTO escalation_activity (id, escalation_id, at, actor_id, summary, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(newId("ea"), escalationId, nowIso(), entry.actorId, entry.summary, entry.note ?? null);
    },

    activityFor(escalationId: string): EscalationActivity[] {
      const rows = db
        .prepare("SELECT * FROM escalation_activity WHERE escalation_id = ? ORDER BY at")
        .all(escalationId) as {
        id: string;
        at: string;
        actor_id: string;
        summary: string;
        note: string | null;
      }[];
      return rows.map((row) => ({
        id: row.id,
        at: row.at,
        actorId: row.actor_id,
        summary: row.summary,
        ...(row.note ? { note: row.note } : {}),
      }));
    },

    remove(id: string): boolean {
      return db.prepare("DELETE FROM escalation WHERE id = ?").run(id).changes > 0;
    },
  };
}

export type EscalationRepository = ReturnType<typeof createEscalationRepository>;

/**
 * What one person has read.
 *
 * No row means unread. Nothing is written until somebody actually opens
 * something, so this table is a record of reading rather than a list of things
 * a leader is behind on — it can never become a queue.
 */
export function createReadStateRepository(db: Db) {
  return {
    readIds(personId: string, itemType: string): Set<string> {
      const rows = db
        .prepare("SELECT item_id FROM read_state WHERE person_id = ? AND item_type = ?")
        .all(personId, itemType) as { item_id: string }[];
      return new Set(rows.map((row) => row.item_id));
    },

    allRead(personId: string): { itemType: string; itemId: string; lastViewedAt: string }[] {
      const rows = db
        .prepare("SELECT item_type, item_id, last_viewed_at FROM read_state WHERE person_id = ?")
        .all(personId) as { item_type: string; item_id: string; last_viewed_at: string }[];
      return rows.map((row) => ({
        itemType: row.item_type,
        itemId: row.item_id,
        lastViewedAt: row.last_viewed_at,
      }));
    },

    markRead(personId: string, itemType: string, itemId: string): void {
      const at = nowIso();
      db.prepare(
        `INSERT INTO read_state (person_id, item_type, item_id, first_seen_at, last_viewed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (person_id, item_type, item_id)
         DO UPDATE SET last_viewed_at = excluded.last_viewed_at`,
      ).run(personId, itemType, itemId, at, at);
    },

    /** Deliberately available: a leader may put something back to unread. */
    markUnread(personId: string, itemType: string, itemId: string): void {
      db.prepare(
        "DELETE FROM read_state WHERE person_id = ? AND item_type = ? AND item_id = ?",
      ).run(personId, itemType, itemId);
    },
  };
}

export type ReadStateRepository = ReturnType<typeof createReadStateRepository>;
