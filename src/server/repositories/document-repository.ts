import type { Database as Db } from "better-sqlite3";

import { newId, nowIso } from "../db/records";
import { noteReadableParams, noteReadableSql } from "./note-readability";
import { isDocumentEntityType } from "@/domain/registry";
import type {
  DocumentAssociation,
  DocumentEntityType,
  DocumentRelationship,
  RegisteredDocument,
} from "@/domain/registry";

/**
 * Registry rows.
 *
 * Reads, writes, and the row ⇄ domain translation, plus the one thing this
 * repository does that the others do not: **it withholds in SQL.**
 *
 * `DOCUMENT-REGISTRY.md` §4 Boundary 1 says metadata discovery is enforced in
 * the query and protects "result counts and filter counts" as much as titles.
 * So every read path takes `readableBy` and a withheld row never leaves the
 * database — not into a total, not into a facet count, not into a suggestion.
 * The service ranks and pages what comes back, which is safe precisely because
 * everything it can see is already permitted.
 *
 * Boundary 2 — whether the resource actually opens — is not here and is not
 * this application's to decide. See `domain/registry.ts`.
 */

interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  origin: RegisteredDocument["origin"];
  url: string | null;
  file_name: string | null;
  open_route: string | null;
  tags: string | null;
  registered_by: string;
  created_at: string;
  updated_at: string;
}

interface AssociationRow {
  id: string;
  document_id: string;
  entity_type: string;
  entity_id: string;
  relationship: DocumentRelationship;
  created_by: string;
  created_at: string;
}

const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined || value === "" ? {} : { [key]: value };

const pack = (value: unknown[]) => (value.length === 0 ? null : JSON.stringify(value));

function toAssociation(row: AssociationRow): DocumentAssociation | undefined {
  /* A row naming a kind of record this build does not know about is skipped
     rather than rendered as an unplaced association. */
  if (!isDocumentEntityType(row.entity_type)) return undefined;
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    relationship: row.relationship,
    createdById: row.created_by,
    createdAt: row.created_at,
  };
}

function toDocument(row: DocumentRow, associations: DocumentAssociation[]): RegisteredDocument {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    origin: row.origin,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    registeredById: row.registered_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    associations,
    ...has(row.description, "description"),
    ...has(row.url, "url"),
    ...has(row.file_name, "fileName"),
    ...has(row.open_route, "openRoute"),
  } as RegisteredDocument;
}

export interface DocumentValues {
  title: string;
  description?: string | undefined;
  kind: string;
  origin: RegisteredDocument["origin"];
  url?: string | undefined;
  fileName?: string | undefined;
  openRoute?: string | undefined;
  tags?: string[] | undefined;
  registeredById: string;
}

/** A patch may leave a field alone by omitting it. */
export type DocumentPatch = { [K in keyof DocumentValues]?: DocumentValues[K] | undefined };

export interface AssociationValues {
  documentId: string;
  entityType: DocumentEntityType;
  entityId?: string | undefined;
  relationship?: DocumentRelationship | undefined;
  createdById: string;
}

export interface SearchFilters {
  /**
   * Whose view this is. Required by every read — a read path that forgets it
   * would return everything, so it is not optional.
   */
  readableBy: string;
  entityType?: DocumentEntityType | undefined;
  entityId?: string | undefined;
  tag?: string | undefined;
  registeredById?: string | undefined;
  since?: string | undefined;
}

export function createDocumentRepository(db: Db) {
  /**
   * The withholding clause.
   *
   * A document is discoverable when it takes part in nothing, or when at least
   * one record it takes part in is one this viewer may know about.
   *
   * Only one kind of record carries a real rule today: a meeting note, whose
   * readability is genuinely private. Everything else in the binder is shared
   * leadership material, and this says so rather than inventing gates nobody
   * agreed to (§35). When Ministry or Leadership Reports grow a real rule, it
   * attaches here — as another arm of this subquery, not in a component.
   */
  const discoverable = (personId: string) => ({
    sql: `(
      NOT EXISTS (SELECT 1 FROM document_association a WHERE a.document_id = document.id)
      OR EXISTS (
        SELECT 1 FROM document_association a
         WHERE a.document_id = document.id
           AND (
             a.entity_type <> 'meeting-note'
             OR EXISTS (
               SELECT 1 FROM meeting_note n
                WHERE n.id = a.entity_id AND ${noteReadableSql("n")}
             )
           )
      )
    )`,
    params: noteReadableParams(personId),
  });

  function where(filters: SearchFilters) {
    const gate = discoverable(filters.readableBy);
    const clauses: string[] = [gate.sql];
    const params: unknown[] = [...gate.params];

    if (filters.entityType) {
      clauses.push(
        `EXISTS (SELECT 1 FROM document_association a
                  WHERE a.document_id = document.id AND a.entity_type = ?
                    ${filters.entityId === undefined ? "" : "AND a.entity_id = ?"})`,
      );
      params.push(filters.entityType);
      if (filters.entityId !== undefined) params.push(filters.entityId);
    }
    if (filters.tag) {
      clauses.push("tags LIKE ?");
      params.push(`%"${filters.tag}"%`);
    }
    if (filters.registeredById) {
      clauses.push("registered_by = ?");
      params.push(filters.registeredById);
    }
    if (filters.since) {
      clauses.push("updated_at >= ?");
      params.push(filters.since);
    }
    return { sql: `WHERE ${clauses.join(" AND ")}`, params };
  }

  const associationsFor = (ids: string[]): Map<string, DocumentAssociation[]> => {
    const byDocument = new Map<string, DocumentAssociation[]>();
    if (ids.length === 0) return byDocument;

    const rows = db
      .prepare(
        `SELECT * FROM document_association
          WHERE document_id IN (${ids.map(() => "?").join(", ")})
          ORDER BY created_at, id`,
      )
      .all(...ids) as AssociationRow[];

    for (const row of rows) {
      const association = toAssociation(row);
      if (!association) continue;
      byDocument.set(row.document_id, [...(byDocument.get(row.document_id) ?? []), association]);
    }
    return byDocument;
  };

  const attach = (rows: DocumentRow[]): RegisteredDocument[] => {
    const associations = associationsFor(rows.map((r) => r.id));
    return rows.map((row) => toDocument(row, associations.get(row.id) ?? []));
  };

  return {
    /** Everything the viewer may know about, unpaged. For ranking and facets. */
    all(filters: SearchFilters): RegisteredDocument[] {
      const { sql, params } = where(filters);
      const rows = db
        .prepare(`SELECT * FROM document ${sql} ORDER BY updated_at DESC, title`)
        .all(...params) as DocumentRow[];
      return attach(rows);
    },

    /**
     * One record, withheld the same way the list withholds.
     *
     * A deep link must not reveal what search would not — the access model says
     * so plainly, and a `find` that ignores the viewer is how that gets lost.
     */
    find(id: string, readableBy: string): RegisteredDocument | undefined {
      const gate = discoverable(readableBy);
      const row = db
        .prepare(`SELECT * FROM document WHERE id = ? AND ${gate.sql}`)
        .get(id, ...gate.params) as DocumentRow | undefined;
      return row ? attach([row])[0] : undefined;
    },

    /** Without the gate. For the service's own checks, never for a response. */
    findUnguarded(id: string): RegisteredDocument | undefined {
      const row = db.prepare("SELECT * FROM document WHERE id = ?").get(id) as
        DocumentRow | undefined;
      return row ? attach([row])[0] : undefined;
    },

    insert(values: DocumentValues, id = newId("doc")): RegisteredDocument {
      const at = nowIso();
      db.prepare(
        `INSERT INTO document
           (id, title, description, kind, origin, url, file_name, open_route,
            tags, registered_by, created_at, updated_at)
         VALUES (@id, @title, @description, @kind, @origin, @url, @file_name, @open_route,
                 @tags, @registered_by, @created_at, @updated_at)`,
      ).run({
        id,
        title: values.title,
        description: values.description ?? null,
        kind: values.kind,
        origin: values.origin,
        url: values.url ?? null,
        file_name: values.fileName ?? null,
        open_route: values.openRoute ?? null,
        tags: pack(values.tags ?? []),
        registered_by: values.registeredById,
        created_at: at,
        updated_at: at,
      });
      return this.findUnguarded(id)!;
    },

    update(id: string, patch: DocumentPatch): RegisteredDocument | undefined {
      const current = this.findUnguarded(id);
      if (!current) return undefined;

      db.prepare(
        `UPDATE document
            SET title = @title, description = @description, kind = @kind,
                url = @url, tags = @tags, updated_at = @updated_at
          WHERE id = @id`,
      ).run({
        id,
        title: patch.title ?? current.title,
        description: (patch.description ?? current.description) || null,
        kind: patch.kind ?? current.kind,
        url: (patch.url ?? current.url) || null,
        tags: pack(patch.tags ?? current.tags),
        updated_at: nowIso(),
      });
      return this.findUnguarded(id);
    },

    delete(id: string): boolean {
      /* Associations go with it — the foreign key cascades. */
      return db.prepare("DELETE FROM document WHERE id = ?").run(id).changes > 0;
    },

    /**
     * File a document somewhere.
     *
     * Filing it in the same place twice is not an error and not a duplicate
     * row: §3 says one document, many associations, never a duplicate record.
     */
    associate(values: AssociationValues, id = newId("assoc")): DocumentAssociation | undefined {
      db.prepare(
        `INSERT OR IGNORE INTO document_association
           (id, document_id, entity_type, entity_id, relationship, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        values.documentId,
        values.entityType,
        values.entityId ?? "",
        values.relationship ?? "filed-in",
        values.createdById,
        nowIso(),
      );

      const row = db
        .prepare(
          `SELECT * FROM document_association
            WHERE document_id = ? AND entity_type = ? AND entity_id = ? AND relationship = ?`,
        )
        .get(
          values.documentId,
          values.entityType,
          values.entityId ?? "",
          values.relationship ?? "filed-in",
        ) as AssociationRow | undefined;
      return row ? toAssociation(row) : undefined;
    },

    removeAssociation(id: string): boolean {
      return db.prepare("DELETE FROM document_association WHERE id = ?").run(id).changes > 0;
    },

    findAssociation(id: string): (DocumentAssociation & { documentId: string }) | undefined {
      const row = db.prepare("SELECT * FROM document_association WHERE id = ?").get(id) as
        AssociationRow | undefined;
      if (!row) return undefined;
      const association = toAssociation(row);
      return association ? { ...association, documentId: row.document_id } : undefined;
    },

    /**
     * What to call the records a document takes part in.
     *
     * §5: search shows "Ministry › Music Ministry › September Planning" rather
     * than an unplaced title, and that context has to be resolved from the
     * records themselves. Resolved at read time rather than copied onto the
     * association, so a renamed record does not leave stale context behind.
     *
     * Only the persisted sections are answered here. The rest are still
     * fixtures and the service resolves them.
     */
    labels(): Map<string, { label: string; secondaryLabel?: string }> {
      const out = new Map<string, { label: string; secondaryLabel?: string }>();
      const put = (type: string, id: string, label: string, secondaryLabel?: string) => {
        if (!label) return;
        out.set(`${type}:${id}`, secondaryLabel ? { label, secondaryLabel } : { label });
      };

      for (const row of db.prepare("SELECT id, title FROM meeting_note").all() as {
        id: string;
        title: string;
      }[]) {
        put("meeting-note", row.id, row.title);
      }
      for (const row of db.prepare("SELECT id, title FROM reach_out_report").all() as {
        id: string;
        title: string;
      }[]) {
        put("reach-out-report", row.id, row.title);
      }
      for (const row of db.prepare("SELECT id, title FROM schedule_entry").all() as {
        id: string;
        title: string;
      }[]) {
        put("schedule-entry", row.id, row.title);
      }

      /*
       * The rest of what a document can be attached to. These used to be
       * resolved against fixtures in the service, which meant a document
       * attached to a real ministry showed the name of a fictional one — or
       * nothing at all, once the fictional one was gone.
       */
      for (const row of db.prepare("SELECT id, name FROM ministry").all() as {
        id: string;
        name: string;
      }[]) {
        put("ministry", row.id, row.name);
      }
      for (const row of db.prepare("SELECT id, title FROM leadership_report").all() as {
        id: string;
        title: string;
      }[]) {
        put("leadership-report", row.id, row.title);
      }
      for (const row of db.prepare("SELECT id, title FROM form_definition").all() as {
        id: string;
        title: string;
      }[]) {
        put("form", row.id, row.title);
      }
      /* Where the work lives, which is how a leader would name it. */
      for (const row of db.prepare("SELECT id, subject, context_label FROM work_context").all() as {
        id: string;
        subject: string;
        context_label: string;
      }[]) {
        put("work", row.id, row.context_label || row.subject);
      }
      return out;
    },

    /**
     * Gatherings, for naming a LifeGroup resource's context.
     *
     * Returned rather than labelled here: a gathering is an occurrence and is
     * named by its venue and its day, and both of those are the domain's to
     * phrase — `venueName` falls back through the venue record, and `dayLabel`
     * is how LifeGroup writes a date everywhere else.
     */
    gatherings(): { id: string; venueId: string; venueName?: string; date: string }[] {
      const rows = db.prepare("SELECT id, venue_id, venue_name, date FROM gathering").all() as {
        id: string;
        venue_id: string;
        venue_name: string | null;
        date: string;
      }[];
      return rows.map((row) => ({
        id: row.id,
        venueId: row.venue_id,
        date: row.date,
        ...(row.venue_name ? { venueName: row.venue_name } : {}),
      }));
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM document").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type DocumentRepository = ReturnType<typeof createDocumentRepository>;
