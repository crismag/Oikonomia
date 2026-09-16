import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import { z } from "zod";
import { nowIso } from "../db/records";
import type {
  DefinitionValues,
  FormsRepository,
  RecordValues,
} from "../repositories/forms-repository";
import type { FormDefinition, FormRecord, FormSection } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * Forms — the checklists a ministry designs, and the ones people fill in.
 *
 * Two rules carry this module, and both are about **a record outliving its
 * design**:
 *
 * - The structure is **copied onto a record** when it is created, with the
 *   version it came from. Editing a master checklist must never retroactively
 *   rewrite what somebody already completed.
 * - Deleting a definition never deletes its records — a completed checklist is
 *   evidence of what was done. A definition that has records is archived: it
 *   is no longer offered for new records, and each record renders from its own
 *   copy of the structure. Only a definition nothing was made from is deleted.
 *
 * Who may edit a form is the ministry's question, and Ministry already answers
 * it. Until a form carries a ministry that can be checked, editing is limited
 * to whoever owns the definition.
 */

const sections = z.array(
  z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    fields: z.array(z.record(z.string(), z.unknown())),
  }),
);

const createDefinition = z.object({
  title: z.string().trim().min(1, "Give the form a name."),
  ministryId: z.string().trim().min(1).optional(),
  sections: sections.default([]),
});

const saveDefinition = z.object({
  id: z.string().min(1),
  sections,
  summary: z.string().trim().max(200).default("Updated"),
});

const renameDefinition = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, "A form needs a name."),
  description: z.string().trim().max(500).optional(),
});

const createRecord = z.object({
  definitionId: z.string().min(1),
  title: z.string().trim().max(200).optional(),
  period: z.string().trim().max(80).optional(),
  date: z.string().trim().max(40).optional(),
});

const setResponse = z.object({
  recordId: z.string().min(1),
  response: z.record(z.string(), z.unknown()),
  label: z.string().trim().max(200).default(""),
});

export function createFormsService(repo: FormsRepository) {
  const requireDefinition = (id: string): FormDefinition => {
    const definition = repo.findDefinition(id);
    if (!definition) throw ApiError.notFound("That form");
    return definition;
  };

  const requireRecord = (id: string): FormRecord => {
    const record = repo.findRecord(id);
    if (!record) throw ApiError.notFound("That record");
    return record;
  };

  const mayDesign = (viewer: Viewer, definition: FormDefinition) =>
    definition.ownerId === viewer.person.id;

  return {
    all(_viewer: Viewer) {
      return { definitions: repo.definitions(), records: repo.records() };
    },

    createDefinition(viewer: Viewer, input: unknown): FormDefinition {
      const parsed = parse(createDefinition, input);
      const at = nowIso();
      return repo.insertDefinition({
        title: parsed.title,
        ownerId: viewer.person.id,
        status: "draft",
        version: 1,
        sections: (parsed.sections ?? []) as unknown as FormSection[],
        history: [{ version: 1, date: at, summary: "Created", authorId: viewer.person.id }],
        ...(parsed.ministryId ? { ministryId: parsed.ministryId } : {}),
      } as DefinitionValues);
    },

    /**
     * Save the structure, which publishes it and moves the version on.
     *
     * The version matters: records created afterwards capture the new
     * structure, and records already filled in keep the one they were made
     * with.
     */
    saveDefinition(viewer: Viewer, input: unknown): FormDefinition {
      const parsed = parse(saveDefinition, input);
      const definition = requireDefinition(parsed.id);
      if (!mayDesign(viewer, definition)) {
        throw ApiError.forbidden(text("refusal.form.owner"));
      }

      const version = definition.version + 1;
      const saved = repo.saveDefinition(parsed.id, {
        sections: parsed.sections as unknown as FormSection[],
        version,
        status: "published",
        history: [
          {
            version,
            date: nowIso(),
            summary: parsed.summary ?? "Updated",
            authorId: viewer.person.id,
          },
          ...definition.history,
        ],
      });
      if (!saved) throw ApiError.notFound("That form");
      return saved;
    },

    renameDefinition(viewer: Viewer, input: unknown): FormDefinition {
      const parsed = parse(renameDefinition, input);
      const definition = requireDefinition(parsed.id);
      if (!mayDesign(viewer, definition)) {
        throw ApiError.forbidden(text("refusal.form.owner"));
      }
      const saved = repo.saveDefinition(parsed.id, {
        title: parsed.title,
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      });
      if (!saved) throw ApiError.notFound("That form");
      return saved;
    },

    copyDefinition(viewer: Viewer, id: string, title: string): FormDefinition {
      const origin = requireDefinition(id);
      const at = nowIso();
      return repo.insertDefinition({
        title,
        ownerId: viewer.person.id,
        status: "draft",
        version: 1,
        /* A copy starts its own life: the structure travels, the history does
           not, because this form has not been revised — it has been started. */
        sections: origin.sections,
        history: [
          {
            version: 1,
            date: at,
            summary: `Copied from ${origin.title}`,
            authorId: viewer.person.id,
          },
        ],
        ...(origin.ministryId ? { ministryId: origin.ministryId } : {}),
      } as DefinitionValues);
    },

    /** Deleted if nothing was made from it; archived, keeping its records, if it was. */
    deleteDefinition(viewer: Viewer, id: string): { outcome: "deleted" | "archived" } {
      const definition = requireDefinition(id);
      if (!mayDesign(viewer, definition)) {
        throw ApiError.forbidden(text("refusal.form.owner"));
      }
      if (repo.records(id).length > 0) {
        repo.archiveDefinition(id);
        return { outcome: "archived" };
      }
      repo.deleteDefinition(id);
      return { outcome: "deleted" };
    },

    /**
     * Start filling one in.
     *
     * The structure is captured here, at this version. Editing the master
     * afterwards leaves this record exactly as the person filling it saw it.
     */
    createRecord(viewer: Viewer, input: unknown): FormRecord {
      const parsed = parse(createRecord, input);
      const definition = requireDefinition(parsed.definitionId);
      if (definition.archivedAt) {
        throw ApiError.conflict(
          "This form has been retired. Its records are kept, but no new ones can be started.",
        );
      }

      return repo.insertRecord({
        formDefinitionId: definition.id,
        formVersion: definition.version,
        sections: definition.sections,
        title: parsed.title || definition.title,
        status: "in-progress",
        responses: [],
        history: [
          { id: `h-${Date.now()}`, at: nowIso(), text: "Started", actorId: viewer.person.id },
        ],
        links: [],
        createdBy: viewer.person.id,
        ...(parsed.period ? { period: parsed.period } : {}),
        ...(parsed.date ? { date: parsed.date } : {}),
      } as RecordValues);
    },

    setResponse(viewer: Viewer, input: unknown): FormRecord {
      const parsed = parse(setResponse, input);
      const record = requireRecord(parsed.recordId);

      if (record.status === "completed") {
        /* A completed checklist is a statement about what was done. Changing
           one silently would make it a statement about nothing. */
        throw ApiError.conflict("This record is complete. Reopen it before changing an answer.");
      }

      const response = parsed.response as unknown as FormRecord["responses"][number];
      const responses = [
        ...record.responses.filter((r) => r.fieldId !== response.fieldId),
        response,
      ];

      const saved = repo.saveRecord(parsed.recordId, {
        responses,
        ...(parsed.label
          ? {
              history: [
                ...record.history,
                {
                  id: `h-${Date.now()}`,
                  at: nowIso(),
                  text: parsed.label,
                  actorId: viewer.person.id,
                },
              ],
            }
          : {}),
      });
      if (!saved) throw ApiError.notFound("That record");
      return saved;
    },

    completeRecord(viewer: Viewer, id: string): FormRecord {
      const record = requireRecord(id);
      const saved = repo.saveRecord(id, {
        status: "completed",
        completedAt: nowIso(),
        history: [
          ...record.history,
          { id: `h-${Date.now()}`, at: nowIso(), text: "Completed", actorId: viewer.person.id },
        ],
      });
      if (!saved) throw ApiError.notFound("That record");
      return saved;
    },

    reopenRecord(viewer: Viewer, id: string): FormRecord {
      const record = requireRecord(id);
      const saved = repo.saveRecord(id, {
        status: "in-progress",
        completedAt: undefined,
        history: [
          ...record.history,
          { id: `h-${Date.now()}`, at: nowIso(), text: "Reopened", actorId: viewer.person.id },
        ],
      });
      if (!saved) throw ApiError.notFound("That record");
      return saved;
    },
  };
}

export type FormsService = ReturnType<typeof createFormsService>;
