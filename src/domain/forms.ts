import { toISO } from "./schedule";
import type {
  FormDefinition,
  FormField,
  FormFieldType,
  FormItemStatus,
  FormRecord,
  FormResponse,
  FormSection,
  ReportableItem,
} from "./types";
import { formatDate } from "./dates";

/**
 * Forms logic.
 *
 * Structure stays structured: a record holds typed responses keyed by field id,
 * never rendered HTML, so reporting can read it later without parsing markup.
 */

export const fieldTypeLabel: Record<FormFieldType, string> = {
  heading: "Section heading",
  instruction: "Instruction",
  checkbox: "Checkbox",
  status: "Status item",
  "short-text": "Short text",
  "long-text": "Long text",
  number: "Number",
  date: "Date",
  time: "Time",
  "single-choice": "Single choice",
  "multi-choice": "Multiple choice",
  person: "Person",
};

/** Display-only fields carry no response and never count toward completion. */
export const isContentField = (type: FormFieldType) => type === "heading" || type === "instruction";

export const itemStatusLabel: Record<FormItemStatus, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  done: "Done",
  "needs-attention": "Needs attention",
  "not-applicable": "N/A",
};

/** Statuses a status-capable item cycles through, in operational order. */
export const itemStatuses: FormItemStatus[] = [
  "not-started",
  "in-progress",
  "done",
  "needs-attention",
  "not-applicable",
];

/* ------------------------------------------------------------- structure */

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

export function allFields(sections: FormSection[]): FormField[] {
  return sections.flatMap((section) => section.fields);
}

export function responseFields(sections: FormSection[]): FormField[] {
  return allFields(sections).filter((field) => !isContentField(field.type));
}

export function findField(sections: FormSection[], fieldId: string): FormField | undefined {
  return allFields(sections).find((field) => field.id === fieldId);
}

/** Move an item within an array. Returns a new array; out-of-range is a no-op. */
export function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

/** Deep-copies a section with fresh ids, so a duplicate is genuinely separate. */
export function duplicateSection(section: FormSection): FormSection {
  return {
    ...section,
    id: newId("sec"),
    ...(section.title ? { title: `${section.title} (copy)` } : {}),
    fields: section.fields.map((field) => ({ ...field, id: newId("fld") })),
  };
}

export function duplicateField(field: FormField): FormField {
  return { ...field, id: newId("fld") };
}

/* --------------------------------------------------------------- records */

export function responseFor(record: FormRecord, fieldId: string): FormResponse | undefined {
  return record.responses.find((response) => response.fieldId === fieldId);
}

/**
 * A record's progress, counted from response fields only.
 *
 * Deliberately a tally, not a percentage: the binder's value is knowing what is
 * outstanding and what needs attention, not a completion score.
 */
export function recordTally(record: FormRecord) {
  const fields = responseFields(record.sections);
  let done = 0;
  let attention = 0;
  let notApplicable = 0;
  let outstanding = 0;

  for (const field of fields) {
    const response = responseFor(record, field.id);

    if (field.type === "checkbox") {
      if (response?.value === true) done += 1;
      else outstanding += 1;
      continue;
    }

    if (field.type === "status") {
      switch (response?.status) {
        case "done":
          done += 1;
          break;
        case "needs-attention":
          attention += 1;
          break;
        case "not-applicable":
          notApplicable += 1;
          break;
        default:
          outstanding += 1;
      }
      continue;
    }

    const filled =
      response?.value !== undefined &&
      response.value !== "" &&
      !(Array.isArray(response.value) && response.value.length === 0);
    if (filled) done += 1;
    else outstanding += 1;
  }

  return { total: fields.length, done, attention, notApplicable, outstanding };
}

/** Creates a record from a definition, capturing its structure and version. */
export function recordFromDefinition(
  definition: FormDefinition,
  input: { title: string; period?: string; date?: string; createdBy: string },
): FormRecord {
  const now = toISO(new Date());
  return {
    id: newId("rec"),
    formDefinitionId: definition.id,
    formVersion: definition.version,
    /* Structure is copied, not referenced: editing the master later must not
       rewrite what this record asked at the time it was used. */
    sections: definition.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({ ...field })),
    })),
    title: input.title,
    ...(input.period ? { period: input.period } : {}),
    ...(input.date ? { date: input.date } : {}),
    status: "in-progress",
    responses: [],
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    history: [],
    links: [],
  };
}

/** Copies a definition as a new draft — a starting point for another purpose. */
export function copyDefinition(
  definition: FormDefinition,
  title: string,
  ownerId: string,
): FormDefinition {
  const now = toISO(new Date());
  return {
    ...definition,
    id: newId("frm"),
    title,
    ownerId,
    status: "draft",
    version: 1,
    createdAt: now,
    updatedAt: now,
    sections: definition.sections.map((section) => ({
      ...section,
      id: newId("sec"),
      fields: section.fields.map((field) => ({ ...field, id: newId("fld") })),
    })),
    history: [{ version: 1, date: now, summary: `Copied from ${definition.title}` }],
  };
}

/* ------------------------------------------------------------ reportable */

/**
 * Reportable material from form records.
 *
 * Exceptions first: on an operational checklist, "needs attention" is far more
 * report-worthy than thirty successful ticks, so only items that need attention,
 * plus fields the author explicitly marked reportable, are offered. A report is
 * never flooded with every checkbox.
 */
export function reportableFromRecords(records: FormRecord[]): ReportableItem[] {
  const items: ReportableItem[] = [];

  for (const record of records) {
    const label = record.title;

    for (const field of responseFields(record.sections)) {
      const response = responseFor(record, field.id);
      if (!response) continue;

      if (response.status === "needs-attention") {
        items.push({
          id: `rep-${record.id}-${field.id}`,
          source: { kind: "form-record", id: record.id, label },
          date: record.date ?? record.updatedAt,
          text: response.note
            ? `${field.label} needs attention — ${response.note}`
            : `${field.label} needs attention`,
          emphasis: "on-hold",
        });
        continue;
      }

      if (field.config?.reportable) {
        const value = formatValue(field, response);
        if (!value) continue;
        items.push({
          id: `rep-${record.id}-${field.id}`,
          source: { kind: "form-record", id: record.id, label },
          date: record.date ?? record.updatedAt,
          text: `${field.label}: ${value}`,
          emphasis: "progress",
        });
      }
    }
  }

  return items.sort((a, b) => b.date.localeCompare(a.date));
}

/** Human-readable response value, for reporting and print. */
export function formatValue(field: FormField, response?: FormResponse): string | undefined {
  if (!response) return undefined;
  if (field.type === "checkbox") return response.value === true ? "Done" : undefined;
  if (field.type === "status") {
    return response.status ? itemStatusLabel[response.status] : undefined;
  }
  if (Array.isArray(response.value)) {
    return response.value.length > 0 ? response.value.join(", ") : undefined;
  }
  if (response.value === undefined || response.value === "") return undefined;
  if (field.type === "date" && typeof response.value === "string") {
    return formatDate(response.value);
  }
  return String(response.value);
}
