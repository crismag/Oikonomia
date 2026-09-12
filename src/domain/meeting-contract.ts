import { z } from "zod";
import { inlineHtmlIsSafe } from "./meeting";

/**
 * What Meeting Notes accepts.
 *
 * Shared by the editor and the server so the two cannot disagree about what a
 * valid note is. §21 still holds: the server re-parses everything, because a
 * request need not have come from a screen.
 *
 * The shape is deliberately permissive about *content* and strict about
 * *structure*. A leader writing during a meeting must never be stopped by a
 * validator; what the server refuses is a note that could not be read back —
 * a block with no type, a note with no date.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "That is not a date.")
  .refine((v) => !Number.isNaN(Date.parse(v)), "That is not a real date.");

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 19:30.");

export const noteTypes = ["personal", "minutes"] as const;
export const meetingTypes = [
  "leaders",
  "ministry",
  "lifegroup",
  "planning",
  "coaching",
  "campus",
  "other",
] as const;
export const noteStatuses = ["draft", "complete"] as const;

export const blockTypes = [
  "paragraph",
  "heading-1",
  "heading-2",
  "bullet",
  "numbered",
  "quote",
  "divider",
  "checklist",
  "decision",
  "follow-up",
] as const;

export const followUpStates = ["open", "resolved", "converted"] as const;

/**
 * One block of the document.
 *
 * `html` is inline HTML from a small allowlist. The editor sanitizes on the way
 * in (`sanitizeInline`), and because the editor is the half an attacker
 * controls, the server checks the result against the same allowlist rather than
 * believing it. It refuses rather than rewrites, so there is still only one
 * sanitizer.
 */
export const meetingBlock = z.object({
  id: z.string().min(1),
  type: z.enum(blockTypes),
  html: z.string().refine(inlineHtmlIsSafe, "That formatting is not allowed in a note."),
  checked: z.boolean().optional(),
  state: z.enum(followUpStates).optional(),
  taskId: z.string().min(1).optional(),
});

const binderLink = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  label: z.string().optional(),
});

const noteFields = {
  /* A note with no title is ordinary: the leader names it once it has content. */
  title: z.string().trim().max(300).default(""),
  noteType: z.enum(noteTypes),
  date: isoDate,
  time: clockTime.optional(),
  location: z.string().trim().max(200).optional(),
  type: z.enum(meetingTypes).optional(),
  facilitatorId: z.string().min(1).optional(),
  noteTakerId: z.string().min(1).optional(),
  participantIds: z.array(z.string().min(1)).default([]),
  absenteeIds: z.array(z.string().min(1)).optional(),
  blocks: z.array(meetingBlock).default([]),
  status: z.enum(noteStatuses).default("draft"),
  tags: z.array(z.string().trim().min(1)).default([]),
  relatedText: z.string().trim().max(500).optional(),
  links: z.array(binderLink).default([]),
  authorId: z.string().min(1).optional(),
};

export const createNote = z.object(noteFields);

/**
 * A patch names only what changes.
 *
 * Every field is optional, and `.default()` is stripped — a default on a patch
 * would silently reset a field nobody touched, which on a document being typed
 * into is data loss rather than a bug.
 */
export const updateNote = z.object({
  title: noteFields.title.removeDefault().optional(),
  noteType: noteFields.noteType.optional(),
  date: noteFields.date.optional(),
  time: noteFields.time,
  location: noteFields.location,
  type: noteFields.type,
  facilitatorId: noteFields.facilitatorId,
  noteTakerId: noteFields.noteTakerId,
  participantIds: noteFields.participantIds.removeDefault().optional(),
  absenteeIds: noteFields.absenteeIds,
  blocks: noteFields.blocks.removeDefault().optional(),
  status: noteFields.status.removeDefault().optional(),
  tags: noteFields.tags.removeDefault().optional(),
  relatedText: noteFields.relatedText,
  links: noteFields.links.removeDefault().optional(),
});

/* ------------------------------------------------------------------ tasks */

export const createTask = z.object({
  meetingId: z.string().min(1),
  blockId: z.string().min(1).optional(),
  title: z.string().trim().min(1, "Give the task a name."),
  assigneeId: z.string().min(1).optional(),
  dueDate: isoDate.optional(),
});

export const updateTask = z.object({
  title: z.string().trim().min(1, "Give the task a name.").optional(),
  assigneeId: z.string().min(1).optional(),
  dueDate: isoDate.optional(),
  status: z.enum(["open", "done"]).optional(),
});

/* ------------------------------------------------------------------ lists */

/**
 * What the list screen asks for.
 *
 * Meeting Notes *is* a list — unlike the calendar — so it pages, and the
 * filters match the ones already in the URL (`src/routes/meeting-notes.tsx`).
 * The page is validated against the same rules as every other collection.
 */
export const noteQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  noteType: z.enum(noteTypes).optional(),
  tag: z.string().trim().min(1).optional(),
  ministryId: z.string().trim().min(1).optional(),
});

export type NoteQuery = z.infer<typeof noteQuery>;
