import type { Database as Db } from "better-sqlite3";

import { newId, nowIso, type Writable } from "../db/records";
import type {
  AudiencePolicy,
  BinderLink,
  FormDefinition,
  FormRecord,
  FormRecordHistoryEntry,
  FormResponse,
  FormSection,
  FormVersionEntry,
} from "@/domain/types";

/**
 * Form rows.
 *
 * Reads, writes and the row ⇄ domain translation. It authorizes nothing.
 *
 * The structure lives as JSON in one column because a form's shape is the
 * leader's to design: a column per field would be a schema that changes every
 * time somebody adds a question, and a field table would buy nothing until
 * somebody wants to query across answers.
 */

interface DefinitionRow {
  id: string;
  title: string;
  description: string | null;
  ministry_id: string | null;
  campus_id: string | null;
  owner_id: string;
  status: FormDefinition["status"];
  version: number;
  sections: string;
  history: string;
  policy: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RecordRow {
  id: string;
  definition_id: string;
  form_version: number;
  sections: string;
  title: string;
  period: string | null;
  date: string | null;
  status: FormRecord["status"];
  responses: string;
  history: string;
  links: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined || value === "" ? {} : { [key]: value };

const json = <T>(raw: string | null, fallback: T): T => (raw ? (JSON.parse(raw) as T) : fallback);

function toDefinition(row: DefinitionRow): FormDefinition {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    status: row.status,
    version: row.version,
    sections: json<FormSection[]>(row.sections, []),
    history: json<FormVersionEntry[]>(row.history, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...has(row.description, "description"),
    ...has(row.ministry_id, "ministryId"),
    ...has(row.campus_id, "campusId"),
    ...has(row.archived_at, "archivedAt"),
    ...(row.policy ? { policy: JSON.parse(row.policy) as AudiencePolicy } : {}),
  } as FormDefinition;
}

function toRecord(row: RecordRow): FormRecord {
  return {
    id: row.id,
    formDefinitionId: row.definition_id,
    formVersion: row.form_version,
    sections: json<FormSection[]>(row.sections, []),
    title: row.title,
    status: row.status,
    responses: json<FormResponse[]>(row.responses, []),
    history: json<FormRecordHistoryEntry[]>(row.history, []),
    links: json<BinderLink[]>(row.links, []),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...has(row.period, "period"),
    ...has(row.date, "date"),
    ...has(row.completed_at, "completedAt"),
  } as FormRecord;
}

export type DefinitionValues = Writable<Omit<FormDefinition, "id" | "createdAt" | "updatedAt">>;
export type RecordValues = Writable<Omit<FormRecord, "id" | "createdAt" | "updatedAt">>;

export function createFormsRepository(db: Db) {
  return {
    definitions(): FormDefinition[] {
      const rows = db
        .prepare("SELECT * FROM form_definition ORDER BY updated_at DESC")
        .all() as DefinitionRow[];
      return rows.map(toDefinition);
    },

    findDefinition(id: string): FormDefinition | undefined {
      const row = db.prepare("SELECT * FROM form_definition WHERE id = ?").get(id) as
        DefinitionRow | undefined;
      return row ? toDefinition(row) : undefined;
    },

    insertDefinition(values: DefinitionValues, id = newId("frm")): FormDefinition {
      const at = nowIso();
      db.prepare(
        `INSERT INTO form_definition
           (id, title, description, ministry_id, campus_id, owner_id, status, version,
            sections, history, policy, created_at, updated_at)
         VALUES (@id, @title, @description, @ministry_id, @campus_id, @owner_id, @status,
                 @version, @sections, @history, @policy, @created_at, @updated_at)`,
      ).run({
        id,
        title: values.title,
        description: values.description ?? null,
        ministry_id: values.ministryId ?? null,
        campus_id: values.campusId ?? null,
        owner_id: values.ownerId,
        status: values.status ?? "draft",
        version: values.version ?? 1,
        sections: JSON.stringify(values.sections ?? []),
        history: JSON.stringify(values.history ?? []),
        policy: values.policy ? JSON.stringify(values.policy) : null,
        created_at: at,
        updated_at: at,
      });
      return this.findDefinition(id)!;
    },

    saveDefinition(id: string, values: Partial<DefinitionValues>): FormDefinition | undefined {
      const current = this.findDefinition(id);
      if (!current) return undefined;

      db.prepare(
        `UPDATE form_definition
            SET title = @title, description = @description, ministry_id = @ministry_id,
                status = @status, version = @version, sections = @sections,
                history = @history, updated_at = @updated_at
          WHERE id = @id`,
      ).run({
        id,
        title: values.title ?? current.title,
        description: (values.description ?? current.description) || null,
        ministry_id: (values.ministryId ?? current.ministryId) || null,
        status: values.status ?? current.status,
        version: values.version ?? current.version,
        sections: JSON.stringify(values.sections ?? current.sections),
        history: JSON.stringify(values.history ?? current.history),
        updated_at: nowIso(),
      });
      return this.findDefinition(id);
    },

    /** Only a definition nothing was made from; the foreign key refuses others. */
    deleteDefinition(id: string): boolean {
      return db.prepare("DELETE FROM form_definition WHERE id = ?").run(id).changes > 0;
    },

    archiveDefinition(id: string): FormDefinition | undefined {
      db.prepare(
        "UPDATE form_definition SET archived_at = COALESCE(archived_at, @at), updated_at = @at WHERE id = @id",
      ).run({ id, at: nowIso() });
      return this.findDefinition(id);
    },

    records(definitionId?: string): FormRecord[] {
      const rows = (
        definitionId
          ? db
              .prepare("SELECT * FROM form_record WHERE definition_id = ? ORDER BY created_at DESC")
              .all(definitionId)
          : db.prepare("SELECT * FROM form_record ORDER BY created_at DESC").all()
      ) as RecordRow[];
      return rows.map(toRecord);
    },

    findRecord(id: string): FormRecord | undefined {
      const row = db.prepare("SELECT * FROM form_record WHERE id = ?").get(id) as
        RecordRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    insertRecord(values: RecordValues, id = newId("fr")): FormRecord {
      const at = nowIso();
      db.prepare(
        `INSERT INTO form_record
           (id, definition_id, form_version, sections, title, period, date, status,
            responses, history, links, created_by, created_at, updated_at, completed_at)
         VALUES (@id, @definition_id, @form_version, @sections, @title, @period, @date,
                 @status, @responses, @history, @links, @created_by, @created_at,
                 @updated_at, @completed_at)`,
      ).run({
        id,
        definition_id: values.formDefinitionId,
        form_version: values.formVersion,
        sections: JSON.stringify(values.sections ?? []),
        title: values.title,
        period: values.period ?? null,
        date: values.date ?? null,
        status: values.status ?? "in-progress",
        responses: JSON.stringify(values.responses ?? []),
        history: JSON.stringify(values.history ?? []),
        links: JSON.stringify(values.links ?? []),
        created_by: values.createdBy,
        created_at: at,
        updated_at: at,
        completed_at: values.completedAt ?? null,
      });
      return this.findRecord(id)!;
    },

    saveRecord(id: string, values: Partial<RecordValues>): FormRecord | undefined {
      const current = this.findRecord(id);
      if (!current) return undefined;

      db.prepare(
        `UPDATE form_record
            SET title = @title, status = @status, responses = @responses,
                history = @history, updated_at = @updated_at, completed_at = @completed_at
          WHERE id = @id`,
      ).run({
        id,
        title: values.title ?? current.title,
        status: values.status ?? current.status,
        responses: JSON.stringify(values.responses ?? current.responses),
        history: JSON.stringify(values.history ?? current.history),
        updated_at: nowIso(),
        /* Naming the key is how a reopen says "clear this"; omitting it is how
           every other save says "leave it alone". `?? current` cannot tell the
           two apart, and a reopened record that still claims a completion date
           is a record that lies about itself. */
        completed_at:
          "completedAt" in values ? (values.completedAt ?? null) : (current.completedAt ?? null),
      });
      return this.findRecord(id);
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM form_definition").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type FormsRepository = ReturnType<typeof createFormsRepository>;
